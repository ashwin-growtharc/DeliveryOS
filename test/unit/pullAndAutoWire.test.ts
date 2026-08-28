import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stringify } from 'yaml';
import { pullAndAutoWire } from '../../src/engine/pull/pullAndAutoWire';
import { readLockfile } from '../../src/engine/lockfile/lockfile';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';

// Same lightweight "fake a registered remote + cache directly on disk"
// pattern as test/unit/pull.test.ts.

let deliveryOsHome: string;
let originalEnv: string | undefined;
let cwd: string;

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-autowire-test-home-'));
  process.env.DELIVERYOS_HOME = deliveryOsHome;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-autowire-test-cwd-'));
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.DELIVERYOS_HOME;
  } else {
    process.env.DELIVERYOS_HOME = originalEnv;
  }
  fs.rmSync(deliveryOsHome, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
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

function writeArtifact(id: string, wiringActions: unknown[]): void {
  const remoteCacheDir = remoteCachePath('test-remote');
  const payloadDir = path.join(remoteCacheDir, 'artifacts', id, 'payload');
  fs.mkdirSync(payloadDir, { recursive: true });
  fs.writeFileSync(path.join(payloadDir, 'README.md'), `# ${id}\n`, 'utf-8');
  const manifest = {
    id,
    kind: 'backend-plugin',
    description: 'Test artifact for pullAndAutoWire lockfile recording',
    owner: 'team-x',
    version: '1.0.0',
    source_repo: 'https://example.invalid/repo',
    install_target: 'installed',
    review_required: false,
    wiring_actions: wiringActions,
  };
  fs.mkdirSync(path.join(remoteCacheDir, 'artifacts', id), { recursive: true });
  fs.writeFileSync(path.join(remoteCacheDir, 'artifacts', id, 'manifest.yaml'), stringify(manifest), 'utf-8');
}

const FRESH_FILE_ACTION = {
  type: 'suggest_snippet',
  description: 'Wire up a fresh auth entry point',
  targetFile: 'auth.ts',
  whenAbsent: { instructions: 'Create it.', snippet: 'export const wired = 1;' },
};

describe('pullAndAutoWire lockfile recording (Phase 13 uninstall groundwork)', () => {
  it('records the resolved installTarget on the lockfile entry via pullArtifact itself', async () => {
    writeRegistry(['test-remote']);
    writeArtifact('no-wiring-plugin', []);

    await pullAndAutoWire('no-wiring-plugin', undefined, cwd);

    const lockfile = readLockfile(cwd);
    const entry = lockfile.entries.find((e) => e.id === 'no-wiring-plugin');
    expect(entry?.installTarget).toBe(path.resolve(cwd, 'installed'));
    expect(entry?.wiredFiles).toBeUndefined();
  });

  it('records wiring.applied as wiredFiles on the lockfile entry, via a second upsert, after a real whenAbsent file gets created', async () => {
    writeRegistry(['test-remote']);
    writeArtifact('wired-plugin', [FRESH_FILE_ACTION]);

    const result = await pullAndAutoWire('wired-plugin', undefined, cwd);

    expect(result.wiring.applied).toEqual(['auth.ts']);
    expect(fs.existsSync(path.join(cwd, 'auth.ts'))).toBe(true);

    const lockfile = readLockfile(cwd);
    const entry = lockfile.entries.find((e) => e.id === 'wired-plugin');
    // Both fields must survive together -- the second upsert reads the
    // entry pullArtifact's own call just wrote and spreads it, rather than
    // reconstructing a fresh one that would silently drop installTarget.
    expect(entry?.installTarget).toBe(path.resolve(cwd, 'installed'));
    expect(entry?.wiredFiles).toEqual(['auth.ts']);
  });

  it('does not perform a second lockfile write at all when wiring applied nothing (target file already existed)', async () => {
    writeRegistry(['test-remote']);
    writeArtifact('needs-review-plugin', [FRESH_FILE_ACTION]);
    // Pre-seed auth.ts so the action resolves to needsReview, not applied.
    fs.writeFileSync(path.join(cwd, 'auth.ts'), 'export const preExisting = 1;', 'utf-8');

    const result = await pullAndAutoWire('needs-review-plugin', undefined, cwd);

    expect(result.wiring.applied).toEqual([]);
    expect(result.wiring.needsReview).toEqual(['auth.ts']);

    const lockfile = readLockfile(cwd);
    const entry = lockfile.entries.find((e) => e.id === 'needs-review-plugin');
    expect(entry?.wiredFiles).toBeUndefined();
    // The pre-existing file must be left completely untouched.
    expect(fs.readFileSync(path.join(cwd, 'auth.ts'), 'utf-8')).toBe('export const preExisting = 1;');
  });
});
