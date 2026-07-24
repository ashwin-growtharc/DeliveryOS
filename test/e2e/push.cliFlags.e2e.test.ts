import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { createTestRemote, teardownTestRemote } from '../fixtures/testRemote';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { cloneRemote } from '../../src/engine/remote/remoteCache';

// Regression test for the `--new --version <semver>` silent no-op bug: the
// push subcommand's own `--version` flag collided with Commander's reserved
// top-level `-V/--version` (registered by `program.version(...)` in
// src/cli/program.ts), so passing `--version` on the CLI was silently
// swallowed by Commander's global version handling -- it printed the CLI's
// own package version and exited 0 *before ever reaching the push action at
// all*, doing zero git/GitHub work. Directly calling `pushArtifact({
// version: '...' })` (as the other e2e tests in push.e2e.test.ts do) can
// never catch this: that bug lives entirely in Commander's argv parsing, at
// the `registerPushCommand` layer, so this test goes through the *real*
// `buildProgram()` + `parseAsync(argv)` path, exactly like a real CLI
// invocation, rather than calling the engine function directly.
//
// The only things faked here are the GitHub-facing calls (no real network
// access/auth in tests): `getGithubToken` and `createOctokit` are mocked,
// while `parseGithubUrl`/`getDefaultBranch`/`openPullRequest` all run for
// real against the fake Octokit client the mocked `createOctokit` returns.
// Git itself (clone/fetch/branch/commit/push) is 100% real, against a local
// throwaway fixture repo, exactly as in push.e2e.test.ts.

vi.mock('../../src/engine/github/githubAuth', () => ({
  getGithubToken: () => 'fake-token-never-used-over-the-network',
}));

vi.mock('../../src/engine/github/github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/github/github')>();
  return {
    ...actual,
    createOctokit: vi.fn().mockResolvedValue({
      rest: {
        repos: {
          get: vi.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
        },
        pulls: {
          create: vi.fn().mockResolvedValue({
            data: { html_url: 'https://github.com/test-owner/test-repo/pull/1', number: 1 },
          }),
        },
      },
    }),
  };
});

const FAKE_GITHUB_URL = 'https://github.com/test-owner/test-repo.git';

describe('push CLI flags e2e', () => {
  let fixtureRemoteDir: string;
  let deliveryOsHome: string;
  let scratchRoot: string;
  let originalEnv: string | undefined;
  let originalCwd: string;

  beforeAll(async () => {
    originalEnv = process.env.DELIVERYOS_HOME;
    fixtureRemoteDir = await createTestRemote();
    deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-push-cli-home-'));
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-push-cli-scratch-'));
    process.env.DELIVERYOS_HOME = deliveryOsHome;
    // propose-new mode only *reads* the cwd-scoped lockfile (to confirm the
    // id isn't already tracked) and never writes it, so it's safe to run
    // from a throwaway scratch cwd rather than the real repo root.
    originalCwd = process.cwd();
    process.chdir(fs.mkdtempSync(path.join(scratchRoot, 'cwd-')));
  }, 30_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    if (originalEnv === undefined) {
      delete process.env.DELIVERYOS_HOME;
    } else {
      process.env.DELIVERYOS_HOME = originalEnv;
    }
    await teardownTestRemote(fixtureRemoteDir);
    fs.rmSync(deliveryOsHome, { recursive: true, force: true });
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  });

  it(
    '`push <id> --new --artifact-version <semver>` (parsed via the real Commander program) sets the committed manifest\'s version, with no silent no-op',
    async () => {
      const remoteName = 'test-remote-cli-flags';
      addRemoteEntry({ name: remoteName, url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const id = 'cli-flag-artifact';
      const payloadDir = fs.mkdtempSync(path.join(scratchRoot, 'cli-flag-payload-'));
      fs.writeFileSync(path.join(payloadDir, 'README.md'), '# cli flag artifact\n', 'utf-8');

      // Importing buildProgram fresh (after the mocks above are registered)
      // and parsing real argv is what actually exercises Commander's flag
      // resolution -- this is the part a direct pushArtifact() call skips.
      const { buildProgram } = await import('../../src/cli/program');
      const program = buildProgram();

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await program.parseAsync([
          'node',
          'deliveryos',
          'push',
          id,
          '--new',
          '--remote',
          remoteName,
          '--path',
          payloadDir,
          '--kind',
          'config',
          '--owner',
          'platform-team',
          '--description',
          'CLI-flag-parsed artifact',
          '--artifact-version',
          '2.5.0',
        ]);
      } finally {
        logSpy.mockRestore();
      }

      // If the old collision bug were present, none of this would exist:
      // Commander would have printed the tool's package.json version and
      // exited before ever branching/committing/pushing anything.
      const fixtureGit = simpleGit(fixtureRemoteDir);
      const branchSummary = await fixtureGit.branch(['-a']);
      const pushedBranch = branchSummary.all.find((b) => b.includes(`deliveryos/${id}/`));
      expect(pushedBranch).toBeDefined();

      const manifestContent = await fixtureGit.show([
        `${pushedBranch}:artifacts/${id}/manifest.yaml`,
      ]);
      expect(manifestContent).toContain(`id: ${id}`);
      expect(manifestContent).toContain('version: 2.5.0');
    },
    30_000,
  );
});
