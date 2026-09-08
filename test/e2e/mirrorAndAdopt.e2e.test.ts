import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { cachePath, cloneRemote, refreshRemoteCache } from '../../src/engine/remote/remoteCache';
import { addRemote } from '../../src/engine/remote/manageRemotes';
import { buildCatalog } from '../../src/engine/catalog/catalog';
import { pullArtifact } from '../../src/engine/pull/pull';
import { mirrorAndAdopt } from '../../src/engine/adopt/mirrorAndAdopt';
import { mirrorFolder } from '../../src/engine/adopt/mirrorFolder';
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

describe('mirrorFolder', () => {
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
