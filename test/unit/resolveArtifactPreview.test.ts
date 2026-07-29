import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compileArtifactPreview, findPreviewEntryFile } from '../../src/engine/preview/resolveArtifactPreview';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';

let deliveryOsHome: string;
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-resolve-preview-test-'));
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

function writeUiComponentArtifact(remoteCacheDir: string, id: string): string {
  const payloadDir = path.join(remoteCacheDir, 'artifacts', id, 'payload');
  fs.mkdirSync(payloadDir, { recursive: true });
  fs.writeFileSync(
    path.join(remoteCacheDir, 'artifacts', id, 'manifest.yaml'),
    [
      `id: ${id}`,
      `kind: ui-component`,
      `description: Test button component`,
      `owner: team-x`,
      `version: 1.0.0`,
      `source_repo: https://example.invalid/repo`,
      `install_target: some/target`,
      `review_required: false`,
      '',
    ].join('\n'),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(payloadDir, 'Button.tsx'),
    `export function Button() { return <button>Click me</button>; }\n`,
    'utf-8',
  );
  fs.writeFileSync(
    path.join(payloadDir, 'preview.tsx'),
    `import { Button } from './Button';\nexport const Primary = () => <Button />;\n`,
    'utf-8',
  );
  return payloadDir;
}

describe('findPreviewEntryFile', () => {
  it('finds preview.tsx when present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-find-preview-'));
    try {
      fs.writeFileSync(path.join(dir, 'preview.tsx'), 'export const X = () => null;');
      expect(findPreviewEntryFile(dir)).toBe(path.join(dir, 'preview.tsx'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws a clear error when no conventional preview file exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-find-preview-'));
    try {
      expect(() => findPreviewEntryFile(dir)).toThrow(/No preview entry file found/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('compileArtifactPreview', () => {
  it('resolves a pushed artifact by (remote, id) and compiles its preview, reading directly from the remote cache -- no pull required', async () => {
    writeRegistry(['test-remote']);
    writeUiComponentArtifact(remoteCachePath('test-remote'), 'my-button');

    const { html } = await compileArtifactPreview('test-remote', 'my-button');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Click me');
  });
});
