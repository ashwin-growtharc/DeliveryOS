import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildCatalog } from '../../src/engine/catalog/catalog';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';

let deliveryOsHome: string;
let originalEnv: string | undefined;

function writeArtifact(remoteCacheDir: string, id: string, kind: string): void {
  const artifactDir = path.join(remoteCacheDir, 'artifacts', id);
  fs.mkdirSync(path.join(artifactDir, 'payload'), { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, 'manifest.yaml'),
    [
      `id: ${id}`,
      `kind: ${kind}`,
      `description: Test artifact ${id}`,
      `owner: team-x`,
      `version: 1.0.0`,
      `source_repo: https://example.invalid/repo`,
      `install_target: some/target`,
      `review_required: false`,
      '',
    ].join('\n'),
    'utf-8',
  );
}

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-catalog-test-'));
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

describe('buildCatalog', () => {
  it('aggregates manifests from 2+ remote cache dirs', () => {
    writeRegistry(['remote-a', 'remote-b']);
    writeArtifact(remoteCachePath('remote-a'), 'artifact-one', 'template');
    writeArtifact(remoteCachePath('remote-a'), 'artifact-two', 'doc');
    writeArtifact(remoteCachePath('remote-b'), 'artifact-three', 'config');

    const catalog = buildCatalog();
    expect(catalog).toHaveLength(3);

    const byId = Object.fromEntries(catalog.map((entry) => [entry.manifest.id, entry]));
    expect(byId['artifact-one'].remoteName).toBe('remote-a');
    expect(byId['artifact-two'].remoteName).toBe('remote-a');
    expect(byId['artifact-three'].remoteName).toBe('remote-b');
  });

  it('does not throw when the same id appears in two remotes', () => {
    writeRegistry(['remote-a', 'remote-b']);
    writeArtifact(remoteCachePath('remote-a'), 'shared-id', 'template');
    writeArtifact(remoteCachePath('remote-b'), 'shared-id', 'template');

    let catalog: ReturnType<typeof buildCatalog> = [];
    expect(() => {
      catalog = buildCatalog();
    }).not.toThrow();

    const matches = catalog.filter((entry) => entry.manifest.id === 'shared-id');
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.remoteName).sort()).toEqual(['remote-a', 'remote-b']);
  });

  it('returns an empty array when there are no registered remotes', () => {
    writeRegistry([]);
    expect(buildCatalog()).toEqual([]);
  });
});
