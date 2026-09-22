import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { addRemote } from '../../src/engine/remote/manageRemotes';
import { buildCatalog } from '../../src/engine/catalog/catalog';
import { refreshRemoteCache, cachePath, lastFetchedAt } from '../../src/engine/remote/remoteCache';
import { detectBackendKind, backendFor, isSyncDetritus } from '../../src/engine/remote/backends';
import { pullArtifact } from '../../src/engine/pull/pull';
import { pushArtifact } from '../../src/engine/push/push';
import { planPush } from '../../src/engine/push/planPush';
import { rmDirWithRetry } from '../../src/engine/execHelpers';

/**
 * A catalog in an ordinary folder, which is what SharePoint, OneDrive and
 * Google Drive all look like once their sync client has run.
 *
 * WHY THE CENTRAL TEST IS AN EQUIVALENCE
 *
 * The claim this whole port rests on is that the read path never cared where
 * files came from -- catalog parsing is a directory walk, update detection
 * compares version strings, drift hashes bytes. If that is true, then the same
 * catalog materialised two different ways must read identically, and asserting
 * that is stronger than asserting the folder backend "works": it pins the
 * property rather than the implementation.
 *
 * The counterweight is the capability assertion. A folder can be read but not
 * contributed to, and the whole point of declaring capabilities rather than
 * assuming uniformity is that the refusal is specific and early instead of
 * being a confusing failure three layers deep in `parseGithubUrl`.
 */

let home: string;
let originalHome: string | undefined;
let scratch: string[] = [];

/** Writes the same tiny catalog into `root`, so two backends can be compared
 * on identical content rather than on two hand-written fixtures. */
function seedCatalog(root: string): void {
  const dir = path.join(root, 'artifacts', 'team-playbook');
  fs.mkdirSync(path.join(dir, 'payload'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.yaml'),
    [
      'id: team-playbook',
      'kind: doc',
      'description: How this team runs an engagement.',
      'owner: acme',
      'version: 1.0.0',
      'source_repo: acme-shared',
      'install_target: team-playbook',
      'review_required: false',
      '',
    ].join('\n'),
    'utf-8',
  );
  fs.writeFileSync(path.join(dir, 'payload', 'playbook.md'), '# Playbook\n', 'utf-8');
}

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

beforeEach(() => {
  originalHome = process.env.DELIVERYOS_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-folder-home-'));
  process.env.DELIVERYOS_HOME = home;
  scratch = [];
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.DELIVERYOS_HOME;
  else process.env.DELIVERYOS_HOME = originalHome;
  for (const dir of [home, ...scratch]) await rmDirWithRetry(dir);
});

describe('choosing a backend', () => {
  it('treats a plain directory as a folder and a git repo as git', async () => {
    const plain = tempDir('deliveryos-plain-');
    expect(detectBackendKind(plain)).toBe('folder');

    // A directory that IS a repository stays `git`: that is how every e2e
    // fixture works, and cloning preserves history a copy would discard.
    const repo = tempDir('deliveryos-repo-');
    await simpleGit(repo).init();
    expect(detectBackendKind(repo)).toBe('git');
  });

  it('treats anything that is not a path on this machine as git', () => {
    // Decided by asking the filesystem, not by matching the string -- `git
    // clone` accepts far more shapes than any pattern would keep up with.
    for (const url of [
      'https://github.com/acme/artifacts.git',
      'git@github.com:acme/artifacts.git',
      'ssh://git@git.internal/artifacts.git',
      'file:///srv/artifacts',
      '/this/path/does/not/exist',
    ]) {
      expect(detectBackendKind(url), url).toBe('git');
    }
  });

  it('defaults to git when a registry entry records no backend', () => {
    // The no-migration property. Every registry written before this change has
    // no `backend` field, and every remote in one is a git remote.
    expect(backendFor(undefined).kind).toBe('git');
  });

  it('declares different capabilities, which is the whole reason for the port', () => {
    expect(backendFor('git').capabilities.opensPullRequests).toBe(true);
    expect(backendFor('folder').capabilities.opensPullRequests).toBe(false);
    expect(backendFor('folder').capabilities.supportsAtomicWrite).toBe(false);
  });
});

describe('a catalog in a plain folder', () => {
  it('reads identically to the same catalog in a git repo', async () => {
    // The load-bearing test. Same bytes, two backends, one answer.
    const folderSrc = tempDir('deliveryos-src-folder-');
    seedCatalog(folderSrc);

    const gitSrc = tempDir('deliveryos-src-git-');
    seedCatalog(gitSrc);
    const git = simpleGit(gitSrc);
    await git.init();
    await git.add(['.']);
    await git.raw(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'seed']);

    const asFolder = await addRemote(folderSrc, 'via-folder');
    const asGit = await addRemote(gitSrc, 'via-git');
    expect(asFolder.backend).toBe('folder');
    expect(asGit.backend).toBe('git');

    const catalog = buildCatalog();
    const fromFolder = catalog.filter((e) => e.remoteName === 'via-folder');
    const fromGit = catalog.filter((e) => e.remoteName === 'via-git');

    expect(fromFolder).toHaveLength(1);
    expect(fromGit).toHaveLength(1);
    // Every manifest field, not just the id -- an equivalence that only checked
    // the id would pass while the description or install target differed.
    expect(fromFolder[0].manifest).toEqual(fromGit[0].manifest);
  });

  it('installs an artifact that lands where the manifest says', async () => {
    const src = tempDir('deliveryos-src-');
    seedCatalog(src);
    await addRemote(src, 'acme');

    const project = tempDir('deliveryos-project-');
    await pullArtifact('team-playbook', undefined, project);

    // The acceptance criterion: not "it appeared in a list" but "the file is
    // where a person would look for it".
    const landed = path.join(project, 'team-playbook', 'playbook.md');
    expect(fs.existsSync(landed)).toBe(true);
    expect(fs.readFileSync(landed, 'utf-8')).toBe('# Playbook\n');
  });

  it('keeps sync clutter out of the cache', async () => {
    const src = tempDir('deliveryos-src-');
    seedCatalog(src);
    // The four a real synced folder actually produces.
    fs.writeFileSync(path.join(src, 'desktop.ini'), 'x', 'utf-8');
    fs.writeFileSync(path.join(src, '.DS_Store'), 'x', 'utf-8');
    const payload = path.join(src, 'artifacts', 'team-playbook', 'payload');
    fs.writeFileSync(path.join(payload, '~$draft.docx'), 'x', 'utf-8');
    fs.writeFileSync(path.join(payload, 'notes.md.tmp'), 'x', 'utf-8');

    await addRemote(src, 'acme');
    const cachedPayload = path.join(cachePath('acme'), 'artifacts', 'team-playbook', 'payload');

    // Without this filter they are read as artifact content AND, once
    // installed, as local edits the user never made.
    expect(fs.readdirSync(cachedPayload).sort()).toEqual(['playbook.md']);
    expect(fs.existsSync(path.join(cachePath('acme'), 'desktop.ini'))).toBe(false);
    expect(fs.existsSync(path.join(cachePath('acme'), '.DS_Store'))).toBe(false);
  });

  it('reports when the cache was last copied', async () => {
    const src = tempDir('deliveryos-src-');
    seedCatalog(src);
    await addRemote(src, 'acme');

    // git gets this free from FETCH_HEAD's mtime; a copy has to record it. What
    // matters is that the contract holds for both, because a caller that cannot
    // tell how stale a catalog is must say so rather than assert freshness.
    const at = lastFetchedAt('acme');
    expect(at).toBeInstanceOf(Date);
    expect(Date.now() - (at as Date).getTime()).toBeLessThan(60_000);
  });

  it('drops a file the source deleted, rather than keeping it forever', async () => {
    const src = tempDir('deliveryos-src-');
    seedCatalog(src);
    const extra = path.join(src, 'artifacts', 'team-playbook', 'payload', 'appendix.md');
    fs.writeFileSync(extra, '# Appendix\n', 'utf-8');
    await addRemote(src, 'acme');

    const cached = path.join(cachePath('acme'), 'artifacts', 'team-playbook', 'payload', 'appendix.md');
    expect(fs.existsSync(cached)).toBe(true);

    fs.rmSync(extra);
    await refreshRemoteCache('acme');

    // A merging refresh would leave this behind, and the catalog would keep
    // serving a file the source no longer has -- the same class of bug as an
    // update that adds files but never removes them.
    expect(fs.existsSync(cached)).toBe(false);
  });

  it('refuses a source that is not a folder, saying what to do instead', async () => {
    await expect(addRemote(path.join(os.tmpdir(), 'deliveryos-nope-does-not-exist')))
      .rejects.toThrow(/not a recognizable github\.com URL|could not read|not found|does not exist|repository/i);
  });
});

describe('contributing to a folder library', () => {
  it('refuses by capability, not by URL shape', async () => {
    const src = tempDir('deliveryos-src-');
    seedCatalog(src);
    await addRemote(src, 'acme');

    const project = tempDir('deliveryos-project-');
    await pullArtifact('team-playbook', undefined, project);
    fs.writeFileSync(
      path.join(project, 'team-playbook', 'playbook.md'),
      '# Playbook, edited\n',
      'utf-8',
    );

    // Before the port this failed at `parseGithubUrl` with "not a recognizable
    // github.com URL" -- true, unhelpful, and blaming the wrong thing. The
    // problem is not how the URL is spelled; it is that a folder cannot hold a
    // proposal somebody reviews while the original stays untouched.
    await expect(pushArtifact('team-playbook', {}, project)).rejects.toThrow(
      /folder library.*reviewed before it lands/s,
    );
  });

  it('refuses the PREVIEW with the same sentence, not the URL parser\'s', async () => {
    const src = tempDir('deliveryos-src-');
    seedCatalog(src);
    await addRemote(src, 'acme');
    const project = tempDir('deliveryos-project-');
    await pullArtifact('team-playbook', undefined, project);
    fs.writeFileSync(path.join(project, 'team-playbook', 'playbook.md'), '# Playbook, edited\n', 'utf-8');

    // planPush used to call parseGithubUrl purely for its throw, so the preview
    // -- the thing a person reads before approving -- blamed the URL's spelling
    // while the push itself blamed the missing review step. Plan and apply must
    // refuse for the same reason in the same words.
    expect(() => planPush('team-playbook', project)).toThrow(/folder library.*reviewed before it lands/s);
    expect(() => planPush('team-playbook', project)).not.toThrow(/github\.com URL/);
  });
});

describe('isSyncDetritus', () => {
  it('names what a sync client leaves behind, and nothing else', () => {
    for (const junk of ['desktop.ini', 'Desktop.ini', '.DS_Store', 'Thumbs.db', '~$report.docx', 'x.tmp', 'a.crdownload']) {
      expect(isSyncDetritus(junk), junk).toBe(true);
    }
    // The counterweight. Over-matching here silently deletes real content, and
    // a payload is allowed to contain a file with an awkward name.
    for (const real of ['playbook.md', 'manifest.yaml', 'README.md', 'template.docx', 'notes~.md', 'tmp.md']) {
      expect(isSyncDetritus(real), real).toBe(false);
    }
  });
});
