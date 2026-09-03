import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { createTestRemote, teardownTestRemote, TEST_ARTIFACTS } from '../fixtures/testRemote';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { cloneRemote } from '../../src/engine/remote/remoteCache';
import { pullArtifact } from '../../src/engine/pull/pull';
import { pushArtifact } from '../../src/engine/push/push';
import { planPush } from '../../src/engine/push/planPush';
import { NoLocalChangesError } from '../../src/engine/errors';
import type { GithubClient } from '../../src/engine/github/github';

/**
 * The anti-drift guard that justifies `planPush` existing separately.
 *
 * `planPush` deliberately does NOT refactor `pushArtifact`. Extracting
 * `push.ts:487-679` into a shared helper would be tidier, but that function's
 * own comments record a bug that opened a PR *deleting an artifact's entire
 * payload* on a shared remote -- it is the last place in this codebase where a
 * clever refactor is worth the risk.
 *
 * The cost of that choice is two implementations of the same decision, which
 * this repo has already been bitten by four times over (`hasWiring` in four
 * places, tag lowercasing in three, `remote add` orchestration in two). So the
 * cost is paid here instead: these tests assert that what the preview PROMISES
 * is exactly what a real push COMMITS. If the two ever diverge, this fails --
 * rather than a pull request being silently wrong on a shared remote.
 */

const FAKE_GITHUB_URL = 'https://github.com/test-owner/test-repo.git';

function makeFakeOctokit(): GithubClient {
  return {
    rest: {
      repos: {
        get: vi.fn().mockResolvedValue({ data: { default_branch: 'main', private: false } }),
      },
      pulls: {
        create: vi.fn().mockResolvedValue({
          data: { html_url: 'https://github.com/test-owner/test-repo/pull/1', number: 1 },
        }),
      },
    },
  } as unknown as GithubClient;
}

describe('planPush matches what a real push commits', () => {
  let fixtureRemoteDir: string;
  let deliveryOsHome: string;
  let scratchRoot: string;
  let originalEnv: string | undefined;

  beforeAll(async () => {
    originalEnv = process.env.DELIVERYOS_HOME;
    fixtureRemoteDir = await createTestRemote();
    deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-planpush-home-'));
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-planpush-scratch-'));
    process.env.DELIVERYOS_HOME = deliveryOsHome;
  }, 30_000);

  afterAll(async () => {
    if (originalEnv === undefined) delete process.env.DELIVERYOS_HOME;
    else process.env.DELIVERYOS_HOME = originalEnv;
    await teardownTestRemote(fixtureRemoteDir);
    fs.rmSync(deliveryOsHome, { recursive: true, force: true });
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  });

  const newScratchCwd = (label: string) => fs.mkdtempSync(path.join(scratchRoot, `${label}-`));

  async function registerAndClone(name: string): Promise<void> {
    await addRemoteEntry({ name, url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
    await cloneRemote(name, fixtureRemoteDir);
  }

  it(
    'promises exactly the files the push then commits -- added, modified and deleted',
    async () => {
      const remoteName = 'planpush-equivalence';
      await registerAndClone(remoteName);
      const cwd = newScratchCwd('equivalence');
      const artifact = TEST_ARTIFACTS.find((a) => a.id === 'welcome-template')!;

      await pullArtifact(artifact.id, remoteName, cwd);
      const installTarget = path.resolve(cwd, artifact.installTarget);

      // One of each kind of change, so the comparison covers all three
      // statuses rather than only `modified`.
      const existing = fs.readdirSync(installTarget).find((f) => f.endsWith('.md'))!;
      fs.appendFileSync(path.join(installTarget, existing), '\nedited by the equivalence test\n');
      fs.writeFileSync(path.join(installTarget, 'BRAND-NEW.md'), '# added\n', 'utf-8');
      const toDelete = fs.readdirSync(installTarget).find((f) => f !== existing && f !== 'BRAND-NEW.md');
      if (toDelete) fs.rmSync(path.join(installTarget, toDelete), { recursive: true, force: true });

      // THE PREVIEW -- taken before anything is pushed.
      const plan = planPush(artifact.id, cwd);
      expect(plan.mode).toBe('edit');
      expect(plan.changedFiles.length).toBeGreaterThan(0);

      const octokit = makeFakeOctokit();
      const result = await pushArtifact(artifact.id, {}, cwd, octokit);

      // THE REALITY -- what the push actually committed on its branch.
      const git = simpleGit(fixtureRemoteDir);
      const committed = (await git.raw(['show', '--name-status', '--format=', result.branch]))
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      // Every file the preview promised must appear in the commit. Compared on
      // basename because the preview reports project-relative paths while the
      // commit reports repo-relative ones -- the point is the SET, not the
      // prefix.
      for (const change of plan.changedFiles) {
        const base = path.basename(change.relPath);
        expect(
          committed.some((line) => line.includes(base)),
          `preview promised ${change.status} ${change.relPath}, but the push did not commit it`,
        ).toBe(true);
      }

      // And nothing the preview did NOT promise was committed. This is the
      // direction that matters: a push touching a file the user was never
      // shown is exactly the risk-register scenario.
      const promised = new Set(plan.changedFiles.map((c) => path.basename(c.relPath)));
      for (const line of committed) {
        const committedFile = path.basename(line.split(/\s+/).pop() ?? '');
        if (committedFile === 'manifest.yaml') continue; // version bump, always
        expect(
          promised.has(committedFile),
          `the push committed ${committedFile}, which the preview never promised`,
        ).toBe(true);
      }
    },
    60_000,
  );

  it('predicts the same version bump the push applies', async () => {
    const remoteName = 'planpush-version';
    await registerAndClone(remoteName);
    const cwd = newScratchCwd('version');
    const artifact = TEST_ARTIFACTS.find((a) => a.id === 'lint-config')!;

    await pullArtifact(artifact.id, remoteName, cwd);
    const installTarget = path.resolve(cwd, artifact.installTarget);
    fs.writeFileSync(path.join(installTarget, 'note.md'), '# change\n', 'utf-8');

    const plan = planPush(artifact.id, cwd);
    expect(plan.previousVersion).toBe('1.0.0');
    expect(plan.newVersion).toBe('1.0.1');

    const octokit = makeFakeOctokit();
    await pushArtifact(artifact.id, {}, cwd, octokit);

    const body = (octokit.rest.pulls.create as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].body as string;
    expect(body).toContain('v1.0.0');
    expect(body).toContain('v1.0.1');
  }, 60_000);

  it('refuses for the same reasons a push refuses, before touching anything', async () => {
    // A preview that succeeded where a push would refuse would be worse than
    // no preview: it would promise an outcome that cannot happen.
    const remoteName = 'planpush-refusals';
    await registerAndClone(remoteName);
    const cwd = newScratchCwd('refusals');
    const artifact = TEST_ARTIFACTS.find((a) => a.id === 'handbook-doc')!;

    // Untracked -- no lockfile entry at all.
    expect(() => planPush('definitely-not-pulled', cwd)).toThrow(/not tracked/);

    // Pulled but unmodified.
    await pullArtifact(artifact.id, remoteName, cwd);
    expect(() => planPush(artifact.id, cwd)).toThrow(NoLocalChangesError);

    // And the real push agrees, which is the property under test.
    await expect(pushArtifact(artifact.id, {}, cwd, makeFakeOctokit())).rejects.toThrow(
      NoLocalChangesError,
    );
  }, 60_000);

  it('reports a pending PR, because it silently disables the stale-push guard', async () => {
    // `push.ts:624` reads `pendingPr` as `hasOwnPushInFlight` and skips the
    // staleness check entirely. A caller deciding whether to push deserves to
    // know that a guard is currently off, and nothing else surfaces it.
    const remoteName = 'planpush-pending';
    await registerAndClone(remoteName);
    const cwd = newScratchCwd('pending');
    const artifact = TEST_ARTIFACTS.find((a) => a.id === 'welcome-template')!;

    await pullArtifact(artifact.id, remoteName, cwd);
    const installTarget = path.resolve(cwd, artifact.installTarget);
    fs.writeFileSync(path.join(installTarget, 'first.md'), '# first\n', 'utf-8');

    expect(planPush(artifact.id, cwd).pendingPr).toBeUndefined();

    await pushArtifact(artifact.id, {}, cwd, makeFakeOctokit());

    fs.writeFileSync(path.join(installTarget, 'second.md'), '# second\n', 'utf-8');
    const after = planPush(artifact.id, cwd);
    expect(after.pendingPr).toEqual({
      number: 1,
      url: 'https://github.com/test-owner/test-repo/pull/1',
    });
  }, 60_000);
});
