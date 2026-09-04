import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildCatalog,
  annotateCatalog,
  buildCatalogWithSkipped,
  CatalogEntry,
} from '../../src/engine/catalog/catalog';
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

describe('annotateCatalog', () => {
  function fakeEntry(installTarget: string): CatalogEntry {
    return {
      remoteName: 'test-remote',
      manifest: {
        id: 'evil-artifact',
        kind: 'config',
        description: 'test',
        owner: 'team-x',
        version: '1.0.0',
        tags: { roles: [], teams: [], stacks: [], componentTypes: [] },
        source_repo: 'https://example.invalid/repo',
        install_target: installTarget,
        review_required: false,
        install_params: [],
        wiring_actions: [],
      },
    };
  }

  it('does not resolve a crafted install_target outside the project -- reports not_pulled instead of a path escaping cwd', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-annotate-catalog-'));
    try {
      const entries = annotateCatalog([fakeEntry('../../../../outside')], cwd, undefined);
      expect(entries).toHaveLength(1);
      expect(entries[0].localStatus).toBe('not_pulled');
      // Never silently resolved to the real (escaping) absolute path --
      // callers (the app's "Open folder"/Detail "installs to" display)
      // must never be handed a path outside the project to act on.
      expect(entries[0].installTarget).not.toContain(cwd);
      expect(path.isAbsolute(entries[0].installTarget)).toBe(false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('one crafted install_target does not break annotating the rest of the catalog', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-annotate-catalog-'));
    try {
      const goodEntry = fakeEntry('some/real/target');
      goodEntry.manifest.id = 'good-artifact';
      const entries = annotateCatalog(
        [fakeEntry('../../../../outside'), goodEntry],
        cwd,
        undefined,
      );
      expect(entries).toHaveLength(2);
      const good = entries.find((e) => e.manifest.id === 'good-artifact');
      expect(good?.localStatus).toBe('not_pulled');
      expect(good?.installTarget).toBe(path.resolve(cwd, 'some/real/target'));
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('buildCatalogWithSkipped', () => {
  function writeRegistry(names: string[]): void {
    fs.mkdirSync(deliveryOsHome, { recursive: true });
    fs.writeFileSync(
      remotesRegistryPath(),
      JSON.stringify({
        remotes: names.map((name) => ({
          name,
          url: `https://example.invalid/${name}`,
          addedAt: new Date().toISOString(),
        })),
      }),
      'utf-8',
    );
  }

  function writeBrokenArtifact(remoteCacheDir: string, id: string): void {
    const artifactDir = path.join(remoteCacheDir, 'artifacts', id);
    fs.mkdirSync(path.join(artifactDir, 'payload'), { recursive: true });
    // Valid YAML, invalid manifest -- `kind` and every other required field
    // missing, so schema validation rejects it and parser.ts skips it.
    fs.writeFileSync(path.join(artifactDir, 'manifest.yaml'), `id: ${id}\n`, 'utf-8');
  }

  it('returns the skipped manifests alongside the catalog, so no caller has to drain shared state', () => {
    writeRegistry(['test-remote']);
    const cacheDir = remoteCachePath('test-remote');
    writeArtifact(cacheDir, 'good-artifact', 'doc');
    writeBrokenArtifact(cacheDir, 'broken-artifact');

    const built = buildCatalogWithSkipped();

    expect(built.entries.map((e) => e.manifest.id)).toEqual(['good-artifact']);
    expect(built.skipped).toHaveLength(1);
    expect(built.skipped[0].remoteName).toBe('test-remote');
    expect(built.skipped[0].path).toContain('broken-artifact');
  });

  it('gives every build its OWN list, so two overlapping builds cannot steal from each other', () => {
    // The whole reason the module-level record was removed. It was safe only
    // because the Tauri host spawns one process per RPC; a long-lived process
    // (an MCP server) removes that mask, and refreshCatalog awaits before
    // building -- so one call could drain another's list and report a broken
    // catalog as a clean one.
    writeRegistry(['test-remote']);
    const cacheDir = remoteCachePath('test-remote');
    writeBrokenArtifact(cacheDir, 'broken-artifact');

    const first = buildCatalogWithSkipped();
    const second = buildCatalogWithSkipped();

    expect(first.skipped).toHaveLength(1);
    // Reading the second build must not have emptied the first.
    expect(second.skipped).toHaveLength(1);
    expect(first.skipped).not.toBe(second.skipped);
  });
});
