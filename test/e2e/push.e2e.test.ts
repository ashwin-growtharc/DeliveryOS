import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { parse as parseYaml } from 'yaml';
import {
  createTestRemoteWithUiComponentArtifact,
  teardownTestRemote,
  TEST_ARTIFACTS,
  UI_COMPONENT_ARTIFACT,
} from '../fixtures/testRemote';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { cloneRemote, cachePath } from '../../src/engine/remote/remoteCache';
import { fetchAndReset } from '../../src/engine/git/git';
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

function makeFakeOctokit(isPrivate = false): FakeOctokit {
  return {
    rest: {
      repos: {
        get: vi.fn().mockResolvedValue({ data: { default_branch: FAKE_DEFAULT_BRANCH, private: isPrivate } }),
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
    // Includes the extra kind: ui-component artifact (UI_COMPONENT_ARTIFACT)
    // on top of the usual 3 -- strictly additive, so every existing test
    // below (which only ever looks up TEST_ARTIFACTS by id) is unaffected;
    // it's just needed for the Phase E preview.png tests further down.
    fixtureRemoteDir = await createTestRemoteWithUiComponentArtifact();
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
      await pullArtifact(artifact.id, remoteName, cwd);

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
    'edit mode: bumps the manifest version by default (patch) and commits manifest.yaml (Phase E)',
    async () => {
      // The real gap this closes: before Phase E, edit-mode push never
      // touched manifest.yaml at all, so a payload edit's version never
      // changed -- checkForUpdates/the preview cache (both keyed on
      // version) could never detect a real edit, silently, forever.
      const remoteName = 'test-remote-edit-version-bump';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => !a.hasPostInstall && a.id === 'welcome-template')!;
      const cwd = newScratchCwd('edit-version-bump');
      await pullArtifact(artifact.id, remoteName, cwd);

      fs.writeFileSync(
        path.join(cwd, artifact.installTarget, 'README.md'),
        '# welcome-template\n\nversion-bump test edit.\n',
        'utf-8',
      );

      const octokit = makeFakeOctokit();
      const result = await pushArtifact(artifact.id, {}, cwd, octokit);

      const fixtureGit = simpleGit(fixtureRemoteDir);
      const committedManifest = await fixtureGit.show([
        `${result.branch}:artifacts/${artifact.id}/manifest.yaml`,
      ]);
      expect(parseYaml(committedManifest).version).toBe('1.0.1');

      const call = octokit.rest.pulls.create.mock.calls[0][0];
      expect(call.title).toContain('v1.0.0 -> v1.0.1');
      expect(call.body).toContain('v1.0.0 -> v1.0.1');
    },
    30_000,
  );

  it(
    'edit mode: an explicit --bump minor overrides the default patch bump (Phase E)',
    async () => {
      const remoteName = 'test-remote-edit-bump-minor';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => !a.hasPostInstall && a.id === 'welcome-template')!;
      const cwd = newScratchCwd('edit-bump-minor');
      await pullArtifact(artifact.id, remoteName, cwd);

      fs.writeFileSync(
        path.join(cwd, artifact.installTarget, 'README.md'),
        '# welcome-template\n\nminor bump test edit.\n',
        'utf-8',
      );

      const octokit = makeFakeOctokit();
      const result = await pushArtifact(artifact.id, { bump: 'minor' }, cwd, octokit);

      const fixtureGit = simpleGit(fixtureRemoteDir);
      const committedManifest = await fixtureGit.show([
        `${result.branch}:artifacts/${artifact.id}/manifest.yaml`,
      ]);
      expect(parseYaml(committedManifest).version).toBe('1.1.0');
    },
    30_000,
  );

  it(
    'edit mode: regenerates preview.png for a ui-component and embeds it in the PR body (Phase E)',
    async () => {
      const remoteName = 'test-remote-edit-preview-png';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const cwd = newScratchCwd('edit-preview-png');
      await pullArtifact(UI_COMPONENT_ARTIFACT.id, remoteName, cwd);

      // A real visual edit -- changes what the rendered preview.png should
      // look like, not just a comment/whitespace change.
      const buttonPath = path.join(cwd, UI_COMPONENT_ARTIFACT.installTarget, 'Button.tsx');
      fs.writeFileSync(
        buttonPath,
        fs.readFileSync(buttonPath, 'utf-8').replace('padding: \'8px 16px\'', 'padding: \'20px 40px\''),
        'utf-8',
      );

      const octokit = makeFakeOctokit();
      const result = await pushArtifact(UI_COMPONENT_ARTIFACT.id, {}, cwd, octokit);

      const fixtureGit = simpleGit(fixtureRemoteDir);
      // Confirms preview.png was actually committed as a real tracked path
      // in this branch -- renderPreviewImage's own unit tests already
      // verify real PNG magic bytes; this just proves it made it into the
      // commit at all, which is the part push.ts itself is responsible for.
      const lsTree = await fixtureGit.raw([
        'ls-tree',
        '-r',
        '--name-only',
        result.branch,
        `artifacts/${UI_COMPONENT_ARTIFACT.id}/payload`,
      ]);
      expect(lsTree).toContain('preview.png');

      const call = octokit.rest.pulls.create.mock.calls[0][0];
      expect(call.body).toContain('### Preview');
      expect(call.body).toContain(
        `raw.githubusercontent.com/test-owner/test-repo/${result.branch}/artifacts/${UI_COMPONENT_ARTIFACT.id}/payload/preview.png`,
      );
    },
    // Launches a real headless browser (renderPreviewImage) on top of this
    // file's already-real git operations -- fast in isolation (~6s
    // observed), but can run considerably longer under full-suite
    // parallelism (multiple test files launching real browsers
    // concurrently), so this gets a more generous timeout than this file's
    // other, non-Playwright tests.
    60_000,
  );

  it(
    'propose-new mode: generates and commits preview.png for a ui-component payload with a preview.tsx (Phase E)',
    async () => {
      const remoteName = 'test-remote-new-preview-png';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const payloadDir = fs.mkdtempSync(path.join(scratchRoot, 'new-ui-component-payload-'));
      fs.writeFileSync(
        path.join(payloadDir, 'Badge.tsx'),
        `export interface BadgeProps {\n  label: string;\n}\n\nexport function Badge({ label }: BadgeProps) {\n  return <span>{label}</span>;\n}\n`,
        'utf-8',
      );
      fs.writeFileSync(
        path.join(payloadDir, 'preview.tsx'),
        `import { Badge } from './Badge';\n\nexport const Default = () => <Badge label="New" />;\n`,
        'utf-8',
      );

      const octokit = makeFakeOctokit();
      const newId = 'test-badge-new';
      const result = await pushArtifact(
        newId,
        {
          remote: remoteName,
          isNew: true,
          payloadPath: payloadDir,
          kind: 'ui-component',
          owner: 'test-team',
          description: 'A brand-new badge component',
        },
        newScratchCwd('new-preview-png'),
        octokit,
      );

      const fixtureGit = simpleGit(fixtureRemoteDir);
      const lsTree = await fixtureGit.raw([
        'ls-tree', '-r', '--name-only', result.branch, `artifacts/${newId}/payload`,
      ]);
      expect(lsTree).toContain('preview.png');

      const call = octokit.rest.pulls.create.mock.calls[0][0];
      expect(call.body).toContain('### Preview');
      expect(call.body).toContain(
        `raw.githubusercontent.com/test-owner/test-repo/${result.branch}/artifacts/${newId}/payload/preview.png`,
      );
    },
    // See the previous test's own comment on this same generous timeout.
    60_000,
  );

  it(
    'propose-new mode: install_params passed via options land in the real committed manifest (Phase 10 item 3)',
    async () => {
      const remoteName = 'test-remote-new-install-params';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const payloadDir = fs.mkdtempSync(path.join(scratchRoot, 'new-backend-plugin-payload-'));
      fs.writeFileSync(
        path.join(payloadDir, 'auth.config.ts'),
        'const secret = process.env.AUTH_SECRET;\nconst db = process.env.DATABASE_URL;\n',
        'utf-8',
      );

      const octokit = makeFakeOctokit();
      const newId = 'test-backend-plugin-new';
      const result = await pushArtifact(
        newId,
        {
          remote: remoteName,
          isNew: true,
          payloadPath: payloadDir,
          kind: 'backend-plugin',
          owner: 'test-team',
          description: 'A brand-new backend plugin, with real install_params',
          installParams: [
            { key: 'AUTH_SECRET', description: 'Session signing secret', secret: true, required: true },
            { key: 'DATABASE_URL', description: 'Postgres connection string', secret: true, required: true },
          ],
        },
        newScratchCwd('new-install-params'),
        octokit,
      );

      const fixtureGit = simpleGit(fixtureRemoteDir);
      const manifestYaml = await fixtureGit.show([`${result.branch}:artifacts/${newId}/manifest.yaml`]);
      const manifest = parseYaml(manifestYaml);

      expect(manifest.install_params).toEqual([
        { key: 'AUTH_SECRET', description: 'Session signing secret', secret: true, required: true },
        { key: 'DATABASE_URL', description: 'Postgres connection string', secret: true, required: true },
      ]);
    },
    60_000,
  );

  it(
    'propose-new mode: omitting install_params entirely still works exactly as before (Phase 10 item 3, zero regression)',
    async () => {
      const remoteName = 'test-remote-new-no-install-params';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const payloadDir = fs.mkdtempSync(path.join(scratchRoot, 'new-plain-payload-'));
      fs.writeFileSync(path.join(payloadDir, 'index.js'), 'module.exports = 1;\n', 'utf-8');

      const octokit = makeFakeOctokit();
      const newId = 'test-plain-new';
      const result = await pushArtifact(
        newId,
        {
          remote: remoteName,
          isNew: true,
          payloadPath: payloadDir,
          kind: 'skill',
          owner: 'test-team',
          description: 'A brand-new artifact with no install_params at all',
        },
        newScratchCwd('new-no-install-params'),
        octokit,
      );

      const fixtureGit = simpleGit(fixtureRemoteDir);
      const manifestYaml = await fixtureGit.show([`${result.branch}:artifacts/${newId}/manifest.yaml`]);
      const manifest = parseYaml(manifestYaml);
      // ManifestSchema defaults install_params to [] regardless -- this
      // confirms omitting the new option doesn't change that
      // already-established, correct behavior, not that the field
      // vanishes entirely.
      expect(manifest.install_params).toEqual([]);
    },
    60_000,
  );

  it(
    'propose-new mode: a preview render failure never blocks the push itself, just omits the image (Phase E)',
    async () => {
      // Regression guard for a real, serious bug found by hand: adding
      // playwright-core (needed for renderPreviewImage) as a real
      // dependency of push.ts turned out to crash the ENTIRE packaged
      // Node SEA sidecar on startup (playwright-core's own bundle does a
      // dynamic require of its own package.json at import time, which
      // Node's SEA require shim can't resolve at all -- confirmed
      // empirically, including that marking it external doesn't help
      // either, since SEA has zero external module resolution). Fixed by
      // making the import lazy (see renderPreviewImage.ts's own doc
      // comment) -- meaning the packaged app can still fail to render a
      // preview at the exact moment a push needs one. This test proves
      // maybeRenderPreviewImage's own catch (push.ts) genuinely absorbs
      // ANY render failure, not just the ones this repo's dev machine
      // happens to be able to reproduce -- a component whose preview.tsx
      // has a real compile error (a syntax error, here) never reaches
      // Playwright at all, but exercises the exact same catch path a
      // Playwright-specific failure would.
      const remoteName = 'test-remote-new-preview-failure';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const payloadDir = fs.mkdtempSync(path.join(scratchRoot, 'new-ui-component-broken-preview-'));
      fs.writeFileSync(
        path.join(payloadDir, 'Broken.tsx'),
        `export interface BrokenProps {\n  label: string;\n}\n\nexport function Broken({ label }: BrokenProps) {\n  return <span>{label}</span>;\n}\n`,
        'utf-8',
      );
      // A genuine syntax error -- compilePreviewHtml itself throws before
      // ever reaching Playwright, exercising maybeRenderPreviewImage's
      // catch the same way a Playwright-specific failure would.
      fs.writeFileSync(
        path.join(payloadDir, 'preview.tsx'),
        `import { Broken } from './Broken';\n\nexport const Default = () => <Broken label="New" (((( ;\n`,
        'utf-8',
      );

      const octokit = makeFakeOctokit();
      const newId = 'test-broken-preview';
      const result = await pushArtifact(
        newId,
        {
          remote: remoteName,
          isNew: true,
          payloadPath: payloadDir,
          kind: 'ui-component',
          owner: 'test-team',
          description: 'A component whose preview fails to compile',
        },
        newScratchCwd('new-preview-failure'),
        octokit,
      );

      // The push itself still succeeded -- a real PR opened.
      expect(result.number).toBeGreaterThan(0);

      const fixtureGit = simpleGit(fixtureRemoteDir);
      const lsTree = await fixtureGit.raw([
        'ls-tree', '-r', '--name-only', result.branch, `artifacts/${newId}/payload`,
      ]);
      expect(lsTree).toContain('Broken.tsx');
      expect(lsTree).toContain('preview.tsx');
      expect(lsTree).not.toContain('preview.png');

      const call = octokit.rest.pulls.create.mock.calls[0][0];
      expect(call.body).not.toContain('### Preview');
    },
    60_000,
  );

  it(
    'propose-new mode against a PRIVATE repo: still generates+commits preview.png, but never embeds a raw.githubusercontent.com link (Phase E)',
    async () => {
      // Regression guard for a real bug found by hand: raw.githubusercontent.com
      // does not serve private-repo content to an unauthenticated request (a
      // real push against a real private remote produced a PR body with a
      // broken image link -- confirmed via a direct curl returning 404). The
      // fix has to know the repo is private BEFORE building the PR body, not
      // just at PR-open time.
      const remoteName = 'test-remote-new-preview-png-private';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const payloadDir = fs.mkdtempSync(path.join(scratchRoot, 'new-ui-component-payload-private-'));
      fs.writeFileSync(
        path.join(payloadDir, 'Badge.tsx'),
        `export interface BadgeProps {\n  label: string;\n}\n\nexport function Badge({ label }: BadgeProps) {\n  return <span>{label}</span>;\n}\n`,
        'utf-8',
      );
      fs.writeFileSync(
        path.join(payloadDir, 'preview.tsx'),
        `import { Badge } from './Badge';\n\nexport const Default = () => <Badge label="New" />;\n`,
        'utf-8',
      );

      const octokit = makeFakeOctokit(true); // isPrivate: true
      const newId = 'test-badge-new-private';
      const result = await pushArtifact(
        newId,
        {
          remote: remoteName,
          isNew: true,
          payloadPath: payloadDir,
          kind: 'ui-component',
          owner: 'test-team',
          description: 'A brand-new badge component (private repo)',
        },
        newScratchCwd('new-preview-png-private'),
        octokit,
      );

      // preview.png is still generated and committed -- privacy only
      // affects whether it can be EMBEDDED inline, not whether it exists.
      const fixtureGit = simpleGit(fixtureRemoteDir);
      const lsTree = await fixtureGit.raw([
        'ls-tree', '-r', '--name-only', result.branch, `artifacts/${newId}/payload`,
      ]);
      expect(lsTree).toContain('preview.png');

      const call = octokit.rest.pulls.create.mock.calls[0][0];
      expect(call.body).toContain('### Preview');
      expect(call.body).not.toContain('raw.githubusercontent.com');
      expect(call.body).toContain(`artifacts/${newId}/payload/preview.png`);
      expect(call.body).toContain('Files changed');
    },
    60_000,
  );

  it(
    'metadataEdit mode: edits description/roles/stacks without touching the payload, and only commits manifest.yaml',
    async () => {
      const remoteName = 'test-remote-metadata-edit';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => !a.hasPostInstall && a.id === 'welcome-template')!;
      const cwd = newScratchCwd('metadata-edit');
      await pullArtifact(artifact.id, remoteName, cwd);
      // No local edits made at all -- a metadataEdit push must not require
      // (or even look at) any payload diff.

      const octokit = makeFakeOctokit();
      const result = await pushArtifact(
        artifact.id,
        {
          metadataEdit: {
            description: 'Updated via metadataEdit',
            roles: ['engineering'],
            stacks: ['python'],
          },
        },
        cwd,
        octokit,
      );

      expect(await branchExistsInFixture(fixtureRemoteDir, result.branch)).toBe(true);

      const fixtureGit = simpleGit(fixtureRemoteDir);
      const manifestContent = await fixtureGit.show([
        `${result.branch}:artifacts/${artifact.id}/manifest.yaml`,
      ]);
      expect(manifestContent).toContain('description: Updated via metadataEdit');
      expect(manifestContent).toContain('roles:\n    - engineering');
      expect(manifestContent).toContain('stacks:\n    - python');

      // Only the manifest changed -- the payload (README.md) must NOT appear
      // in this commit at all.
      const diffSummary = await fixtureGit.raw(['show', '--stat', '--format=', result.branch]);
      expect(diffSummary).toContain(`artifacts/${artifact.id}/manifest.yaml`);
      expect(diffSummary).not.toContain('payload/README.md');

      const call = octokit.rest.pulls.create.mock.calls[0][0];
      expect(call.title).toContain(`${artifact.id} metadata`);
      expect(call.body).toContain('description');
      expect(call.body).toContain('roles');
      expect(call.body).toContain('stacks');
      expect(call.body).not.toContain('teams'); // unchanged -- shouldn't be listed
    },
    30_000,
  );

  it(
    'metadataEdit mode: hard-errors with NoLocalChangesError when nothing actually changed',
    async () => {
      const remoteName = 'test-remote-metadata-edit-noop';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const artifact = TEST_ARTIFACTS.find((a) => !a.hasPostInstall && a.id === 'welcome-template')!;
      const cwd = newScratchCwd('metadata-edit-noop');
      await pullArtifact(artifact.id, remoteName, cwd);

      await expect(
        pushArtifact(artifact.id, { metadataEdit: { description: 'Test artifact of kind template' } }, cwd, makeFakeOctokit()),
      ).rejects.toThrow(NoLocalChangesError);
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
      // Single-file payloads now use payload_path -> files/<id>/<basename>
      // instead of the standard artifacts/<id>/payload/ wrapper (see the
      // next test for why: a directory-shaped payload wrapper breaks pull
      // for any install_target that's itself a file path).
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
      const fileContent = await fixtureGit.show([`${result.branch}:files/${id}/guidelines.md`]);
      expect(fileContent).toBe('# Brand Guidelines\n\nContent here.\n');

      const manifestContent = await fixtureGit.show([
        `${result.branch}:artifacts/${id}/manifest.yaml`,
      ]);
      expect(manifestContent).toContain(`payload_path: files/${id}/guidelines.md`);

      const call = octokit.rest.pulls.create.mock.calls[0][0];
      expect(call.body).toContain(`files/${id}/guidelines.md`);
    },
    30_000,
  );

  it(
    'propose-new mode with a SINGLE-FILE payload and a file-shaped install_target actually pulls back correctly (the real regression)',
    async () => {
      // This is the scenario the payload_path override above exists for:
      // deliveryos scan proposes a discovered .claude/agents/<id>.md with
      // install_target set to that same file path. Before the fix, this
      // combination (file-shaped install_target + directory-shaped
      // artifacts/<id>/payload/ source) made pullArtifact's cpSync create
      // install_target AS A DIRECTORY containing the file, instead of the
      // file itself -- exactly the bug found in the growtharc-ai-helpers
      // agent import. Proves the fix end-to-end: propose, then actually
      // pull, and assert install_target is a real file, not a directory.
      const remoteName = 'test-remote-new-file-install-target';
      await registerAndClone(remoteName, fixtureRemoteDir);

      const id = 'scanned-agent';
      const pushCwd = newScratchCwd('propose-new-file-install-target-push');

      const payloadDir = fs.mkdtempSync(path.join(scratchRoot, 'payload-agent-'));
      const payloadFile = path.join(payloadDir, `${id}.md`);
      fs.writeFileSync(payloadFile, '# Scanned Agent\n\nAgent instructions here.\n', 'utf-8');

      const pushResult = await pushArtifact(
        id,
        {
          isNew: true,
          remote: remoteName,
          payloadPath: payloadFile,
          kind: 'agent',
          owner: 'someone',
          description: 'A scanned local agent',
          version: '1.0.0',
          installTarget: `.claude/agents/${id}.md`,
        },
        pushCwd,
        makeFakeOctokit(),
      );

      // Merge isn't part of this flow (PR creation is a fake Octokit here)
      // -- simulate it directly against the fixture repo, the same way a
      // real GitHub merge would update the default branch before anyone
      // could pull it. FAKE_DEFAULT_BRANCH is just the fake Octokit's
      // mocked API response, not necessarily this fixture's actual git
      // branch name (that depends on the local git install's
      // init.defaultBranch) -- query the real current branch instead of
      // assuming it matches.
      const fixtureGit = simpleGit(fixtureRemoteDir);
      const realDefaultBranch = (await fixtureGit.status()).current!;
      await fixtureGit.checkout(realDefaultBranch);
      await fixtureGit.merge([pushResult.branch]);

      // pullArtifact resolves against the LOCAL cache clone, which was made
      // before this artifact even existed -- refresh it first, the same
      // way a real "Check for updates"/re-pull would before ever seeing a
      // newly-merged artifact for the first time.
      await fetchAndReset(cachePath(remoteName));

      const pullCwd = newScratchCwd('propose-new-file-install-target-pull');
      const pullResult = await pullArtifact(id, remoteName, pullCwd);

      const installedPath = pullResult.installTarget;
      expect(fs.existsSync(installedPath)).toBe(true);
      expect(fs.statSync(installedPath).isFile()).toBe(true);
      expect(fs.readFileSync(installedPath, 'utf-8')).toBe(
        '# Scanned Agent\n\nAgent instructions here.\n',
      );
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
      await pullArtifact(artifact.id, remoteName, cwd);
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
      await pullArtifact(artifactA.id, remoteName, cwdA);
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
