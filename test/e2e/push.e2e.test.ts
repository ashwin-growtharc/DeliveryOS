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
import { NoLocalChangesError, IdCollisionError } from '../../src/engine/errors';
import type { GithubClient } from '../../src/engine/github/github';

// This e2e test never touches the network or a real GitHub account: the
// "remote" is a real local (non-bare) git repo created by createTestRemote(),
// and every registered remote here is added with a *fake* github.com-shaped
// URL (so parseGithubUrl succeeds and owner/repo can be handed to the fake
// Octokit) while its actual clone/fetch/push traffic all goes to the real
// local fixture directory. This mirrors production exactly except for which
// URL happens to be the git transport target -- in production the two are
// the same string; here we deliberately split them apart to keep git real
// and GitHub fake.
//
// Every git operation below (clone, branch, commit, push) is the real thing,
// verified afterwards by inspecting the fixture repo directly with
// simple-git. Only the GitHub API surface (`repos.get` / `pulls.create`) is
// a vi.fn() double injected into `pushArtifact`.

const FAKE_GITHUB_URL = 'https://github.com/test-owner/test-repo.git';
const FAKE_DEFAULT_BRANCH = 'main';

type FakeOctokit = GithubClient & {
  rest: {
    repos: { get: ReturnType<typeof vi.fn> };
    pulls: { create: ReturnType<typeof vi.fn> };
  };
};

function makeFakeOctokit(): FakeOctokit {
  return {
    rest: {
      repos: {
        get: vi.fn().mockResolvedValue({ data: { default_branch: FAKE_DEFAULT_BRANCH } }),
      },
      pulls: {
        create: vi.fn().mockResolvedValue({
          data: { html_url: 'https://github.com/test-owner/test-repo/pull/1', number: 1 },
        }),
      },
    },
  };
}

/** Registers a fresh remote name (fake GitHub URL, real local clone target)
 * and clones it, so each test scenario gets its own isolated cache dir and
 * never observes branches created by another scenario. */
async function registerAndClone(name: string, fixtureRemoteDir: string): Promise<void> {
  addRemoteEntry({ name, url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
  await cloneRemote(name, fixtureRemoteDir);
}

async function branchExistsInFixture(fixtureRemoteDir: string, branchName: string): Promise<boolean> {
  const summary = await simpleGit(fixtureRemoteDir).branch(['-a']);
  return summary.all.includes(branchName);
}

describe('push e2e', () => {
  let fixtureRemoteDir: string;
  let deliveryOsHome: string;
  let scratchRoot: string;
  let originalEnv: string | undefined;

  beforeAll(async () => {
    originalEnv = process.env.DELIVERYOS_HOME;
    fixtureRemoteDir = await createTestRemote();
    deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-push-e2e-home-'));
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-push-e2e-scratch-'));
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
    'edit mode: pushes a real branch/commit and opens a PR via the edit template',
    async () => {
      const remoteName = 'test-remote-edit';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => !a.hasPostInstall && a.id === 'welcome-template')!;
      const cwd = newScratchCwd('edit');
      pullArtifact(artifact.id, remoteName, cwd);

      const installTarget = path.join(cwd, artifact.installTarget);
      fs.writeFileSync(
        path.join(installTarget, 'README.md'),
        '# welcome-template\n\nlocally edited content.\n',
        'utf-8',
      );

      const octokit = makeFakeOctokit();
      const result = await pushArtifact(artifact.id, {}, cwd, octokit);

      expect(result.branch).toMatch(
        new RegExp(`^deliveryos/${artifact.id}/\\d{14}-[0-9a-f]{4}$`),
      );

      // The branch and commit are real: verify directly against the fixture repo.
      expect(await branchExistsInFixture(fixtureRemoteDir, result.branch)).toBe(true);

      const fixtureGit = simpleGit(fixtureRemoteDir);
      const log = await fixtureGit.log([result.branch]);
      expect(log.latest?.message).toContain(artifact.id);

      const committedReadme = await fixtureGit.show([
        `${result.branch}:artifacts/${artifact.id}/payload/README.md`,
      ]);
      expect(committedReadme).toBe('# welcome-template\n\nlocally edited content.\n');

      // The fake Octokit received exactly one PR-create call, edit-template shaped.
      expect(octokit.rest.repos.get).toHaveBeenCalledTimes(1);
      expect(octokit.rest.pulls.create).toHaveBeenCalledTimes(1);
      const call = octokit.rest.pulls.create.mock.calls[0][0];
      expect(call.owner).toBe('test-owner');
      expect(call.repo).toBe('test-repo');
      expect(call.head).toBe(result.branch);
      expect(call.base).toBe(FAKE_DEFAULT_BRANCH);
      expect(call.title).toContain(artifact.id);
      expect(call.body).toContain(artifact.id);
      expect(call.body).toContain('modified: payload/README.md');
    },
    30_000,
  );

  it(
    'propose-new mode: pushes a real new branch/files and opens a PR via the propose-new template',
    async () => {
      const remoteName = 'test-remote-new';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const id = 'brand-new-artifact';
      const cwd = newScratchCwd('propose-new');

      const payloadDir = fs.mkdtempSync(path.join(scratchRoot, 'payload-'));
      fs.writeFileSync(path.join(payloadDir, 'README.md'), '# brand new artifact\n', 'utf-8');
      fs.mkdirSync(path.join(payloadDir, 'nested'), { recursive: true });
      fs.writeFileSync(path.join(payloadDir, 'nested', 'config.yaml'), 'key: value\n', 'utf-8');

      const octokit = makeFakeOctokit();
      const result = await pushArtifact(
        id,
        {
          isNew: true,
          remote: remoteName,
          payloadPath: payloadDir,
          kind: 'config',
          owner: 'platform-team',
          description: 'A brand-new test artifact',
          version: '1.0.0',
          roles: ['eng'],
        },
        cwd,
        octokit,
      );

      expect(result.branch).toMatch(new RegExp(`^deliveryos/${id}/\\d{14}-[0-9a-f]{4}$`));
      expect(await branchExistsInFixture(fixtureRemoteDir, result.branch)).toBe(true);

      const fixtureGit = simpleGit(fixtureRemoteDir);
      const manifestContent = await fixtureGit.show([
        `${result.branch}:artifacts/${id}/manifest.yaml`,
      ]);
      expect(manifestContent).toContain(`id: ${id}`);
      expect(manifestContent).toContain('kind: config');
      expect(manifestContent).toContain('owner: platform-team');

      const readmeContent = await fixtureGit.show([
        `${result.branch}:artifacts/${id}/payload/README.md`,
      ]);
      expect(readmeContent).toBe('# brand new artifact\n');

      const nestedContent = await fixtureGit.show([
        `${result.branch}:artifacts/${id}/payload/nested/config.yaml`,
      ]);
      expect(nestedContent).toBe('key: value\n');

      expect(octokit.rest.pulls.create).toHaveBeenCalledTimes(1);
      const call = octokit.rest.pulls.create.mock.calls[0][0];
      expect(call.head).toBe(result.branch);
      expect(call.base).toBe(FAKE_DEFAULT_BRANCH);
      expect(call.title).toContain(id);
      expect(call.body).toContain(id);
      expect(call.body).toContain(`artifacts/${id}/manifest.yaml`);
      expect(call.body).toContain(`artifacts/${id}/payload/README.md`);
      expect(call.body).toContain(`artifacts/${id}/payload/nested/config.yaml`);
    },
    30_000,
  );

  it(
    'propose-new mode with a PROJECT FOLDER payload excludes .git and .gitignore-matched noise (node_modules, dist)',
    async () => {
      const remoteName = 'test-remote-project-payload';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const id = 'launchpad-template';
      const cwd = newScratchCwd('propose-new-project');

      const payloadDir = fs.mkdtempSync(path.join(scratchRoot, 'project-payload-'));
      fs.writeFileSync(path.join(payloadDir, '.gitignore'), 'node_modules/\ndist/\n', 'utf-8');
      fs.writeFileSync(path.join(payloadDir, 'README.md'), '# launchpad template\n', 'utf-8');
      fs.mkdirSync(path.join(payloadDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(payloadDir, 'src', 'index.ts'), 'export {}\n', 'utf-8');
      // Noise a real project folder would actually have on disk -- none of
      // this should ever reach the remote.
      fs.mkdirSync(path.join(payloadDir, 'node_modules', 'some-dep'), { recursive: true });
      fs.writeFileSync(path.join(payloadDir, 'node_modules', 'some-dep', 'index.js'), '// vendored\n', 'utf-8');
      fs.mkdirSync(path.join(payloadDir, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(payloadDir, 'dist', 'index.js'), '// build output\n', 'utf-8');
      fs.mkdirSync(path.join(payloadDir, '.git', 'objects'), { recursive: true });
      fs.writeFileSync(path.join(payloadDir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8');

      const octokit = makeFakeOctokit();
      const result = await pushArtifact(
        id,
        {
          isNew: true,
          remote: remoteName,
          payloadPath: payloadDir,
          kind: 'template',
          owner: 'platform-team',
          description: 'A launchpad project template',
          version: '1.0.0',
        },
        cwd,
        octokit,
      );

      const call = octokit.rest.pulls.create.mock.calls[0][0];
      // The PR body's changed-files list only names what actually got
      // filtered through and copied.
      expect(call.body).toContain(`artifacts/${id}/payload/README.md`);
      expect(call.body).toContain(`artifacts/${id}/payload/src/index.ts`);
      expect(call.body).toContain(`artifacts/${id}/payload/.gitignore`);
      expect(call.body).not.toContain('node_modules');
      expect(call.body).not.toContain('dist/index.js');
      expect(call.body).not.toContain('.git/HEAD');

      const fixtureGit = simpleGit(fixtureRemoteDir);
      const committedFiles = await fixtureGit.raw([
        'ls-tree',
        '-r',
        '--name-only',
        result.branch,
        `artifacts/${id}/payload/`,
      ]);
      const committedPaths = committedFiles.trim().split('\n').filter(Boolean);
      expect(committedPaths.sort()).toEqual(
        [
          `artifacts/${id}/payload/.gitignore`,
          `artifacts/${id}/payload/README.md`,
          `artifacts/${id}/payload/src/index.ts`,
        ].sort(),
      );
    },
    30_000,
  );

  it(
    'propose-new mode with a SINGLE-FILE payload (not a directory) pushes the file correctly, not a crash',
    async () => {
      // Regression test: --path pointing at one real file (e.g. picking a
      // single .md file via the app's file picker, rather than a folder)
      // used to crash with "Cannot overwrite directory ... with
      // non-directory ..." -- fs.cpSync can't copy a file onto a path that
      // already exists as a directory (the freshly-created payload/ dir).
      const remoteName = 'test-remote-new-singlefile';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const id = 'brand-new-single-file-artifact';
      const cwd = newScratchCwd('propose-new-file');

      const payloadDir = fs.mkdtempSync(path.join(scratchRoot, 'payload-file-'));
      const payloadFile = path.join(payloadDir, 'guidelines.md');
      fs.writeFileSync(payloadFile, '# Brand Guidelines\n\nContent here.\n', 'utf-8');

      const octokit = makeFakeOctokit();
      const result = await pushArtifact(
        id,
        {
          isNew: true,
          remote: remoteName,
          payloadPath: payloadFile,
          kind: 'doc',
          owner: 'platform-team',
          description: 'Brand guidelines',
          version: '1.0.0',
        },
        cwd,
        octokit,
      );

      expect(await branchExistsInFixture(fixtureRemoteDir, result.branch)).toBe(true);

      const fixtureGit = simpleGit(fixtureRemoteDir);
      const fileContent = await fixtureGit.show([
        `${result.branch}:artifacts/${id}/payload/guidelines.md`,
      ]);
      expect(fileContent).toBe('# Brand Guidelines\n\nContent here.\n');

      const call = octokit.rest.pulls.create.mock.calls[0][0];
      expect(call.body).toContain(`artifacts/${id}/payload/guidelines.md`);
    },
    30_000,
  );

  it(
    'edit mode: hard-errors with NoLocalChangesError and creates nothing when there are zero local changes',
    async () => {
      const remoteName = 'test-remote-nochanges';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => a.id === 'lint-config')!;
      const cwd = newScratchCwd('nochanges');
      pullArtifact(artifact.id, remoteName, cwd);
      // Deliberately no edit made.

      const branchesBefore = (await simpleGit(fixtureRemoteDir).branch(['-a'])).all;

      const octokit = makeFakeOctokit();
      await expect(pushArtifact(artifact.id, {}, cwd, octokit)).rejects.toThrow(
        NoLocalChangesError,
      );

      const branchesAfter = (await simpleGit(fixtureRemoteDir).branch(['-a'])).all;
      expect(branchesAfter).toEqual(branchesBefore);
      expect(
        branchesAfter.some((b: string) => b.startsWith(`deliveryos/${artifact.id}/`)),
      ).toBe(false);

      expect(octokit.rest.repos.get).not.toHaveBeenCalled();
      expect(octokit.rest.pulls.create).not.toHaveBeenCalled();
    },
    30_000,
  );

  it(
    'cache isolation: a second push against the same cache branches off the remote default branch, not off a previous push\'s leftover branch',
    async () => {
      // Regression test for the cross-push cache contamination bug: two
      // pushes run back-to-back against the SAME cached remote clone, with
      // no fetch/reset happening in between them from any other caller.
      // Before the fix, fetchAndReset trusted whatever branch the cache's
      // HEAD was currently checked out on (left there by the first push) as
      // "the" branch to reset -- which, since that leftover branch had
      // already been pushed to the remote too, quietly "succeeded" by
      // resetting the leftover branch to itself instead of to the remote's
      // real default branch. The second push's new branch then got built on
      // top of the first push's commit, polluting its diff.
      const remoteName = 'test-remote-cache-contamination';
      await registerAndClone(remoteName, fixtureRemoteDir);

      // Discover the fixture "remote"'s real default branch name directly --
      // it's whatever `git init` produced (typically master or main
      // depending on local git config), and it never changes across this
      // test since we only ever push new deliveryos/* branches into it.
      const defaultBranch = (await simpleGit(fixtureRemoteDir).status()).current;
      expect(defaultBranch).toBeTruthy();

      // First push: an edit to artifact A (welcome-template). This is
      // allowed to run all the way to a "successful" push -- the bug
      // reproduces even when the prior push completed cleanly, since
      // nothing in between ever re-points the cache's HEAD back at the
      // default branch.
      const artifactA = TEST_ARTIFACTS.find((a) => a.id === 'welcome-template')!;
      const cwdA = newScratchCwd('contamination-a');
      pullArtifact(artifactA.id, remoteName, cwdA);
      fs.writeFileSync(
        path.join(cwdA, artifactA.installTarget, 'README.md'),
        '# welcome-template\n\nartifact A local edit.\n',
        'utf-8',
      );
      const resultA = await pushArtifact(artifactA.id, {}, cwdA, makeFakeOctokit());
      expect(await branchExistsInFixture(fixtureRemoteDir, resultA.branch)).toBe(true);

      // Second push: a completely unrelated, brand-new artifact B, against
      // the SAME cache (same remoteName => same on-disk cache dir), with no
      // intervening fetch/reset from anywhere else. This is QA's exact
      // repro shape.
      const idB = 'artifact-b-contamination-check';
      const cwdB = newScratchCwd('contamination-b');
      const payloadDirB = fs.mkdtempSync(path.join(scratchRoot, 'contamination-payload-b-'));
      fs.writeFileSync(path.join(payloadDirB, 'README.md'), '# artifact B\n', 'utf-8');

      const resultB = await pushArtifact(
        idB,
        {
          isNew: true,
          remote: remoteName,
          payloadPath: payloadDirB,
          kind: 'doc',
          owner: 'platform-team',
          description: 'Unrelated brand-new artifact pushed right after artifact A',
        },
        cwdB,
        makeFakeOctokit(),
      );
      expect(await branchExistsInFixture(fixtureRemoteDir, resultB.branch)).toBe(true);

      // The crux of the fix: diffing B's branch against the remote's real
      // default branch must show ONLY artifact B's new files -- never
      // artifact A's edit. Before the fix, this diff also contained
      // artifacts/welcome-template/payload/README.md and B's branch's parent
      // commit was A's commit rather than the default branch tip.
      const fixtureGit = simpleGit(fixtureRemoteDir);
      const diffOutput = await fixtureGit.diff([
        '--name-only',
        `${defaultBranch}..${resultB.branch}`,
      ]);
      const diffFiles = diffOutput.split('\n').map((line) => line.trim()).filter(Boolean);

      expect(diffFiles).toEqual(
        expect.arrayContaining([
          `artifacts/${idB}/manifest.yaml`,
          `artifacts/${idB}/payload/README.md`,
        ]),
      );
      expect(diffFiles.some((f) => f.startsWith(`artifacts/${artifactA.id}/`))).toBe(false);
      expect(diffFiles).toHaveLength(2);

      // Also confirm B's branch parent commit is the default branch's tip,
      // not A's commit -- the direct git-level assertion of "branched off
      // clean" rather than just "diff happens to look right".
      const defaultBranchTip = (await fixtureGit.revparse([defaultBranch])).trim();
      const bParent = (await fixtureGit.revparse([`${resultB.branch}^`])).trim();
      expect(bParent).toBe(defaultBranchTip);
    },
    30_000,
  );

  it(
    'propose-new mode: hard-errors with IdCollisionError and creates nothing when the id already exists in the remote',
    async () => {
      const remoteName = 'test-remote-collision';
      await registerAndClone(remoteName, fixtureRemoteDir);

      // 'handbook-doc' is one of the 3 artifacts seeded into every fixture
      // remote by createTestRemote() -- proposing it as new must collide.
      const collidingId = 'handbook-doc';
      const cwd = newScratchCwd('collision');

      const payloadDir = fs.mkdtempSync(path.join(scratchRoot, 'collision-payload-'));
      fs.writeFileSync(path.join(payloadDir, 'README.md'), '# should never land\n', 'utf-8');

      const branchesBefore = (await simpleGit(fixtureRemoteDir).branch(['-a'])).all;

      const octokit = makeFakeOctokit();
      await expect(
        pushArtifact(
          collidingId,
          {
            isNew: true,
            remote: remoteName,
            payloadPath: payloadDir,
            kind: 'doc',
            owner: 'someone-else',
            description: 'Attempting to re-propose an existing id',
          },
          cwd,
          octokit,
        ),
      ).rejects.toThrow(IdCollisionError);

      const branchesAfter = (await simpleGit(fixtureRemoteDir).branch(['-a'])).all;
      expect(branchesAfter).toEqual(branchesBefore);
      expect(
        branchesAfter.some((b: string) => b.startsWith(`deliveryos/${collidingId}/`)),
      ).toBe(false);

      expect(octokit.rest.repos.get).not.toHaveBeenCalled();
      expect(octokit.rest.pulls.create).not.toHaveBeenCalled();
    },
    30_000,
  );
});
