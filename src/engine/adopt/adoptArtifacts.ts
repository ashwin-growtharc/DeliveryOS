import * as fs from 'fs';
import * as path from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { cachePath, withRemoteCacheLock } from '../remote/remoteCache';
import {
  fetchAndReset,
  createBranch,
  commitPaths,
  pushBranch,
  getCommitIdentity,
} from '../git/git';
import {
  fetchRepoInfo,
  openPullRequest,
  createOctokit,
  GithubClient,
} from '../github/github';
import { getGithubToken } from '../github/githubAuth';
import { AdoptionPlan } from './planAdoption';
import { leaveCacheOnTip } from './leaveCacheOnTip';
import { ProgressCallback } from '../pull/pull';
import { buildBranchName } from '../push/branchName';
import { requireContributableRemote } from '../remote/requireContributableRemote';

/**
 * Commits an adoption plan as ONE change.
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
 * verbatim; the loop above them is the only new part.
 *
 * THE PROPERTY THAT MAKES A 200-ARTIFACT PULL REQUEST REVIEWABLE
 *
 * `filesToCommit` contains ONLY manifests. `push --new` copies a payload into
 * the catalog because the artifact is new to it; adoption does not, because the
 * files are already there -- that is the entire point of `payload_path`. So the
 * diff is N small YAML files and not one byte of content, which is the
 * difference between a change somebody can read and one they rubber-stamp.
 */

export interface AdoptionResult {
  branch: string;
  prUrl: string;
  prNumber: number;
  adopted: number;
}


function manifestPathFor(cacheDir: string, id: string): string {
  return path.join(cacheDir, 'artifacts', id, 'manifest.yaml');
}

/** The pull-request body: one table, not N sections. A reviewer needs to see
 * the shape of the change and spot the wrong rows, and twenty headings hide
 * both. */
function buildAdoptionPr(plan: AdoptionPlan): { title: string; body: string } {
  const rows = plan.candidates
    .map(
      (c) =>
        `| \`${c.id}\` | ${c.manifest.kind} | \`${c.sourcePath}\` | \`${c.manifest.install_target}\` |`
        + `${c.descriptionGuessed ? ' guessed |' : ' from the file |'}`,
    )
    .join('\n');

  const guessed = plan.candidates.filter((c) => c.descriptionGuessed);

  const body = [
    `Registers ${plan.candidates.length} existing file(s) as artifacts.`,
    '',
    '**No content is moved or copied.** Each manifest points at the file where it',
    'already lives, via `payload_path`, so editing the original keeps working.',
    '',
    '| id | kind | file | installs to | description |',
    '|---|---|---|---|---|',
    rows,
    '',
    ...(guessed.length > 0
      ? [
        `### ${guessed.length} description(s) were derived, not declared`,
        '',
        'These came from the file\'s first heading because it declares no',
        '`description:` of its own. Worth reading before merging -- a heading is a',
        'title, and a description is meant to help somebody choose.',
        '',
        ...guessed.map((c) => `- \`${c.id}\` — "${c.manifest.description}"`),
        '',
      ]
      : []),
    ...(plan.skipped.length > 0
      ? [
        `### ${plan.skipped.length} file(s) were skipped`,
        '',
        ...plan.skipped.map((s) => `- \`${s.sourcePath}\` — ${s.reason}`),
        '',
      ]
      : []),
  ].join('\n');

  return { title: `Adopt ${plan.candidates.length} artifact(s)`, body };
}

export async function adoptArtifacts(
  plan: AdoptionPlan,
  remoteName: string,
  onProgress?: ProgressCallback,
  injectedClient?: GithubClient,
): Promise<AdoptionResult> {
  // Never checked the capability before -- a folder library would have failed
  // later, at parseGithubUrl, blaming the URL. Same check as every other
  // contributing path now.
  const { owner, repo } = requireContributableRemote(remoteName);
  // `createOctokit` is async: Octokit is ESM-only and reached via a dynamic
  // import from a CommonJS build, which is why the whole repo has a Node 22.12
  // engines floor.
  const client = injectedClient ?? (await createOctokit(getGithubToken()));
  const cacheDir = cachePath(remoteName);
  const branch = buildBranchName('adopt');

  return withRemoteCacheLock(remoteName, async () => {
    onProgress?.('fetch', `Refreshing "${remoteName}"...`);
    await fetchAndReset(cacheDir);

    const { defaultBranch } = await fetchRepoInfo(client, owner, repo);
    const identity = await getCommitIdentity(cacheDir);

    try {
    // Written only after the fetch, so nothing is staged against a stale tree.
    const written: string[] = [];
    for (const candidate of plan.candidates) {
      const target = manifestPathFor(cacheDir, candidate.id);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, stringifyYaml(candidate.manifest), 'utf-8');
      written.push(path.relative(cacheDir, target).split(path.sep).join('/'));
    }

    const { title, body } = buildAdoptionPr(plan);

    onProgress?.('branch', `Creating branch "${branch}"...`);
    await createBranch(cacheDir, branch);
    onProgress?.('commit', `Committing ${written.length} manifest(s)...`);
    await commitPaths(cacheDir, written, title, identity);
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
      adopted: plan.candidates.length,
    };
    } finally {
      // Now actually finally-shaped, which the comment here used to only
      // aspire to. See leaveCacheOnTip.
      await leaveCacheOnTip(cacheDir, remoteName, onProgress);
    }
  });
}
