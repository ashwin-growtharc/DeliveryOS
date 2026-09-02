import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { createTestRemote, teardownTestRemote, TEST_ARTIFACTS } from '../fixtures/testRemote';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { cloneRemote } from '../../src/engine/remote/remoteCache';
import { pullArtifact } from '../../src/engine/pull/pull';
import { applyAvailableUpdates } from '../../src/engine/sync/applyUpdate';
import { readLockfile } from '../../src/engine/lockfile/lockfile';
import { computeChangedFiles } from '../../src/engine/push/diff';
import { pristinePath } from '../../src/engine/paths';

// Verifies the real gap `checkForUpdates` always left open: it only ever
// reported "installed -> available," never actually applied anything.
// These tests bump a fixture remote's real git repo directly (same
// simpleGit(fixtureRemoteDir) pattern test/e2e/sidecar.e2e.test.ts's own
// checkForUpdates test uses), then confirm applyAvailableUpdates either
// safely applies the update or clearly refuses -- never guesses.

describe('applyAvailableUpdates e2e', () => {
  let fixtureRemoteDir: string;
  let deliveryOsHome: string;
  let scratchRoot: string;
  let originalEnv: string | undefined;

  beforeAll(async () => {
    originalEnv = process.env.DELIVERYOS_HOME;
    fixtureRemoteDir = await createTestRemote();
    deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-apply-update-home-'));
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-apply-update-scratch-'));
    process.env.DELIVERYOS_HOME = deliveryOsHome;
  }, 30_000);

  afterAll(async () => {
    if (originalEnv === undefined) {
      delete process.env.DELIVERYOS_HOME;
    } else {
      process.env.DELIVERYOS_HOME = originalEnv;
    }
    await teardownTestRemote(fixtureRemoteDir);
    fs.rmSync(deliveryOsHome, { recursive: true, force: true });
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  });

  function newScratchCwd(label: string): string {
    return fs.mkdtempSync(path.join(scratchRoot, `${label}-`));
  }

  /** Bumps `artifact.id`'s version in the real fixture remote repo and
   * commits it -- same direct simpleGit(fixtureRemoteDir) pattern
   * sidecar.e2e.test.ts's own checkForUpdates test already uses. */
  async function bumpUpstreamVersion(id: string, newVersion: string): Promise<void> {
    const manifestPath = path.join(fixtureRemoteDir, 'artifacts', id, 'manifest.yaml');
    const original = fs.readFileSync(manifestPath, 'utf-8');
    const bumped = original.replace(/^version: .*$/m, `version: ${newVersion}`);
    expect(bumped).not.toBe(original);
    fs.writeFileSync(manifestPath, bumped, 'utf-8');
    const git = simpleGit(fixtureRemoteDir);
    await git.add([`artifacts/${id}/manifest.yaml`]);
    await git.commit(`bump ${id} to ${newVersion}`);
  }

  it(
    'safely applies an update with no local edits: new content lands, a removed file is actually deleted, pristine/lockfile both advance',
    async () => {
      const remoteName = 'apply-update-safe';
      addRemoteEntry({ name: remoteName, url: fixtureRemoteDir, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => a.id === 'welcome-template')!;
      const cwd = newScratchCwd('safe-update');
      await pullArtifact(artifact.id, remoteName, cwd);
      const installTarget = path.join(cwd, artifact.installTarget);

      // New version: README changes, a new file is added, nothing removed yet.
      const payloadDir = path.join(fixtureRemoteDir, 'artifacts', artifact.id, 'payload');
      fs.writeFileSync(path.join(payloadDir, 'README.md'), '# welcome-template\n\nUpdated content.\n', 'utf-8');
      fs.writeFileSync(path.join(payloadDir, 'NEW_FILE.md'), 'brand new in this version\n', 'utf-8');
      const git = simpleGit(fixtureRemoteDir);
      await git.add([`artifacts/${artifact.id}/payload`]);
      await git.commit('welcome-template: update README, add NEW_FILE.md');
      await bumpUpstreamVersion(artifact.id, '1.1.0');

      const results = await applyAvailableUpdates(cwd);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: artifact.id,
        remote: remoteName,
        previousVersion: '1.0.0',
        availableVersion: '1.1.0',
        applied: true,
      });
      expect(results[0].reason).toBeUndefined();

      expect(fs.readFileSync(path.join(installTarget, 'README.md'), 'utf-8')).toContain('Updated content.');
      expect(fs.readFileSync(path.join(installTarget, 'NEW_FILE.md'), 'utf-8')).toBe('brand new in this version\n');

      const lockfile = readLockfile(cwd);
      expect(lockfile.entries.find((e) => e.id === artifact.id)?.version).toBe('1.1.0');
      // Pristine was resynced to the new version too -- no diff against the
      // now-current install state.
      expect(computeChangedFiles(installTarget, pristinePath(cwd, artifact.id))).toEqual([]);
    },
    30_000,
  );

  it(
    'deletes a file the new version removed, not just adds/overwrites (fs.cpSync alone never does this)',
    async () => {
      const remoteName = 'apply-update-removal';
      addRemoteEntry({ name: remoteName, url: fixtureRemoteDir, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => a.id === 'lint-config')!;
      const cwd = newScratchCwd('removal-update');
      await pullArtifact(artifact.id, remoteName, cwd);
      const installTarget = path.join(cwd, artifact.installTarget);
      expect(fs.existsSync(path.join(installTarget, 'README.md'))).toBe(true);

      // New version removes README.md entirely, replacing it with a
      // differently-named file.
      const payloadDir = path.join(fixtureRemoteDir, 'artifacts', artifact.id, 'payload');
      fs.rmSync(path.join(payloadDir, 'README.md'));
      fs.writeFileSync(path.join(payloadDir, 'RENAMED.md'), 'this replaced README.md\n', 'utf-8');
      const git = simpleGit(fixtureRemoteDir);
      await git.add([`artifacts/${artifact.id}/payload`]);
      await git.commit('lint-config: rename README.md to RENAMED.md');
      await bumpUpstreamVersion(artifact.id, '2.0.0');

      const results = await applyAvailableUpdates(cwd);
      expect(results).toHaveLength(1);
      expect(results[0].applied).toBe(true);

      expect(fs.existsSync(path.join(installTarget, 'README.md'))).toBe(false);
      expect(fs.readFileSync(path.join(installTarget, 'RENAMED.md'), 'utf-8')).toBe('this replaced README.md\n');
    },
    30_000,
  );

  it(
    're-runs post_install on update and reports its output, still advancing pristine/lockfile',
    async () => {
      const remoteName = 'apply-update-postinstall';
      addRemoteEntry({ name: remoteName, url: fixtureRemoteDir, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => a.hasPostInstall)!;
      const cwd = newScratchCwd('postinstall-update');
      await pullArtifact(artifact.id, remoteName, cwd);
      const installTarget = path.join(cwd, artifact.installTarget);

      // Deliberately does NOT delete the first pull's own .post_install_ran
      // marker -- that file is part of the pristine snapshot too (taken
      // AFTER post_install runs, see pullArtifact's own doc comment), so
      // deleting it from installTarget alone would look like a genuine
      // local deletion and make this test's own update get refused for
      // "local edits." postInstallOutput actually containing the real
      // console.log output below is sufficient proof post_install re-ran.
      await bumpUpstreamVersion(artifact.id, '1.1.0');

      const results = await applyAvailableUpdates(cwd);
      expect(results).toHaveLength(1);
      expect(results[0].applied).toBe(true);
      expect(results[0].postInstallOutput).toContain(`post_install ran for ${artifact.id}`);
      expect(fs.existsSync(path.join(installTarget, '.post_install_ran'))).toBe(true);

      const lockfile = readLockfile(cwd);
      expect(lockfile.entries.find((e) => e.id === artifact.id)?.version).toBe('1.1.0');
    },
    30_000,
  );

  it(
    'refuses to update an artifact with local edits, touching nothing -- reports why instead of guessing',
    async () => {
      const remoteName = 'apply-update-local-edit';
      addRemoteEntry({ name: remoteName, url: fixtureRemoteDir, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => a.id === 'welcome-template')!;
      const cwd = newScratchCwd('local-edit-update');
      // Pulled BEFORE the version bump below -- fixtureRemoteDir keeps
      // evolving across this file's earlier tests, so a fresh pull always
      // gets whatever is currently latest; the only way to get a
      // genuinely-outdated pulled artifact is to bump AFTER pulling, in
      // this same test.
      await pullArtifact(artifact.id, remoteName, cwd);
      const installTarget = path.join(cwd, artifact.installTarget);

      // A genuine local edit, made AFTER the pull above.
      fs.writeFileSync(path.join(installTarget, 'README.md'), '# my own local edit\n', 'utf-8');

      await bumpUpstreamVersion(artifact.id, '9.0.0');

      const results = await applyAvailableUpdates(cwd);
      expect(results).toHaveLength(1);
      expect(results[0].applied).toBe(false);
      expect(results[0].reason).toContain('local change');
      expect(results[0].reason).toContain('refusing to auto-update');

      // Untouched: the local edit survives exactly as written, and the
      // lockfile still records the OLD version.
      expect(fs.readFileSync(path.join(installTarget, 'README.md'), 'utf-8')).toBe('# my own local edit\n');
      const lockfile = readLockfile(cwd);
      expect(lockfile.entries.find((e) => e.id === artifact.id)?.version).toBe('1.1.0');
    },
    30_000,
  );

  it(
    'reports an empty result for a project with nothing outdated',
    async () => {
      const remoteName = 'apply-update-none';
      addRemoteEntry({ name: remoteName, url: fixtureRemoteDir, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => a.id === 'handbook-doc')!;
      const cwd = newScratchCwd('no-update');
      await pullArtifact(artifact.id, remoteName, cwd);

      const results = await applyAvailableUpdates(cwd);
      expect(results).toEqual([]);
    },
    30_000,
  );

  it(
    'onlyId scopes the batch to a single artifact, even when others in the same project are also outdated',
    async () => {
      const remoteName = 'apply-update-scoped';
      addRemoteEntry({ name: remoteName, url: fixtureRemoteDir, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const a = TEST_ARTIFACTS.find((x) => x.id === 'welcome-template')!;
      const b = TEST_ARTIFACTS.find((x) => x.id === 'lint-config')!;
      const cwd = newScratchCwd('scoped-update');
      // Pulled BEFORE bumping (see the local-edits test above for why) --
      // both are genuinely outdated relative to this fresh pull once
      // bumped again below.
      await pullArtifact(a.id, remoteName, cwd);
      await pullArtifact(b.id, remoteName, cwd);
      await bumpUpstreamVersion(a.id, '9.1.0');
      await bumpUpstreamVersion(b.id, '9.1.0');

      const results = await applyAvailableUpdates(cwd, undefined, a.id);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(a.id);
    },
    30_000,
  );
  it(
    'applies an update for a src/-prefixed artifact in a project that does not use src/ -- the relocation guard used to refuse every such update, forever',
    async () => {
      // pullArtifact records the adaptSrcDirPath-SHORTENED target in the
      // lockfile (`lib/thing`), but applyUpdate re-derived it RAW from the
      // manifest (`src/lib/thing`). The two never matched, so the relocation
      // guard fired on every update with a message blaming the artifact for a
      // move that never happened.
      //
      // The root `app/` directory below is what makes this reproduce at all:
      // adaptSrcDirPath only shortens when it can see an app/ or pages/ dir.
      // In an empty project it returns undefined, both sides fall back to the
      // manifest's literal value, they agree, and the bug is invisible. That
      // is why no existing fixture caught this -- none uses a src/ prefix.
      const remoteName = 'apply-update-srcdir';
      const artifactId = 'src-target-artifact';

      const artifactDir = path.join(fixtureRemoteDir, 'artifacts', artifactId);
      fs.mkdirSync(path.join(artifactDir, 'payload'), { recursive: true });
      fs.writeFileSync(path.join(artifactDir, 'payload', 'README.md'), 'v1\n', 'utf-8');
      fs.writeFileSync(
        path.join(artifactDir, 'manifest.yaml'),
        [
          `id: ${artifactId}`,
          'kind: doc',
          'description: Declares a src/-prefixed install_target',
          'owner: team-x',
          'version: 1.0.0',
          'source_repo: https://example.invalid/repo',
          'install_target: src/lib/thing',
          'review_required: false',
          '',
        ].join('\n'),
        'utf-8',
      );
      const git = simpleGit(fixtureRemoteDir);
      await git.add([`artifacts/${artifactId}`]);
      await git.commit(`add ${artifactId}`);

      addRemoteEntry({ name: remoteName, url: fixtureRemoteDir, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const cwd = newScratchCwd('srcdir-update');
      // An app-router-shaped project: has app/, has no src/.
      fs.mkdirSync(path.join(cwd, 'app'), { recursive: true });

      const pulled = await pullArtifact(artifactId, remoteName, cwd);
      // Precondition, not the assertion under test: if this landed in
      // src/lib/thing then adaptSrcDirPath did not shorten and the rest of
      // this test proves nothing.
      expect(pulled.installTarget).toBe(path.join(cwd, 'lib', 'thing'));
      expect(fs.existsSync(path.join(cwd, 'src'))).toBe(false);

      fs.writeFileSync(path.join(artifactDir, 'payload', 'README.md'), 'v2 updated\n', 'utf-8');
      await git.add([`artifacts/${artifactId}`]);
      await git.commit(`edit ${artifactId} payload`);
      await bumpUpstreamVersion(artifactId, '1.1.0');
      // No re-clone: applyAvailableUpdates calls refreshRemoteCache itself.

      const results = await applyAvailableUpdates(cwd);
      const result = results.find((r) => r.id === artifactId);

      expect(result).toBeDefined();
      expect(result!.reason).toBeUndefined();
      expect(result!.applied).toBe(true);

      // The update is real, and it did NOT quietly create a second copy under
      // src/ -- that would be a different bug, not this fix.
      expect(fs.readFileSync(path.join(cwd, 'lib', 'thing', 'README.md'), 'utf-8')).toBe('v2 updated\n');
      expect(fs.existsSync(path.join(cwd, 'src'))).toBe(false);
      const entry = readLockfile(cwd).entries.find((e) => e.id === artifactId);
      expect(entry?.version).toBe('1.1.0');
      expect(entry?.installTarget).toBe(path.join(cwd, 'lib', 'thing'));
    },
    30_000,
  );

  it(
    'still refuses an update that GENUINELY relocates install_target, so the fix above did not just delete the guard',
    async () => {
      const remoteName = 'apply-update-real-move';
      const artifactId = 'relocating-artifact';

      const artifactDir = path.join(fixtureRemoteDir, 'artifacts', artifactId);
      fs.mkdirSync(path.join(artifactDir, 'payload'), { recursive: true });
      fs.writeFileSync(path.join(artifactDir, 'payload', 'README.md'), 'v1\n', 'utf-8');
      const manifest = (version: string, target: string): string =>
        [
          `id: ${artifactId}`,
          'kind: doc',
          'description: Moves its install_target between versions',
          'owner: team-x',
          `version: ${version}`,
          'source_repo: https://example.invalid/repo',
          `install_target: ${target}`,
          'review_required: false',
          '',
        ].join('\n');
      fs.writeFileSync(path.join(artifactDir, 'manifest.yaml'), manifest('1.0.0', 'src/lib/moving'), 'utf-8');
      const git = simpleGit(fixtureRemoteDir);
      await git.add([`artifacts/${artifactId}`]);
      await git.commit(`add ${artifactId}`);

      addRemoteEntry({ name: remoteName, url: fixtureRemoteDir, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const cwd = newScratchCwd('real-move');
      fs.mkdirSync(path.join(cwd, 'app'), { recursive: true });
      await pullArtifact(artifactId, remoteName, cwd);

      // A DIFFERENT manifest string, not the same one spelled two ways.
      fs.writeFileSync(path.join(artifactDir, 'manifest.yaml'), manifest('1.1.0', 'vendor/moving'), 'utf-8');
      await git.add([`artifacts/${artifactId}`]);
      await git.commit(`relocate ${artifactId}`);

      const results = await applyAvailableUpdates(cwd);
      const result = results.find((r) => r.id === artifactId);

      expect(result?.applied).toBe(false);
      expect(result?.reason).toContain('moved install_target');
      expect(fs.existsSync(path.join(cwd, 'vendor'))).toBe(false);
    },
    30_000,
  );

  it(
    'reports (never silently skips) an artifact whose id is no longer in its remote catalog',
    async () => {
      // ApplyUpdateResult.reason is documented as "Always set when applied is
      // false -- a person should never see a silent no-op." The !match branch
      // was the one place in this loop that used a bare `continue` instead of
      // report(), so `check-updates --apply` printed "No updates available."
      // for a project whose artifact had actually vanished upstream.
      const remoteName = 'apply-update-vanished';
      const artifactId = 'vanishing-artifact';

      const artifactDir = path.join(fixtureRemoteDir, 'artifacts', artifactId);
      fs.mkdirSync(path.join(artifactDir, 'payload'), { recursive: true });
      fs.writeFileSync(path.join(artifactDir, 'payload', 'README.md'), 'v1\n', 'utf-8');
      fs.writeFileSync(
        path.join(artifactDir, 'manifest.yaml'),
        [
          `id: ${artifactId}`,
          'kind: doc',
          'description: Removed from its remote after being pulled',
          'owner: team-x',
          'version: 1.0.0',
          'source_repo: https://example.invalid/repo',
          'install_target: vanishing',
          'review_required: false',
          '',
        ].join('\n'),
        'utf-8',
      );
      const git = simpleGit(fixtureRemoteDir);
      await git.add([`artifacts/${artifactId}`]);
      await git.commit(`add ${artifactId}`);

      addRemoteEntry({ name: remoteName, url: fixtureRemoteDir, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const cwd = newScratchCwd('vanished');
      await pullArtifact(artifactId, remoteName, cwd);

      // Gone upstream, exactly as if someone deleted it from the catalog repo.
      fs.rmSync(artifactDir, { recursive: true, force: true });
      await git.add(['-A', `artifacts/${artifactId}`]);
      await git.commit(`remove ${artifactId}`);

      const results = await applyAvailableUpdates(cwd, undefined, artifactId);

      // Used to be `[]` -- indistinguishable from "everything is up to date".
      expect(results).toHaveLength(1);
      expect(results[0].applied).toBe(false);
      expect(results[0].reason).toContain('no longer in remote');
      // No upstream version exists, so none is claimed. Echoing
      // previousVersion here would read as "1.0.0 -> 1.0.0 available".
      expect(results[0].availableVersion).toBeUndefined();
    },
    30_000,
  );

  it(
    'still omits an already-current artifact entirely -- the OTHER bare continue is intentional and stays',
    async () => {
      // Guard against "fixing" the second bare continue too. A bulk
      // `check-updates --apply` should stay focused on real updates rather
      // than restating every already-current artifact.
      const remoteName = 'apply-update-current';
      addRemoteEntry({ name: remoteName, url: fixtureRemoteDir, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => a.id === 'lint-config')!;
      const cwd = newScratchCwd('already-current');
      await pullArtifact(artifact.id, remoteName, cwd);

      const results = await applyAvailableUpdates(cwd, undefined, artifact.id);

      expect(results).toEqual([]);
    },
    30_000,
  );

});
