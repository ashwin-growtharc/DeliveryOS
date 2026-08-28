import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolvePayloadDir, resolveWithinPayloadDir } from '../../src/engine/payload/payloadDir';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';

let deliveryOsHome: string;
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-payload-dir-test-'));
  process.env.DELIVERYOS_HOME = deliveryOsHome;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.DELIVERYOS_HOME;
  } else {
    process.env.DELIVERYOS_HOME = originalEnv;
  }
  fs.rmSync(deliveryOsHome, { recursive: true, force: true });
});

function writeRegistry(remoteNames: string[]): void {
  const registry = {
    remotes: remoteNames.map((name) => ({
      name,
      url: `https://example.invalid/${name}`,
      addedAt: new Date().toISOString(),
    })),
  };
  fs.mkdirSync(deliveryOsHome, { recursive: true });
  fs.writeFileSync(remotesRegistryPath(), JSON.stringify(registry), 'utf-8');
}

function writeArtifact(remoteCacheDir: string, id: string, payloadPath?: string): string {
  const payloadDir = payloadPath
    ? path.join(remoteCacheDir, payloadPath)
    : path.join(remoteCacheDir, 'artifacts', id, 'payload');
  fs.mkdirSync(payloadDir, { recursive: true });
  fs.writeFileSync(
    path.join(remoteCacheDir, 'artifacts', id, 'manifest.yaml'),
    [
      `id: ${id}`,
      `kind: template`,
      `description: Test template`,
      `owner: team-x`,
      `version: 1.0.0`,
      `source_repo: https://example.invalid/repo`,
      `install_target: some/target`,
      `review_required: false`,
      ...(payloadPath ? [`payload_path: ${payloadPath}`] : []),
      '',
    ].join('\n'),
    'utf-8',
  );
  return payloadDir;
}

describe('resolvePayloadDir', () => {
  it('resolves the default artifacts/<id>/payload location when the manifest has no payload_path', () => {
    writeRegistry(['test-remote']);
    const payloadDir = writeArtifact(remoteCachePath('test-remote'), 'design-kit');
    expect(resolvePayloadDir('test-remote', 'design-kit')).toBe(payloadDir);
  });

  it('resolves a custom payload_path when the manifest declares one', () => {
    writeRegistry(['test-remote']);
    const payloadDir = writeArtifact(remoteCachePath('test-remote'), 'design-kit', 'artifacts/design-kit/payload');
    expect(resolvePayloadDir('test-remote', 'design-kit')).toBe(payloadDir);
  });

  it('refuses a payload_path that resolves outside the remote clone, never returning a path outside it', () => {
    // Same untrusted-manifest-field threat model as pull.ts/push.ts's own
    // payload_path containment checks -- a malicious remote's manifest.yaml
    // could set payload_path to escape its own clone directory entirely.
    // Deliberately writes ONLY the manifest (never calls writeArtifact,
    // which would otherwise mkdirSync the escaping payload_path itself
    // for real, outside this test's own tmp dir).
    writeRegistry(['test-remote']);
    const remoteCacheDir = remoteCachePath('test-remote');
    fs.mkdirSync(path.join(remoteCacheDir, 'artifacts', 'evil-kit'), { recursive: true });
    fs.writeFileSync(
      path.join(remoteCacheDir, 'artifacts', 'evil-kit', 'manifest.yaml'),
      [
        'id: evil-kit',
        'kind: template',
        'description: Test template',
        'owner: team-x',
        'version: 1.0.0',
        'source_repo: https://example.invalid/repo',
        'install_target: some/target',
        'review_required: false',
        'payload_path: ../../../../etc/passwd',
        '',
      ].join('\n'),
      'utf-8',
    );
    expect(() => resolvePayloadDir('test-remote', 'evil-kit')).toThrow(
      /payload_path.*resolves outside the remote's own directory/,
    );
  });
});

describe('resolveWithinPayloadDir', () => {
  it('resolves an ordinary relative path inside the payload directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-within-payload-'));
    try {
      expect(resolveWithinPayloadDir(dir, 'GUIDELINES.md')).toBe(path.join(dir, 'GUIDELINES.md'));
      expect(resolveWithinPayloadDir(dir, 'components')).toBe(path.join(dir, 'components'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a relative path that escapes the payload directory, never resolving to anything outside it', () => {
    // Deeply-nested payload dir, same reasoning as fixAntiPattern.test.ts's
    // own traversal-trap test: a short tmp path's escape would resolve to
    // a FIXED ancestor (e.g. the real home directory), not a randomized
    // one -- nesting keeps the escape contained to a throwaway root this
    // test fully controls and cleans up.
    const trapRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-payload-dir-traversal-trap-'));
    const nestedPayloadDir = path.join(trapRoot, 'a', 'b', 'c', 'd', 'payload');
    fs.mkdirSync(nestedPayloadDir, { recursive: true });

    try {
      expect(() => resolveWithinPayloadDir(nestedPayloadDir, '../../../../etc/passwd')).toThrow(
        /resolves outside this artifact's own payload directory/,
      );
    } finally {
      fs.rmSync(trapRoot, { recursive: true, force: true });
    }
  });
});
