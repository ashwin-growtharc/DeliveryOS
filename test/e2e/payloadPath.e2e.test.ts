import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import {
  createTestRemoteWithPayloadPathArtifact,
  teardownTestRemote,
  PAYLOAD_PATH_ARTIFACT,
} from '../fixtures/testRemote';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { cachePath, cloneRemote } from '../../src/engine/remote/remoteCache';
import { pullArtifact } from '../../src/engine/pull/pull';
import { pushArtifact } from '../../src/engine/push/push';
import { pristinePath } from '../../src/engine/paths';
import type { GithubClient } from '../../src/engine/github/github';

// Covers the `payload_path` feature end-to-end: a manifest whose real
// payload lives at its actual, pre-existing location in the remote's repo
// (here `docs/real-file.md`, at the fixture repo's root -- deliberately
// outside any `artifacts/` folder) rather than duplicated under
// artifacts/<id>/payload/. Mirrors the shape ArcOS's real catalog will take
// in Phase 2 (e.g. `catalog/agents/code-reviewer.md`).
//
// Same fake-GitHub-URL-but-real-local-git-repo strategy as push.e2e.test.ts:
// only the GitHub REST calls are mocked; every git operation (clone, fetch,
// branch, commit, push) is real, against a real local (non-bare) repo,
// verified afterwards with simple-git.

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

async function registerAndClone(name: string, fixtureRemoteDir: string): Promise<void> {
  addRemoteEntry({ name, url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
  await cloneRemote(name, fixtureRemoteDir);
}

describe('payload_path e2e', () => {
  let fixtureRemoteDir: string;
  let deliveryOsHome: string;
  let scratchRoot: string;
  let originalEnv: string | undefined;

  beforeAll(async () => {
    originalEnv = process.env.DELIVERYOS_HOME;
    fixtureRemoteDir = await createTestRemoteWithPayloadPathArtifact();
    deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-payloadpath-e2e-home-'));
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-payloadpath-e2e-scratch-'));
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
    'pull resolves payload_path directly (bypassing artifacts/<id>/payload/) and snapshots pristine from that same real location',
    async () => {
      const remoteName = 'test-remote-payloadpath-pull';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const cwd = newScratchCwd('payloadpath-pull');
      const result = pullArtifact(PAYLOAD_PATH_ARTIFACT.id, remoteName, cwd);

      expect(result.manifest.payload_path).toBe(PAYLOAD_PATH_ARTIFACT.payloadPath);

      const installTarget = path.resolve(cwd, PAYLOAD_PATH_ARTIFACT.installTarget);
      expect(fs.existsSync(installTarget)).toBe(true);
      expect(fs.statSync(installTarget).isFile()).toBe(true);
      const installedContent = fs.readFileSync(installTarget, 'utf-8');
      expect(installedContent).toContain('This file lives at its real location');

      // The pristine snapshot must be taken from the same real
      // (payload_path) location, not from a non-existent
      // artifacts/<id>/payload/.
      const pristine = pristinePath(cwd, PAYLOAD_PATH_ARTIFACT.id);
      expect(fs.existsSync(pristine)).toBe(true);
      expect(fs.statSync(pristine).isFile()).toBe(true);
      expect(fs.readFileSync(pristine, 'utf-8')).toBe(installedContent);

      // Sanity: no artifacts/<id>/payload/ directory was ever created for
      // this artifact in the cache -- confirms the payload really was
      // resolved via payload_path, not the default convention.
      const shadowPayloadDir = path.join(
        cachePath(remoteName),
        'artifacts',
        PAYLOAD_PATH_ARTIFACT.id,
        'payload',
      );
      expect(fs.existsSync(shadowPayloadDir)).toBe(false);
    },
    30_000,
  );

  it(
    'edit-mode push diffs the local edit against pristine and commits it to the real payload_path location in the remote cache',
    async () => {
      const remoteName = 'test-remote-payloadpath-push';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const defaultBranch = (await simpleGit(fixtureRemoteDir).status()).current;
      expect(defaultBranch).toBeTruthy();

      const cwd = newScratchCwd('payloadpath-push');
      pullArtifact(PAYLOAD_PATH_ARTIFACT.id, remoteName, cwd);

      const installTarget = path.resolve(cwd, PAYLOAD_PATH_ARTIFACT.installTarget);
      const editedContent = '# real file\n\nEDITED locally via DeliveryOS.\n';
      fs.writeFileSync(installTarget, editedContent, 'utf-8');

      const octokit = makeFakeOctokit();
      const result = await pushArtifact(PAYLOAD_PATH_ARTIFACT.id, {}, cwd, octokit);

      expect(result.branch).toMatch(
        new RegExp(`^deliveryos/${PAYLOAD_PATH_ARTIFACT.id}/\\d{14}-[0-9a-f]{4}$`),
      );

      const fixtureGit = simpleGit(fixtureRemoteDir);

      // The real, verifiable proof: diffing the pushed branch against the
      // remote's default branch shows the change landed at the artifact's
      // real pointer path (docs/real-file.md), never at
      // artifacts/<id>/payload/... .
      const diffOutput = await fixtureGit.diff([
        '--name-only',
        `${defaultBranch}..${result.branch}`,
      ]);
      const diffFiles = diffOutput.split('\n').map((line) => line.trim()).filter(Boolean);

      // Phase E: edit-mode push now always bumps + commits manifest.yaml
      // alongside the payload diff (previously it never touched
      // manifest.yaml at all -- see push.ts's own doc comment on
      // PushOptions.bump) -- so the real payload_path file is no longer
      // the ONLY changed path, just still the only PAYLOAD path.
      expect(diffFiles.sort()).toEqual(
        [`artifacts/${PAYLOAD_PATH_ARTIFACT.id}/manifest.yaml`, PAYLOAD_PATH_ARTIFACT.payloadPath].sort(),
      );
      expect(
        diffFiles.some((f) => f.startsWith(`artifacts/${PAYLOAD_PATH_ARTIFACT.id}/payload/`)),
      ).toBe(false);

      const committedContent = await fixtureGit.show([
        `${result.branch}:${PAYLOAD_PATH_ARTIFACT.payloadPath}`,
      ]);
      expect(committedContent).toBe(editedContent);

      const call = octokit.rest.pulls.create.mock.calls[0][0];
      expect(call.body).toContain(PAYLOAD_PATH_ARTIFACT.payloadPath);
    },
    30_000,
  );
});
