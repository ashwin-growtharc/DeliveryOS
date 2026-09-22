import * as fs from 'fs';
import * as path from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { findRemote, RemoteEntry } from '../remote/remoteRegistry';
import { cachePath, withRemoteCacheLock } from '../remote/remoteCache';
import { backendFor } from '../remote/backends';
import {
  fetchAndReset,
  createBranch,
  commitPaths,
  pushBranch,
  getCommitIdentity,
} from '../git/git';
import {
  parseGithubUrl,
  fetchRepoInfo,
  openPullRequest,
  createOctokit,
  GithubClient,
} from '../github/github';
import { getGithubToken } from '../github/githubAuth';
import { RemoteRegistryError, UnsupportedRemoteError } from '../errors';
import { ProgressCallback } from '../pull/pull';
import { buildCatalog } from '../catalog/catalog';
import { AdoptionProfile } from './profile';
import { planAdoption, AdoptionPlan } from './planAdoption';
import { mirrorFolder } from './mirrorFolder';
import { leaveCacheOnTip } from './leaveCacheOnTip';
import { buildBranchName } from '../push/branchName';

/**
 * Takes a client's folder -- typically a synced SharePoint, OneDrive or Drive
 * directory -- and turns it into a usable catalog in one operation.
 *
 * WHY MIRROR AND ADOPT ARE ONE PULL REQUEST AND NOT TWO
 *
 * They could be separate: copy the files, then lay the manifests over them.
 * They are not, for two reasons.
 *
 * A mirror on its own produces a repository full of documents that DeliveryOS
 * still cannot read -- `discoverManifests` finds nothing without an
 * `artifacts/` directory. Asking somebody to review and merge that is asking
 * them to approve a change with no observable effect, which is how a review
 * becomes a rubber stamp.
 *
 * And in between the two, the catalog would be in a state that is neither the
 * old thing nor the new one. Landing both together means the repository is
 * always either "not adopted" or "adopted", never halfway.
 *
 * WHAT THIS COSTS, STATED PLAINLY
 *
 * The pull request contains content, not just manifests. That is the honest
 * difference between adopting a client's git repository -- where the files are
 * already there, and the diff really is only manifests -- and mirroring from
 * storage that cannot host a catalog. Worth knowing before opening it: this
 * diff is as large as the client's folder.
 */

export interface MirrorAndAdoptResult {
  branch: string;
  prUrl: string;
  prNumber: number;
  mirrored: number;
  adopted: number;
  /** Files copied but not adopted -- no rule matched them, or they could not
   * describe themselves. They are in the repository and simply are not
   * artifacts, which is a normal outcome worth reporting rather than hiding. */
  notAdopted: number;
  unreadable: string[];
}

function buildPr(
  sourceLabel: string,
  plan: AdoptionPlan,
  mirroredCount: number,
  unreadable: string[],
): { title: string; body: string } {
  const guessed = plan.candidates.filter((c) => c.descriptionGuessed);

  const body = [
    `Mirrors \`${sourceLabel}\` into this catalog and registers ${plan.candidates.length} of its`,
    'files as artifacts.',
    '',
    `**${mirroredCount} file(s) copied.** The client's own folder structure is preserved at the`,
    'repository root, and each manifest points back at a file through `payload_path` rather',
    'than duplicating it.',
    '',
    '| id | kind | file | installs to | description |',
    '|---|---|---|---|---|',
    ...plan.candidates.map(
      (c) =>
        `| \`${c.id}\` | ${c.manifest.kind} | \`${c.sourcePath}\` | \`${c.manifest.install_target}\` | `
        + `${c.descriptionGuessed ? 'derived' : 'from the file'} |`,
    ),
    '',
    ...(guessed.length > 0
      ? [
        `### ${guessed.length} description(s) were derived, not declared`,
        '',
        'Taken from the file\'s first heading, because it declares none of its own. A heading is',
        'a title; a description is meant to help somebody choose. Worth reading before merging.',
        '',
        ...guessed.map((c) => `- \`${c.id}\` — "${c.manifest.description}"`),
        '',
      ]
      : []),
    ...(plan.skipped.length > 0
      ? [
        `### ${plan.skipped.length} file(s) were copied but not adopted`,
        '',
        ...plan.skipped.map((s) => `- \`${s.sourcePath}\` — ${s.reason}`),
        '',
      ]
      : []),
    ...(unreadable.length > 0
      ? [
        `### ${unreadable.length} file(s) could not be read`,
        '',
        'If this folder syncs from the cloud, these may not be downloaded yet. Open them once',
        'in the sync client and re-run.',
        '',
        ...unreadable.map((f) => `- \`${f}\``),
        '',
      ]
      : []),
  ].join('\n');

  return { title: `Adopt ${plan.candidates.length} artifact(s) from ${sourceLabel}`, body };
}

/**
 * The remote an adoption goes into, checked once for both the real run and
 * `adopt --dry-run`, so the two cannot disagree about what is allowed.
 *
 * The destination has to be able to accept a proposal. Asserted here rather
 * than discovered at `parseGithubUrl`, so the message names the real problem:
 * mirroring INTO a folder library would produce a catalog nobody could review
 * or contribute to, which defeats the point of mirroring at all.
 */
export function resolveAdoptionTarget(remoteName: string): RemoteEntry {
  const remoteEntry = findRemote(remoteName);
  if (!remoteEntry) {
    throw new RemoteRegistryError(`No remote named "${remoteName}" is registered`);
  }
  const backend = backendFor(remoteEntry.backend);
  if (!backend.capabilities.opensPullRequests) {
    throw new UnsupportedRemoteError(
      `"${remoteName}" is a ${backend.kind} library, so it cannot receive a mirror. `
        + 'Mirroring exists to get a client\'s material somewhere changes can be reviewed -- '
        + 'point this at a git catalog instead.',
    );
  }
  return remoteEntry;
}

export async function mirrorAndAdopt(
  sourceFolder: string,
  profile: AdoptionProfile,
  remoteName: string,
  onProgress?: ProgressCallback,
  injectedClient?: GithubClient,
): Promise<MirrorAndAdoptResult> {
  const remoteEntry = resolveAdoptionTarget(remoteName);

  const { owner, repo } = parseGithubUrl(remoteEntry.url);
  const client = injectedClient ?? (await createOctokit(getGithubToken()));
  const cacheDir = cachePath(remoteName);
  // Same shape as a push branch, random suffix included -- two adoptions in
  // the same second used to collide on createBranch.
  const branch = buildBranchName('adopt');
  const sourceLabel = path.basename(path.resolve(sourceFolder));

  return withRemoteCacheLock(remoteName, async () => {
    onProgress?.('fetch', `Refreshing "${remoteName}"...`);
    await fetchAndReset(cacheDir);

    const { defaultBranch } = await fetchRepoInfo(client, owner, repo);
    const identity = await getCommitIdentity(cacheDir);

    try {
    onProgress?.('mirror', `Copying "${sourceLabel}"...`);
    const mirror = mirrorFolder(sourceFolder, cacheDir);

    // Planned against the MIRRORED tree, not the source. The two should be
    // identical, and reading the copy is what guarantees the plan describes
    // what will actually be committed rather than what was on the client's disk
    // a moment ago.
    onProgress?.('plan', 'Working out what can become an artifact...');
    const existing = buildCatalog()
      .filter((e) => e.remoteName === remoteName)
      .map((e) => e.manifest.id);
    const plan = planAdoption(cacheDir, profile, existing, remoteEntry.url);

    const manifests: string[] = [];
    for (const candidate of plan.candidates) {
      const target = path.join(cacheDir, 'artifacts', candidate.id, 'manifest.yaml');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, stringifyYaml(candidate.manifest), 'utf-8');
      manifests.push(path.relative(cacheDir, target).split(path.sep).join('/'));
    }

    const { title, body } = buildPr(sourceLabel, plan, mirror.written.length, mirror.unreadable);

    onProgress?.('branch', `Creating branch "${branch}"...`);
    await createBranch(cacheDir, branch);
    onProgress?.('commit', `Committing ${mirror.written.length} file(s) and ${manifests.length} manifest(s)...`);
    await commitPaths(cacheDir, [...mirror.written, ...manifests], title, identity);
    onProgress?.('push', `Pushing branch "${branch}"...`);
    await pushBranch(cacheDir, branch);

    onProgress?.('pr-open', 'Opening pull request...');
    const opened = await openPullRequest(client, {
      owner,
      repo,
      head: branch,
      base: defaultBranch,
      title,
      body,
    });

    return {
      branch,
      prUrl: opened.url,
      prNumber: opened.number,
      mirrored: mirror.written.length,
      adopted: plan.candidates.length,
      notAdopted: plan.skipped.length,
      unreadable: mirror.unreadable,
    };
    } finally {
      // Whatever happened above -- the PR opened, the push failed, the plan
      // refused -- every later read of this cache must see the remote's real
      // tip, not a half-built mirror. See leaveCacheOnTip for why this is a
      // finally and why it cleans as well as resets.
      await leaveCacheOnTip(cacheDir, remoteName, onProgress);
    }
  });
}
