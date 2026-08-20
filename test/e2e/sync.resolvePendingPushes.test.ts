import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createTestRemote, teardownTestRemote, TEST_ARTIFACTS } from '../fixtures/testRemote';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { cloneRemote } from '../../src/engine/remote/remoteCache';
import { pullArtifact } from '../../src/engine/pull/pull';
import { pushArtifact } from '../../src/engine/push/push';
import { resolvePendingPushes } from '../../src/engine/sync/sync';
import { readLockfile } from '../../src/engine/lockfile/lockfile';
import { computeChangedFiles } from '../../src/engine/push/diff';
import { pristinePath } from '../../src/engine/paths';
import type { GithubClient } from '../../src/engine/github/github';

// Verifies the "transparency about a push" feature end to end against a
// real local git fixture: push an edit (real branch/commit/push, fake PR
// creation), confirm the lockfile records pendingPr, then confirm
// resolvePendingPushes correctly reflects whatever the (fake) GitHub API
// says that PR's real state is -- merged (resyncs pristine so
// edited_locally correctly resolves back to pulled), still open (leaves
// everything untouched), or closed-without-merging (clears pendingPr but
// leaves the local edit as-is). No real network/GitHub access anywhere.

const FAKE_GITHUB_URL = 'https://github.com/test-owner/test-repo.git';

function makeFakeOctokit(overrides: {
  pullsGet?: ReturnType<typeof vi.fn>;
}): GithubClient {
  return {
    rest: {
      repos: { get: vi.fn().mockResolvedValue({ data: { default_branch: 'main' } }) },
      pulls: {
        create: vi
          .fn()
          .mockResolvedValue({ data: { html_url: 'https://github.com/test-owner/test-repo/pull/7', number: 7 } }),
        get:
          overrides.pullsGet
          ?? vi.fn().mockResolvedValue({ data: { state: 'open', merged: false, html_url: 'https://x/pull/7' } }),
      },
    },
  } as unknown as GithubClient;
}

describe('sync.resolvePendingPushes e2e', () => {
  let fixtureRemoteDir: string;
  let deliveryOsHome: string;
  let scratchRoot: string;
  let originalEnv: string | undefined;

  beforeAll(async () => {
    originalEnv = process.env.DELIVERYOS_HOME;
    fixtureRemoteDir = await createTestRemote();
    deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-resolve-pr-home-'));
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-resolve-pr-scratch-'));
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

  it(
    'push records a pendingPr; resolvePendingPushes on a MERGED PR resyncs pristine so edited_locally resolves back to pulled',
    async () => {
      const remoteName = 'test-remote-merged';
      await addRemoteEntry({ name: remoteName, url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => !a.hasPostInstall && a.id === 'welcome-template')!;
      const cwd = newScratchCwd('merged');
      await pullArtifact(artifact.id, remoteName, cwd);

      const installTarget = path.join(cwd, artifact.installTarget);
      fs.writeFileSync(path.join(installTarget, 'README.md'), '# edited for merge test\n', 'utf-8');

      // Sanity check: really is edited_locally right now.
      expect(computeChangedFiles(installTarget, pristinePath(cwd, artifact.id)).length).toBeGreaterThan(0);

      await pushArtifact(artifact.id, {}, cwd, makeFakeOctokit({}));

      const afterPush = readLockfile(cwd).entries.find((e) => e.id === artifact.id);
      expect(afterPush?.pendingPr).toEqual({ number: 7, url: 'https://github.com/test-owner/test-repo/pull/7' });

      const mergedOctokit = makeFakeOctokit({
        pullsGet: vi.fn().mockResolvedValue({
          data: { state: 'closed', merged: true, html_url: 'https://github.com/test-owner/test-repo/pull/7' },
        }),
      });
      const results = await resolvePendingPushes(cwd, undefined, mergedOctokit);

      expect(results).toEqual([
        {
          id: artifact.id,
          remote: remoteName,
          prNumber: 7,
          prUrl: 'https://github.com/test-owner/test-repo/pull/7',
          state: 'closed',
          merged: true,
        },
      ]);

      const afterResolve = readLockfile(cwd).entries.find((e) => e.id === artifact.id);
      expect(afterResolve?.pendingPr).toBeUndefined();

      // Real, confirmed regression: this branch used to write a bare
      // {id, version, remote} object instead of spreading the existing
      // entry, silently dropping installTarget (and wiredFiles, for an
      // artifact that has any) the moment a pushed edit's PR got merged --
      // removeArtifact would then treat this as an old-shape entry with no
      // recorded install location at all.
      expect(afterResolve?.installTarget).toBe(installTarget);

      // The whole point: edited_locally must now resolve back to "no diff"
      // since the pristine snapshot was resynced from the (now-merged) edit.
      expect(computeChangedFiles(installTarget, pristinePath(cwd, artifact.id))).toEqual([]);
    },
    30_000,
  );

  it(
    'resolvePendingPushes on a still-OPEN PR leaves pendingPr and the local edit untouched',
    async () => {
      const remoteName = 'test-remote-open';
      await addRemoteEntry({ name: remoteName, url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => !a.hasPostInstall && a.id === 'lint-config')!;
      const cwd = newScratchCwd('open');
      await pullArtifact(artifact.id, remoteName, cwd);
      const installTarget = path.join(cwd, artifact.installTarget);
      fs.writeFileSync(path.join(installTarget, 'README.md'), '# edited, PR still open\n', 'utf-8');

      await pushArtifact(artifact.id, {}, cwd, makeFakeOctokit({}));
      expect(readLockfile(cwd).entries.find((e) => e.id === artifact.id)?.pendingPr).toBeDefined();

      const openOctokit = makeFakeOctokit({
        pullsGet: vi.fn().mockResolvedValue({
          data: { state: 'open', merged: false, html_url: 'https://github.com/test-owner/test-repo/pull/7' },
        }),
      });
      const results = await resolvePendingPushes(cwd, undefined, openOctokit);

      expect(results).toEqual([
        {
          id: artifact.id,
          remote: remoteName,
          prNumber: 7,
          prUrl: 'https://github.com/test-owner/test-repo/pull/7',
          state: 'open',
          merged: false,
        },
      ]);

      // Still open -> nothing resynced, pendingPr still tracked, local
      // edit still genuinely diverged from pristine.
      expect(readLockfile(cwd).entries.find((e) => e.id === artifact.id)?.pendingPr).toEqual({
        number: 7,
        url: 'https://github.com/test-owner/test-repo/pull/7',
      });
      expect(computeChangedFiles(installTarget, pristinePath(cwd, artifact.id)).length).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    'resolvePendingPushes on a CLOSED (rejected, not merged) PR clears pendingPr but leaves the local edit as-is',
    async () => {
      const remoteName = 'test-remote-rejected';
      await addRemoteEntry({ name: remoteName, url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => !a.hasPostInstall && a.id === 'welcome-template')!;
      const cwd = newScratchCwd('rejected');
      await pullArtifact(artifact.id, remoteName, cwd);
      const installTarget = path.join(cwd, artifact.installTarget);
      fs.writeFileSync(path.join(installTarget, 'README.md'), '# edited, PR will be rejected\n', 'utf-8');

      await pushArtifact(artifact.id, {}, cwd, makeFakeOctokit({}));

      const closedOctokit = makeFakeOctokit({
        pullsGet: vi.fn().mockResolvedValue({
          data: { state: 'closed', merged: false, html_url: 'https://github.com/test-owner/test-repo/pull/7' },
        }),
      });
      const results = await resolvePendingPushes(cwd, undefined, closedOctokit);

      expect(results[0]).toEqual({
        id: artifact.id,
        remote: remoteName,
        prNumber: 7,
        prUrl: 'https://github.com/test-owner/test-repo/pull/7',
        state: 'closed',
        merged: false,
      });

      // Rejected: nothing left to track, but the divergence is real and
      // must NOT be silently erased.
      expect(readLockfile(cwd).entries.find((e) => e.id === artifact.id)?.pendingPr).toBeUndefined();
      expect(computeChangedFiles(installTarget, pristinePath(cwd, artifact.id)).length).toBeGreaterThan(0);
    },
    30_000,
  );
});
