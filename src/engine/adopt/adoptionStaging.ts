import * as fs from 'fs';
import * as path from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { cachePath, withRemoteCacheLock } from '../remote/remoteCache';
import { RemoteEntry } from '../remote/remoteRegistry';
import { requireContributableRemote } from '../remote/requireContributableRemote';
import {
  fetchAndReset,
  createBranch,
  commitPaths,
  pushBranch,
  getCommitIdentity,
  GitIdentity,
} from '../git/git';
import { fetchRepoInfo, openPullRequest, createOctokit, GithubClient } from '../github/github';
import { getGithubToken } from '../github/githubAuth';
import { ProgressCallback } from '../pull/pull';
import { buildBranchName } from '../push/branchName';
import { AdoptionPlan } from './planAdoption';
import { leaveCacheOnTip } from './leaveCacheOnTip';

/**
 * The two halves every adoption shares: a staged cache to work in, and the git
 * tail that turns a plan into one pull request.
 *
 * WHY THIS FILE EXISTS
 *
 * `adoptArtifacts` (manifests over a client's git repo) and `mirrorAndAdopt`
 * (copy a synced folder in, then manifests) were line-for-line copies of each
 * other from the lock onwards -- branch name, manifest-writing loop, commit,
 * push, PR, cleanup. The `finally` that puts the cache back on the remote's tip
 * had to be added to both, and would have had to be fixed in both. And the
 * CLI's `--dry-run` rebuilt the plan by hand in a temp directory, which meant
 * the preview and the real run computed their plans through different code --
 * the exact "preview that lies" the command's own comment warned against.
 *
 * Now: one `withAdoptionStaging` that every adoption path runs inside, and one
 * `commitAdoption` that every path that actually commits calls.
 *
 * WHY `forCommit()` IS LAZY
 *
 * A dry run needs the staged cache and nothing else. Reaching GitHub for the
 * default branch and reading the committer identity are only needed by a run
 * that will commit -- and the first of those needs a token. A dry run that
 * demanded `gh auth login` would be a regression for the person the dry run is
 * for: someone deciding whether to trust this before they set anything up.
 */

export interface CommitTarget {
  client: GithubClient;
  owner: string;
  repo: string;
  defaultBranch: string;
  identity: GitIdentity;
}

export interface StagingContext {
  remoteName: string;
  remoteEntry: RemoteEntry;
  /** The remote's cache, freshly reset to its tip. Everything an adoption
   * writes goes here, and `leaveCacheOnTip` removes it all afterwards. */
  cacheDir: string;
  /** Everything a commit needs, fetched on first call. See the note above. */
  forCommit(): Promise<CommitTarget>;
}

/**
 * Runs `fn` against the remote's cache under its lock, freshly reset, and puts
 * the cache back on the remote's tip afterwards whatever `fn` did -- returned,
 * threw, or half-wrote a mirror. See `leaveCacheOnTip` for why that is a
 * `finally` and why it cleans as well as resets.
 */
export async function withAdoptionStaging<T>(
  remoteName: string,
  onProgress: ProgressCallback | undefined,
  injectedClient: GithubClient | undefined,
  fn: (ctx: StagingContext) => Promise<T>,
): Promise<T> {
  const { entry: remoteEntry, owner, repo } = requireContributableRemote(remoteName);
  const cacheDir = cachePath(remoteName);

  return withRemoteCacheLock(remoteName, async () => {
    onProgress?.('fetch', `Refreshing "${remoteName}"...`);
    await fetchAndReset(cacheDir);

    let target: Promise<CommitTarget> | undefined;
    const ctx: StagingContext = {
      remoteName,
      remoteEntry,
      cacheDir,
      forCommit() {
        target ??= (async () => {
          // `createOctokit` is async: Octokit is ESM-only and reached via a
          // dynamic import from a CommonJS build, which is why the whole repo
          // has a Node 22.12 engines floor.
          const client = injectedClient ?? (await createOctokit(getGithubToken()));
          const { defaultBranch } = await fetchRepoInfo(client, owner, repo);
          const identity = await getCommitIdentity(cacheDir);
          return { client, owner, repo, defaultBranch, identity };
        })();
        return target;
      },
    };

    try {
      return await fn(ctx);
    } finally {
      await leaveCacheOnTip(cacheDir, remoteName, onProgress);
    }
  });
}

export interface CommitAdoptionParams {
  ctx: StagingContext;
  plan: AdoptionPlan;
  pr: { title: string; body: string };
  /** Paths already written into the cache that belong in the same commit --
   * the mirrored client tree. Manifests are added here. */
  extraPaths?: string[];
  onProgress?: ProgressCallback;
}

export interface CommitAdoptionResult {
  branch: string;
  prUrl: string;
  prNumber: number;
  /** Manifest paths written, relative to the cache root. */
  manifests: string[];
}

function manifestPathFor(cacheDir: string, id: string): string {
  return path.join(cacheDir, 'artifacts', id, 'manifest.yaml');
}

/**
 * Writes the plan's manifests into the staged cache and lands everything as one
 * branch, one commit, one pull request.
 *
 * WHY THIS IS NOT `pushArtifact` IN A LOOP
 *
 * `pushArtifact` is id-scoped end to end -- the lockfile check, the branch
 * name, the collision check and the pull-request body all take a single
 * artifact -- and it carries three modes' worth of hard-won guards, including
 * the ones whose comments record a bug that opened a pull request DELETING an
 * artifact's entire payload. Threading a list through every branch of it would
 * put all of that at risk to save writing this.
 *
 * Its tail, though, is already generic: `createBranch`, `commitPaths` (which
 * takes a list already), `pushBranch`, `openPullRequest`. Those are reused
 * verbatim; the manifest loop above them is the only new part.
 */
export async function commitAdoption(params: CommitAdoptionParams): Promise<CommitAdoptionResult> {
  const { ctx, plan, pr, onProgress } = params;
  const extraPaths = params.extraPaths ?? [];
  const { client, owner, repo, defaultBranch, identity } = await ctx.forCommit();

  // Same shape as a push branch, random suffix included -- two adoptions in
  // the same second used to collide on createBranch.
  const branch = buildBranchName('adopt');

  // Written only after the fetch, so nothing is staged against a stale tree.
  const manifests: string[] = [];
  for (const candidate of plan.candidates) {
    const target = manifestPathFor(ctx.cacheDir, candidate.id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, stringifyYaml(candidate.manifest), 'utf-8');
    manifests.push(path.relative(ctx.cacheDir, target).split(path.sep).join('/'));
  }

  onProgress?.('branch', `Creating branch "${branch}"...`);
  await createBranch(ctx.cacheDir, branch);
  onProgress?.(
    'commit',
    extraPaths.length > 0
      ? `Committing ${extraPaths.length} file(s) and ${manifests.length} manifest(s)...`
      : `Committing ${manifests.length} manifest(s)...`,
  );
  await commitPaths(ctx.cacheDir, [...extraPaths, ...manifests], pr.title, identity);
  onProgress?.('push', `Pushing branch "${branch}"...`);
  await pushBranch(ctx.cacheDir, branch);

  onProgress?.('pr-open', 'Opening pull request...');
  const opened = await openPullRequest(client, {
    owner,
    repo,
    head: branch,
    base: defaultBranch,
    title: pr.title,
    body: pr.body,
  });

  return { branch, prUrl: opened.url, prNumber: opened.number, manifests };
}
