import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { cachePath, refreshRemoteCache, cloneRemote } from '../../src/engine/remote/remoteCache';
import { buildCatalog } from '../../src/engine/catalog/catalog';
import { pullArtifact } from '../../src/engine/pull/pull';
import { planAdoption } from '../../src/engine/adopt/planAdoption';
import { adoptArtifacts } from '../../src/engine/adopt/adoptArtifacts';
import { AdoptionProfileSchema } from '../../src/engine/adopt/profile';
import { GithubClient } from '../../src/engine/github/github';
import { rmDirWithRetry } from '../../src/engine/execHelpers';

/**
 * Adopting a client's existing folder of documents.
 *
 * THE ACCEPTANCE CRITERION IS NOT "A PULL REQUEST OPENED"
 *
 * It is that installing one of the adopted artifacts puts the ORIGINAL file
 * where the manifest says. That is the check that exercises the whole chain --
 * `payload_path` pointing at a file that was never moved, an `install_target`
 * derived from a folder rule, and the single-file-payload handling that cost
 * the real 210-artifact import a 134-file remediation pull request.
 *
 * A test that stopped at "the branch was pushed" would have passed for that
 * import too, right up until somebody tried to use it.
 */

let home: string;
let originalHome: string | undefined;
let scratch: string[] = [];

/** A `GithubClient` fake, following the pattern the port was designed for:
 * production builds a real Octokit, tests inject a plain object. */
function fakeGithub(): GithubClient {
  return {
    rest: {
      repos: {
        get: vi.fn().mockResolvedValue({ data: { default_branch: 'main', private: true } }),
      },
      pulls: {
        create: vi
          .fn()
          .mockResolvedValue({ data: { html_url: 'https://example.invalid/pr/1', number: 1 } }),
        get: vi.fn(),
      },
    },
  } as unknown as GithubClient;
}

/**
 * Registers a remote whose recorded URL is a github.com one while the cache is
 * cloned from a local fixture.
 *
 * The same split `push.e2e.test.ts` uses, and for the same reason: `push` and
 * `adopt` both call `parseGithubUrl` on the registry entry, so a bare temp path
 * is refused -- correctly, since nothing could open a pull request against it.
 * The clone still happens against the real directory, so every git operation
 * under test is genuine.
 */
const FAKE_GITHUB_URL = 'https://github.com/test-owner/test-repo.git';

async function registerAndClone(name: string, dir: string): Promise<void> {
  await addRemoteEntry({ name, url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
  await cloneRemote(name, dir);
}

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** A client repository: real files in their own folders, and no `artifacts/`
 * directory anywhere -- which is precisely why DeliveryOS cannot read it. */
async function clientRepo(): Promise<string> {
  const root = tempDir('deliveryos-client-');
  fs.mkdirSync(path.join(root, 'playbooks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'playbooks', 'escalation.md'),
    '---\ndescription: How to escalate, and to whom.\n---\n# Escalation\n\nReal content.\n',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(root, 'playbooks', 'handover.md'),
    '# Handover\n\nMore real content.\n',
    'utf-8',
  );

  const git = simpleGit(root);
  await git.init();
  await git.add(['.']);
  await git.raw(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'client files']);
  // A default branch called `main`, matching what the fake reports.
  await git.raw(['branch', '-M', 'main']);
  return root;
}

const profile = AdoptionProfileSchema.parse({
  remote: 'acme',
  owner: 'consultant',
  rules: [
    {
      folder: 'playbooks',
      kind: 'rule',
      installTarget: '.claude/rules/playbooks',
      idPrefix: 'playbooks',
      tags: { roles: ['delivery'], teams: [], stacks: [] },
    },
  ],
});

beforeEach(() => {
  originalHome = process.env.DELIVERYOS_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-adopt-home-'));
  process.env.DELIVERYOS_HOME = home;
  scratch = [];
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.DELIVERYOS_HOME;
  else process.env.DELIVERYOS_HOME = originalHome;
  for (const dir of [home, ...scratch]) await rmDirWithRetry(dir);
});

describe('adopting a folder that is not a catalog', () => {
  it('starts from a repo DeliveryOS cannot read at all', async () => {
    const root = await clientRepo();
    await registerAndClone('acme', root);

    // The premise, asserted rather than assumed: no `artifacts/` directory
    // means `discoverManifests` finds nothing, however many real files are
    // sitting there.
    expect(buildCatalog().filter((e) => e.remoteName === 'acme')).toHaveLength(0);
  });

  it('commits manifests only -- not one byte of content', async () => {
    const root = await clientRepo();
    await registerAndClone('acme', root);

    const plan = planAdoption(cachePath('acme'), profile, [], root);
    expect(plan.candidates).toHaveLength(2);

    const result = await adoptArtifacts(plan, 'acme', undefined, fakeGithub());
    expect(result.adopted).toBe(2);

    // What the branch actually contains, read back from the client repo rather
    // than from anything the adoption returned.
    const files = (await simpleGit(root).raw(['show', '--name-only', '--pretty=format:', result.branch]))
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
      .sort();

    expect(files).toEqual([
      'artifacts/playbooks-escalation/manifest.yaml',
      'artifacts/playbooks-handover/manifest.yaml',
    ]);
    // The property that makes a 200-artifact change reviewable: the originals
    // are already in the repo, so adoption copies nothing.
    expect(files.some((f) => f.includes('payload'))).toBe(false);
    expect(files.some((f) => f.startsWith('playbooks/'))).toBe(false);
  });

  it('opens ONE pull request, not one per artifact', async () => {
    const root = await clientRepo();
    await registerAndClone('acme', root);
    const client = fakeGithub();

    await adoptArtifacts(planAdoption(cachePath('acme'), profile, [], root), 'acme', undefined, client);

    // `pushArtifact` is one artifact per call; two hundred files would be two
    // hundred pull requests, which is why this is a separate function rather
    // than a loop over that one.
    expect(client.rest.pulls.create).toHaveBeenCalledTimes(1);
  });

  it('installs an adopted artifact, landing the ORIGINAL file where the rule said', async () => {
    // The acceptance criterion.
    const root = await clientRepo();
    await registerAndClone('acme', root);

    const plan = planAdoption(cachePath('acme'), profile, [], root);
    const result = await adoptArtifacts(plan, 'acme', undefined, fakeGithub());

    // Stand in for a merge: the pull request is fake, so land the branch by
    // hand and refresh, which is what a real merge would produce.
    await simpleGit(root).raw(['merge', '--ff-only', result.branch]);
    await refreshRemoteCache('acme');

    const catalog = buildCatalog().filter((e) => e.remoteName === 'acme');
    expect(catalog.map((e) => e.manifest.id).sort()).toEqual([
      'playbooks-escalation',
      'playbooks-handover',
    ]);

    const project = tempDir('deliveryos-project-');
    await pullArtifact('playbooks-escalation', 'acme', project);

    const landed = path.join(project, '.claude', 'rules', 'playbooks', 'escalation.md');
    expect(fs.existsSync(landed), 'the adopted file should install').toBe(true);
    // Byte-for-byte the client's own file, not a rewritten copy.
    expect(fs.readFileSync(landed, 'utf-8')).toBe(
      fs.readFileSync(path.join(root, 'playbooks', 'escalation.md'), 'utf-8'),
    );
  });

  it('leaves the cache back on the default branch afterwards', async () => {
    const root = await clientRepo();
    await registerAndClone('acme', root);

    await adoptArtifacts(planAdoption(cachePath('acme'), profile, [], root), 'acme', undefined, fakeGithub());

    // The cache is both the catalog's read-model and this staging area. Left on
    // an adoption branch, every later read would see manifests that were never
    // merged -- the same hazard `pushArtifact` documents.
    const current = (await simpleGit(cachePath('acme')).raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    expect(current).toBe('main');
  });
});
