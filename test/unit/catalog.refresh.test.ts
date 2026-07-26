import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { refreshCatalog } from '../../src/engine/catalog/catalog';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';

let deliveryOsHome: string;
let originalEnv: string | undefined;

function writeArtifact(remoteCacheDir: string, id: string): void {
  const artifactDir = path.join(remoteCacheDir, 'artifacts', id);
  fs.mkdirSync(path.join(artifactDir, 'payload'), { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, 'manifest.yaml'),
    [
      `id: ${id}`,
      `kind: doc`,
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

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-catalog-refresh-test-'));
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

describe('refreshCatalog', () => {
  it('still returns local catalog entries when a remote cache is not a real git repo', async () => {
    // None of these cache dirs are actual git repos (no `.git`), so
    // `fetchAndReset` fails for every one of them -- refreshCatalog must
    // swallow that per-remote and still return what's on disk, exactly like
    // a stale/unreachable remote shouldn't block Browse from showing
    // everything else.
    writeRegistry(['remote-a', 'remote-b']);
    writeArtifact(remoteCachePath('remote-a'), 'artifact-one');
    writeArtifact(remoteCachePath('remote-b'), 'artifact-two');

    const progressMessages: string[] = [];
    const entries = await refreshCatalog((_stage, message) => progressMessages.push(message));

    expect(entries.map((e) => e.manifest.id).sort()).toEqual(['artifact-one', 'artifact-two']);
    expect(progressMessages.some((m) => m.includes('remote-a'))).toBe(true);
    expect(progressMessages.some((m) => m.includes('remote-b'))).toBe(true);
  });

  it('returns an empty array when there are no registered remotes', async () => {
    writeRegistry([]);
    const entries = await refreshCatalog();
    expect(entries).toEqual([]);
  });
});
