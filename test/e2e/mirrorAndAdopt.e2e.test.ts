import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { cloneRemote, refreshRemoteCache, cachePath } from '../../src/engine/remote/remoteCache';
import { addRemote } from '../../src/engine/remote/manageRemotes';
import { buildCatalog } from '../../src/engine/catalog/catalog';
import { pullArtifact } from '../../src/engine/pull/pull';
import { mirrorAndAdopt, planMirrorAndAdopt } from '../../src/engine/adopt/mirrorAndAdopt';
import { mirrorFolder, MIRROR_RECORD } from '../../src/engine/adopt/mirrorFolder';
import { AdoptionProfileSchema } from '../../src/engine/adopt/profile';
import { GithubClient } from '../../src/engine/github/github';
import { rmDirWithRetry } from '../../src/engine/execHelpers';

/**
 * The whole SharePoint journey, from a folder nobody can use to an installed
 * artifact.
 *
 * WHY THIS EXISTS AS ONE TEST RATHER THAN FIVE
 *
 * Each piece already has its own tests -- the folder backend reads a directory,
 * the planner proposes artifacts, adoption commits manifests. What none of them
 * proves is that a real client's folder gets all the way through, and that is
 * the only claim anybody outside this repository cares about.
 *
 * It also pins the ordering constraint that is easy to get wrong: the plan must
 * be built from the MIRRORED tree, not the source, or it describes files that
 * were never committed.
 */

let home: string;
let originalHome: string | undefined;
let scratch: string[] = [];

const FAKE_GITHUB_URL = 'https://github.com/acme/contoso-catalog.git';

function fakeGithub(): GithubClient {
  return {
    rest: {
      repos: { get: vi.fn().mockResolvedValue({ data: { default_branch: 'main', private: true } }) },
      pulls: {
        create: vi.fn().mockResolvedValue({ data: { html_url: 'https://example.invalid/pr/7', number: 7 } }),
        get: vi.fn(),
      },
    },
  } as unknown as GithubClient;
}

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** What a synced SharePoint library actually looks like on disk: the client's
 * own folder names, real documents, and the debris the sync client leaves. */
function syncedSharepointFolder(): string {
  const root = path.join(tempDir('deliveryos-onedrive-'), 'Contoso Ltd', 'Delivery Playbooks');
  fs.mkdirSync(path.join(root, 'playbooks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'templates'), { recursive: true });

  fs.writeFileSync(
    path.join(root, 'playbooks', 'escalation.md'),
    '---\ndescription: When and how to escalate a blocked engagement.\n---\n# Escalation\n\nRaise with the delivery lead first.\n',
    'utf-8',
  );
  fs.writeFileSync(path.join(root, 'playbooks', 'handover.md'), '# Handover checklist\n\nSteps.\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'templates', 'proposal.md'), '# Proposal template\n\nSections.\n', 'utf-8');

  fs.writeFileSync(path.join(root, 'desktop.ini'), 'x', 'utf-8');
  fs.writeFileSync(path.join(root, 'playbooks', '~$escalation.md'), 'x', 'utf-8');
  return root;
}

/** An empty catalog repository we manage, standing in for `<client>-catalog`. */
async function emptyCatalogRepo(): Promise<string> {
  const root = tempDir('deliveryos-catalog-');
  fs.writeFileSync(path.join(root, 'README.md'), '# Contoso catalog\n', 'utf-8');
  const git = simpleGit(root);
  await git.init();
  await git.add(['.']);
  await git.raw(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init']);
  await git.raw(['branch', '-M', 'main']);
  return root;
}

const profile = AdoptionProfileSchema.parse({
  remote: 'contoso',
  owner: 'consultant',
  rules: [
    { folder: 'playbooks', kind: 'rule', installTarget: '.claude/rules/playbooks', idPrefix: 'playbook' },
    { folder: 'templates', kind: 'doc', installTarget: 'templates', idPrefix: 'template' },
  ],
});

beforeEach(() => {
  originalHome = process.env.DELIVERYOS_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-mirror-home-'));
  process.env.DELIVERYOS_HOME = home;
  scratch = [];
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.DELIVERYOS_HOME;
  else process.env.DELIVERYOS_HOME = originalHome;
  for (const dir of [home, ...scratch]) await rmDirWithRetry(dir);
});

describe('a synced SharePoint folder, end to end', () => {
  it('goes from unusable folder to installed artifact', async () => {
    const synced = syncedSharepointFolder();
    const catalogRepo = await emptyCatalogRepo();

    // 1. The folder on its own is not a catalog -- which is exactly the state a
    //    client hands over, and the reason none of this worked before.
    await addRemote(synced, 'contoso-direct');
    expect(buildCatalog().filter((e) => e.remoteName === 'contoso-direct')).toHaveLength(0);

    // 2. A catalog we manage, registered the way the e2e suite always does:
    //    a github URL on the entry, a real local repo behind it.
    await addRemoteEntry({ name: 'contoso', url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
    await cloneRemote('contoso', catalogRepo);

    // 3. Mirror and adopt, in one change.
    const result = await mirrorAndAdopt(synced, profile, 'contoso', undefined, fakeGithub());
    expect(result.adopted).toBe(3);
    expect(result.mirrored).toBe(3);

    // 4. Stand in for the merge, then read the catalog for real.
    await simpleGit(catalogRepo).raw(['merge', '--ff-only', result.branch]);
    await refreshRemoteCache('contoso');

    const ids = buildCatalog()
      .filter((e) => e.remoteName === 'contoso')
      .map((e) => e.manifest.id)
      .sort();
    expect(ids).toEqual(['playbook-escalation', 'playbook-handover', 'template-proposal']);

    // 5. The claim that matters: a person installs one and gets the client's
    //    own file, byte for byte, where the rule said it should go.
    const project = tempDir('deliveryos-project-');
    await pullArtifact('playbook-escalation', 'contoso', project);

    const landed = path.join(project, '.claude', 'rules', 'playbooks', 'escalation.md');
    expect(fs.existsSync(landed)).toBe(true);
    expect(fs.readFileSync(landed, 'utf-8')).toBe(
      fs.readFileSync(path.join(synced, 'playbooks', 'escalation.md'), 'utf-8'),
    );
  });

  it('preserves the client\'s own folder names, and leaves the debris behind', async () => {
    const synced = syncedSharepointFolder();
    const catalogRepo = await emptyCatalogRepo();
    await addRemoteEntry({ name: 'contoso', url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
    await cloneRemote('contoso', catalogRepo);

    const result = await mirrorAndAdopt(synced, profile, 'contoso', undefined, fakeGithub());

    const committed = (await simpleGit(catalogRepo).raw(['show', '--name-only', '--pretty=format:', result.branch]))
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
      .sort();

    // The client's structure survives, which is what makes the mirror
    // recognisable to them and re-mirroring a single boring operation.
    expect(committed).toContain('playbooks/escalation.md');
    expect(committed).toContain('templates/proposal.md');
    expect(committed).toContain('artifacts/playbook-escalation/manifest.yaml');

    // And the sync client's leavings do not become part of a client's catalog
    // forever.
    expect(committed.some((f) => f.includes('desktop.ini'))).toBe(false);
    expect(committed.some((f) => f.includes('~$'))).toBe(false);
  });

  it('opens one pull request for the whole thing', async () => {
    const synced = syncedSharepointFolder();
    const catalogRepo = await emptyCatalogRepo();
    await addRemoteEntry({ name: 'contoso', url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
    await cloneRemote('contoso', catalogRepo);
    const client = fakeGithub();

    await mirrorAndAdopt(synced, profile, 'contoso', undefined, client);

    // A mirror on its own would be a change with no observable effect -- a
    // repository full of documents DeliveryOS still cannot read. Landing both
    // together means the catalog is never halfway.
    expect(client.rest.pulls.create).toHaveBeenCalledTimes(1);
  });

  it('refuses to mirror INTO a folder library', async () => {
    const synced = syncedSharepointFolder();
    const destination = tempDir('deliveryos-folder-dest-');
    fs.writeFileSync(path.join(destination, 'placeholder.md'), '# x\n', 'utf-8');
    await addRemote(destination, 'not-a-catalog');

    // Mirroring exists to get material somewhere changes can be reviewed.
    // Mirroring into somewhere that cannot review them defeats the point, so it
    // is refused by capability rather than failing later on the URL's shape.
    await expect(mirrorAndAdopt(synced, profile, 'not-a-catalog', undefined, fakeGithub()))
      .rejects.toThrow(/cannot receive a mirror/);
  });
});

describe('the preview is the run, minus the commit', () => {
  it('plans exactly the ids the real run then commits', async () => {
    const synced = syncedSharepointFolder();
    const catalogRepo = await emptyCatalogRepo();
    await addRemoteEntry({ name: 'contoso', url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
    await cloneRemote('contoso', catalogRepo);
    const client = fakeGithub();

    // No GitHub client and no token: a dry run must stay something a person can
    // do before setting anything up.
    const preview = await planMirrorAndAdopt(synced, profile, 'contoso');
    const run = await mirrorAndAdopt(synced, profile, 'contoso', undefined, client);

    const previewed = preview.plan.candidates.map((c) => c.id).sort();
    const body: string = (client.rest.pulls.create as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].body;
    // The table's first column is the action; the id is the second.
    const committed = [...body.matchAll(/^\| (?:create|update) \| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]).sort();

    // The dry run used to mirror into an empty temp directory while the run
    // mirrored onto the cache. Same code path now, so this cannot drift.
    expect(committed).toEqual(previewed);
    expect(run.adopted).toBe(previewed.length);
  });

  it('leaves the cache exactly as it found it', async () => {
    const synced = syncedSharepointFolder();
    const catalogRepo = await emptyCatalogRepo();
    await addRemoteEntry({ name: 'contoso', url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
    await cloneRemote('contoso', catalogRepo);

    await planMirrorAndAdopt(synced, profile, 'contoso');

    // The preview now uses the cache as its workbench. Nothing of the mirror
    // may survive it: not the copied tree, not a manifest, not a branch.
    const cache = cachePath('contoso');
    const git = simpleGit(cache);
    expect((await git.branchLocal()).current).toBe('main');
    expect((await git.status()).isClean()).toBe(true);
    expect(fs.existsSync(path.join(cache, 'artifacts'))).toBe(false);
    expect(fs.existsSync(path.join(cache, 'playbooks'))).toBe(false);
  });
});

describe('a failed adoption leaves the cache as it found it', () => {
  /** Branch, cleanliness, and which top-level folders survived. All three
   * together, because each failure below dirties a different one. */
  async function cacheState(remote: string): Promise<{ branch: string; clean: boolean; leftovers: string[] }> {
    const cache = cachePath(remote);
    const git = simpleGit(cache);
    return {
      branch: (await git.branchLocal()).current,
      clean: (await git.status()).isClean(),
      leftovers: ['artifacts', 'playbooks', 'templates'].filter((d) => fs.existsSync(path.join(cache, d))),
    };
  }

  it('when the pull request fails to open', async () => {
    const synced = syncedSharepointFolder();
    const catalogRepo = await emptyCatalogRepo();
    await addRemoteEntry({ name: 'contoso', url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
    await cloneRemote('contoso', catalogRepo);
    const client = fakeGithub();
    (client.rest.pulls.create as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('GitHub is down'));

    await expect(mirrorAndAdopt(synced, profile, 'contoso', undefined, client)).rejects.toThrow(/GitHub is down/);

    // Before this guard the cache stayed parked on deliveryos/adopt/* with the
    // unmerged mirror committed, and every later list or pull read it as the
    // remote's real state -- the defect pushArtifact's own finally documents.
    expect(await cacheState('contoso')).toEqual({ branch: 'main', clean: true, leftovers: [] });
  });

  it('when planning refuses, before anything was committed', async () => {
    const synced = syncedSharepointFolder();
    // Two files under one rule that slug to the same id: an in-batch collision,
    // which planAdoption refuses -- AFTER the mirror has already copied the
    // client's tree into the cache.
    fs.mkdirSync(path.join(synced, 'playbooks', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(synced, 'playbooks', 'archive', 'handover.md'), '# Old handover\n', 'utf-8');
    const catalogRepo = await emptyCatalogRepo();
    await addRemoteEntry({ name: 'contoso', url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
    await cloneRemote('contoso', catalogRepo);

    await expect(mirrorAndAdopt(synced, profile, 'contoso', undefined, fakeGithub())).rejects.toThrow(/created twice/);

    // reset --hard restores tracked files and ignores untracked ones. Without
    // the clean, the mirrored folders and any half-written manifests stay in
    // the cache, and discoverManifests reads artifacts/ regardless of git.
    expect(await cacheState('contoso')).toEqual({ branch: 'main', clean: true, leftovers: [] });
  });
});

describe('adopting the same folder again', () => {
  async function adoptOnce(synced: string, catalogRepo: string, client = fakeGithub()) {
    const result = await mirrorAndAdopt(synced, profile, 'contoso', undefined, client);
    // Stand in for the merge, then refresh so the catalog reads the new tip.
    await simpleGit(catalogRepo).raw(['merge', '--ff-only', result.branch]);
    await refreshRemoteCache('contoso');
    return { result, client };
  }

  it('lands the client\'s edits, additions and deletions as one pull request', async () => {
    const synced = syncedSharepointFolder();
    const catalogRepo = await emptyCatalogRepo();
    await addRemoteEntry({ name: 'contoso', url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
    await cloneRemote('contoso', catalogRepo);
    await adoptOnce(synced, catalogRepo);

    // A week later, at the client.
    fs.writeFileSync(path.join(synced, 'playbooks', 'handover.md'), '# Handover checklist\n\nRevised steps.\n', 'utf-8');
    fs.rmSync(path.join(synced, 'templates', 'proposal.md'));
    fs.writeFileSync(path.join(synced, 'templates', 'sow.md'), '# Statement of work\n', 'utf-8');

    const client = fakeGithub();
    const second = await mirrorAndAdopt(synced, profile, 'contoso', undefined, client);

    // Before: refused outright -- every id was "already in the catalog".
    expect(client.rest.pulls.create).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ created: 1, updated: 1, retired: 1, unchanged: 1 });

    const status = (await simpleGit(catalogRepo).raw(['show', '--name-status', '--no-renames', '--pretty=format:', second.branch]))
      .split('\n').map((l) => l.trim()).filter(Boolean);
    expect(status).toContain('M\tplaybooks/handover.md');
    expect(status).toContain('D\ttemplates/proposal.md');
    expect(status).toContain('D\tartifacts/template-proposal/manifest.yaml');
    expect(status).toContain('A\ttemplates/sow.md');
    expect(status).toContain('A\tartifacts/template-sow/manifest.yaml');
    expect(status).toContain('M\tartifacts/playbook-handover/manifest.yaml');
    expect(status.some((l) => l.endsWith(MIRROR_RECORD))).toBe(true);

    // The changed file's artifact moved a patch; the untouched one did not.
    const handover = await simpleGit(catalogRepo).raw(['show', `${second.branch}:artifacts/playbook-handover/manifest.yaml`]);
    expect(handover).toMatch(/version: 1\.0\.1/);
    const body: string = (client.rest.pulls.create as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].body;
    expect(body).toContain('1 added, 1 changed, 1 removed, 1 unchanged');
  });

  it('refuses to open an empty pull request when nothing changed', async () => {
    const synced = syncedSharepointFolder();
    const catalogRepo = await emptyCatalogRepo();
    await addRemoteEntry({ name: 'contoso', url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
    await cloneRemote('contoso', catalogRepo);
    await adoptOnce(synced, catalogRepo);

    const client = fakeGithub();
    await expect(mirrorAndAdopt(synced, profile, 'contoso', undefined, client)).rejects.toThrow(/Nothing changed since the last adoption/);
    expect(client.rest.pulls.create).not.toHaveBeenCalled();

    // And the refusal left the cache as it found it.
    const cache = cachePath('contoso');
    expect((await simpleGit(cache).status()).isClean()).toBe(true);
  });
});

describe('mirrorFolder', () => {
  it('records what it mirrored, and on the next run removes only what it recorded', () => {
    const source = tempDir('deliveryos-src-');
    fs.mkdirSync(path.join(source, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(source, 'docs', 'a.md'), '# A\n', 'utf-8');
    fs.writeFileSync(path.join(source, 'docs', 'b.md'), '# B\n', 'utf-8');
    const dest = tempDir('deliveryos-dest-');
    // Not the mirror's: the catalog's own README, which must survive.
    fs.writeFileSync(path.join(dest, 'README.md'), '# catalog\n', 'utf-8');

    const first = mirrorFolder(source, dest);
    expect(first.added.sort()).toEqual(['docs/a.md', 'docs/b.md']);
    expect(first.removed).toEqual([]);
    const record = JSON.parse(fs.readFileSync(path.join(dest, MIRROR_RECORD), 'utf-8'));
    expect(Object.keys(record.files).sort()).toEqual(['docs/a.md', 'docs/b.md']);
    expect(record.files['docs/a.md']).toMatch(/^[0-9a-f]{64}$/);

    fs.rmSync(path.join(source, 'docs', 'b.md'));
    fs.writeFileSync(path.join(source, 'docs', 'a.md'), '# A, edited\n', 'utf-8');

    const second = mirrorFolder(source, dest);
    // Before this record existed the mirror was additive: b.md stayed forever.
    expect(second.changed).toEqual(['docs/a.md']);
    expect(second.removed).toEqual(['docs/b.md']);
    expect(fs.existsSync(path.join(dest, 'docs', 'b.md'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'README.md'))).toBe(true);
    expect(second.stagePaths).toContain('docs/b.md');
  });

  it('never copies a record it finds in the source over the one it is about to write', () => {
    // A source that was itself once mirrored, or is a folder remote's cache,
    // carries a record describing SOME OTHER destination. Copying it would
    // overwrite this mirror's record and, on the next run, delete files the
    // other destination happened to have.
    const source = tempDir('deliveryos-src-');
    fs.mkdirSync(path.join(source, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(source, 'docs', 'a.md'), '# A\n', 'utf-8');
    fs.writeFileSync(path.join(source, MIRROR_RECORD), JSON.stringify({ source: 'elsewhere', files: { 'ghost.md': 'x' } }), 'utf-8');
    const dest = tempDir('deliveryos-dest-');

    const result = mirrorFolder(source, dest);
    expect(result.written).toEqual(['docs/a.md']);
    const record = JSON.parse(fs.readFileSync(path.join(dest, MIRROR_RECORD), 'utf-8'));
    expect(record.source).toBe(path.resolve(source));
    expect(Object.keys(record.files)).toEqual(['docs/a.md']);
  });

  it('refuses a folder whose top level would collide with the catalog\'s own', () => {
    const source = tempDir('deliveryos-collide-');
    fs.mkdirSync(path.join(source, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(source, 'artifacts', 'x.md'), '# x\n', 'utf-8');
    const dest = tempDir('deliveryos-dest-');

    // Blending a client's folder called `artifacts` into the manifest layer
    // would corrupt the catalog in a way that is very hard to see afterwards.
    expect(() => mirrorFolder(source, dest)).toThrow(/bookkeeping/);
  });

  it('refuses an empty result rather than committing nothing', () => {
    const source = tempDir('deliveryos-empty-');
    fs.writeFileSync(path.join(source, 'desktop.ini'), 'x', 'utf-8');
    const dest = tempDir('deliveryos-dest-');

    // A folder of nothing but sync debris is a mistake worth naming, not a
    // successful mirror of zero files.
    expect(() => mirrorFolder(source, dest)).toThrow(/Nothing to mirror/);
  });
});
