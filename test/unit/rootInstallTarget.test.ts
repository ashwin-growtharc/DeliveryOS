import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pullArtifact } from '../../src/engine/pull/pull';
import { removeArtifact } from '../../src/engine/pull/removeArtifact';
import { buildCatalog, annotateCatalog } from '../../src/engine/catalog/catalog';
import { computeChangedFiles } from '../../src/engine/push/diff';
import { remotesRegistryPath, remoteCachePath, pristinePath } from '../../src/engine/paths';
import { ArtifactNotPulledError } from '../../src/engine/errors';
import { rmDirWithRetry } from '../../src/engine/execHelpers';

// A ROOT `install_target` (`"."`) is the correct shape for a scaffold artifact
// whose whole job is to drop config files at the project root -- eslint.config.js,
// .prettierrc and friends have nowhere else to live. `pullArtifact` has installed
// one correctly since adb677c, but every OTHER consumer still refused it
// (`allowRoot: false`), which left it half-supported in a way nothing tested:
// it could be pulled, then reported `not_pulled` forever, and could never be
// pushed, updated or removed.
//
// The reason those call sites refused rather than handled it is real: at the
// project root `installTarget` IS the user's entire project, so anything that
// treats it as "the artifact's own directory" either reports every unrelated
// file as artifact content or deletes the whole project. The fix is to narrow
// each operation to the artifact's actual footprint -- the top-level entries
// the payload provided, recorded in the pristine snapshot at pull time -- which
// is what these tests pin down.

let deliveryOsHome: string;
let originalEnv: string | undefined;
let cwd: string;

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-rootinstall-home-'));
  process.env.DELIVERYOS_HOME = deliveryOsHome;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-rootinstall-cwd-'));
});

afterEach(async () => {
  if (originalEnv === undefined) {
    delete process.env.DELIVERYOS_HOME;
  } else {
    process.env.DELIVERYOS_HOME = originalEnv;
  }
  await rmDirWithRetry(deliveryOsHome);
  await rmDirWithRetry(cwd);
});

function writeRegistry(): void {
  fs.mkdirSync(deliveryOsHome, { recursive: true });
  fs.writeFileSync(
    remotesRegistryPath(),
    JSON.stringify({
      remotes: [{ name: 'test-remote', url: 'https://example.invalid/test-remote', addedAt: new Date().toISOString() }],
    }),
    'utf-8',
  );
}

/** A lint/tooling scaffold: two files and one directory, all at the root. */
function writeScaffoldArtifact(): void {
  const remoteCacheDir = remoteCachePath('test-remote');
  const payloadDir = path.join(remoteCacheDir, 'artifacts', 'lint-scaffold', 'payload');
  fs.mkdirSync(path.join(payloadDir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(payloadDir, 'eslint.config.js'), 'export default [];\n', 'utf-8');
  fs.writeFileSync(path.join(payloadDir, '.prettierrc'), '{}\n', 'utf-8');
  fs.writeFileSync(path.join(payloadDir, 'config', 'rules.json'), '{"strict":true}\n', 'utf-8');
  fs.writeFileSync(
    path.join(remoteCacheDir, 'artifacts', 'lint-scaffold', 'manifest.yaml'),
    [
      'id: lint-scaffold',
      'kind: template',
      'description: ESLint + Prettier config for the project root',
      'owner: team-x',
      'version: 1.0.0',
      'source_repo: https://example.invalid/repo',
      'install_target: "."',
      'review_required: false',
      '',
    ].join('\n'),
    'utf-8',
  );
}

/** Real pre-existing project content the artifact does not own. Every test
 * asserts this survives -- it is the thing a whole-directory operation at the
 * project root would destroy or misreport. */
function seedUnrelatedProjectFiles(): void {
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src', 'index.ts'), 'export const mine = true;\n', 'utf-8');
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"users-own-project"}\n', 'utf-8');
}

function statusOf(id: string): string | undefined {
  return annotateCatalog(buildCatalog(), cwd, undefined).find((e) => e.manifest.id === id)?.localStatus;
}

describe('root install_target: catalog status', () => {
  it('reports a root-install artifact as pulled, not not_pulled, after a real pull', async () => {
    writeRegistry();
    writeScaffoldArtifact();
    seedUnrelatedProjectFiles();

    expect(statusOf('lint-scaffold')).toBe('not_pulled');

    await pullArtifact('lint-scaffold', undefined, cwd);

    // The whole point. Before the fix this stayed 'not_pulled' forever, no
    // matter how many times it was successfully pulled, because catalog.ts
    // resolved install_target with allowRoot: false and got undefined back.
    expect(statusOf('lint-scaffold')).toBe('pulled');
  }, 30_000);

  it("does not report the user's own unrelated files as local edits to the artifact", async () => {
    writeRegistry();
    writeScaffoldArtifact();
    seedUnrelatedProjectFiles();
    await pullArtifact('lint-scaffold', undefined, cwd);

    // Someone works on their own project, touching nothing the artifact owns.
    fs.writeFileSync(path.join(cwd, 'src', 'index.ts'), 'export const mine = false;\n', 'utf-8');
    fs.writeFileSync(path.join(cwd, 'src', 'brand-new.ts'), 'export const added = 1;\n', 'utf-8');
    fs.mkdirSync(path.join(cwd, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'docs', 'notes.md'), '# notes\n', 'utf-8');

    // An unscoped diff would walk the entire project and call every one of
    // those an 'added'/'modified' file belonging to the artifact.
    expect(statusOf('lint-scaffold')).toBe('pulled');
  }, 30_000);

  it("does report a real edit to one of the artifact's own root files", async () => {
    writeRegistry();
    writeScaffoldArtifact();
    seedUnrelatedProjectFiles();
    await pullArtifact('lint-scaffold', undefined, cwd);

    fs.writeFileSync(path.join(cwd, 'eslint.config.js'), 'export default [{ rules: {} }];\n', 'utf-8');

    // Narrowing the scope must not blind it to the files that ARE the artifact.
    expect(statusOf('lint-scaffold')).toBe('edited_locally');
  }, 30_000);

  it("does report an edit inside a directory the artifact owns", async () => {
    writeRegistry();
    writeScaffoldArtifact();
    await pullArtifact('lint-scaffold', undefined, cwd);

    // The scope is top-level entries, but each one is walked in full -- a file
    // added deep inside `config/` is still the artifact's business.
    fs.writeFileSync(path.join(cwd, 'config', 'extra.json'), '{}\n', 'utf-8');

    expect(statusOf('lint-scaffold')).toBe('edited_locally');
  }, 30_000);
});

describe('root install_target: remove', () => {
  it("deletes only the entries the payload provided, never the project around them", async () => {
    writeRegistry();
    writeScaffoldArtifact();
    seedUnrelatedProjectFiles();
    await pullArtifact('lint-scaffold', undefined, cwd);

    const result = await removeArtifact(cwd, 'lint-scaffold');
    expect(result.removedInstallTarget).toBe(true);
    expect(result.installTargetWarning).toBeUndefined();

    // The artifact's own footprint is gone...
    expect(fs.existsSync(path.join(cwd, 'eslint.config.js'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.prettierrc'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'config'))).toBe(false);

    // ...and the user's project is untouched. This is the assertion that the
    // old `allowRoot: false` guard existed to protect: a whole-directory
    // rmSync here would have deleted all of this.
    expect(fs.existsSync(path.join(cwd, 'src', 'index.ts'))).toBe(true);
    expect(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')).toContain('users-own-project');
    expect(fs.existsSync(cwd)).toBe(true);

    // And it really is unpulled now, not merely reported as such.
    expect(statusOf('lint-scaffold')).toBe('not_pulled');
  }, 30_000);

  it('refuses to delete anything at the project root when the pristine snapshot is missing', async () => {
    writeRegistry();
    writeScaffoldArtifact();
    seedUnrelatedProjectFiles();
    await pullArtifact('lint-scaffold', undefined, cwd);

    // A stale/pre-upgrade pull: the lockfile entry survives but the snapshot
    // that records the footprint does not. There is now no way to know which
    // root files belong to the artifact.
    fs.rmSync(pristinePath(cwd, 'lint-scaffold'), { recursive: true, force: true });

    await expect(removeArtifact(cwd, 'lint-scaffold')).rejects.toThrow(ArtifactNotPulledError);

    // Refusing means refusing: nothing was deleted, not even the artifact's
    // own files, because guessing at the project root is the one thing that
    // must never happen.
    expect(fs.existsSync(path.join(cwd, 'eslint.config.js'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'src', 'index.ts'))).toBe(true);
  }, 30_000);
});

describe('computeChangedFiles topLevelScope', () => {
  it('restricts both walks to the named top-level entries', () => {
    const installTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-scope-install-'));
    const pristine = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-scope-pristine-'));
    try {
      // Owned by the artifact, and identical on both sides.
      for (const dir of [installTarget, pristine]) {
        fs.writeFileSync(path.join(dir, 'owned.js'), 'same\n', 'utf-8');
        fs.mkdirSync(path.join(dir, 'ownedDir'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'ownedDir', 'nested.js'), 'same\n', 'utf-8');
      }
      // Present only in the "project", and none of the artifact's business.
      fs.writeFileSync(path.join(installTarget, 'unrelated.ts'), 'theirs\n', 'utf-8');

      // Unscoped, `unrelated.ts` reads as a file added to the artifact.
      expect(computeChangedFiles(installTarget, pristine).map((c) => c.relPath)).toEqual(['unrelated.ts']);

      // Scoped to the footprint, there is nothing to report.
      const scoped = computeChangedFiles(installTarget, pristine, {
        topLevelScope: ['owned.js', 'ownedDir'],
      });
      expect(scoped).toEqual([]);

      // A real change inside a scoped directory is still caught.
      fs.writeFileSync(path.join(installTarget, 'ownedDir', 'nested.js'), 'changed\n', 'utf-8');
      expect(
        computeChangedFiles(installTarget, pristine, { topLevelScope: ['owned.js', 'ownedDir'] }),
      ).toEqual([{ relPath: 'ownedDir/nested.js', status: 'modified' }]);
    } finally {
      fs.rmSync(installTarget, { recursive: true, force: true });
      fs.rmSync(pristine, { recursive: true, force: true });
    }
  });
});
