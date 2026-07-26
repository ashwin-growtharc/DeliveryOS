import { GithubApiError, UnsupportedRemoteError } from '../errors';

/**
 * The minimal Octokit-shaped surface DeliveryOS actually calls. Every
 * function in this module takes one of these as a parameter rather than
 * constructing its own -- production code builds a real one via
 * `createOctokit`, tests inject a plain object with `vi.fn()` methods.
 */
export interface GithubClient {
  rest: {
    repos: {
      get(params: { owner: string; repo: string }): Promise<{ data: { default_branch: string } }>;
    };
    pulls: {
      create(params: {
        owner: string;
        repo: string;
        head: string;
        base: string;
        title: string;
        body: string;
      }): Promise<{ data: { html_url: string; number: number } }>;
      get(params: {
        owner: string;
        repo: string;
        pull_number: number;
      }): Promise<{ data: { state: string; merged: boolean; html_url: string } }>;
    };
  };
}

// git@github.com:owner/repo(.git)
const SSH_PATTERN = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/;
// https://github.com/owner/repo(.git)
const HTTPS_PATTERN = /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/;

/**
 * Parses a github.com remote URL (SSH or HTTPS form) into its owner/repo.
 * Phase 1 only knows how to open PRs against GitHub, by design -- any other
 * host throws UnsupportedRemoteError rather than silently doing nothing.
 */
export function parseGithubUrl(url: string): { owner: string; repo: string } {
  const sshMatch = url.match(SSH_PATTERN);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  const httpsMatch = url.match(HTTPS_PATTERN);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  throw new UnsupportedRemoteError(
    `"${url}" is not a recognizable github.com URL. DeliveryOS's push command only supports GitHub-hosted remotes (SSH like "git@github.com:owner/repo.git" or HTTPS like "https://github.com/owner/repo").`,
  );
}

/** Fetches the remote's current default branch name via the GitHub API. */
export async function getDefaultBranch(
  octokit: GithubClient,
  owner: string,
  repo: string,
): Promise<string> {
  try {
    const response = await octokit.rest.repos.get({ owner, repo });
    return response.data.default_branch;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new GithubApiError(`Failed to fetch the default branch for ${owner}/${repo}: ${detail}`);
  }
}

export interface OpenPullRequestParams {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
}

export interface OpenPullRequestResult {
  url: string;
  number: number;
}

/** Opens a pull request via the GitHub API. */
export async function openPullRequest(
  octokit: GithubClient,
  params: OpenPullRequestParams,
): Promise<OpenPullRequestResult> {
  try {
    const response = await octokit.rest.pulls.create(params);
    return { url: response.data.html_url, number: response.data.number };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new GithubApiError(
      `Failed to open a pull request for ${params.owner}/${params.repo} (${params.head} -> ${params.base}): ${detail}`,
    );
  }
}

export interface PullRequestStatus {
  number: number;
  url: string;
  state: 'open' | 'closed';
  merged: boolean;
}

/** Fetches a specific pull request's current real state -- open, closed
 * (rejected), or merged. This is the only way to know whether a
 * previously-opened DeliveryOS push PR has actually been accepted, since
 * opening it doesn't tell you anything about what happens to it afterward. */
export async function getPullRequestStatus(
  octokit: GithubClient,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestStatus> {
  try {
    const response = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
    return {
      number: pullNumber,
      url: response.data.html_url,
      state: response.data.state === 'closed' ? 'closed' : 'open',
      merged: response.data.merged,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new GithubApiError(`Failed to fetch PR #${pullNumber} status for ${owner}/${repo}: ${detail}`);
  }
}

/**
 * Constructs a real, token-authenticated Octokit client. This is the ONLY
 * place in src/ that constructs an Octokit instance -- everything else in
 * this module takes an already-constructed `GithubClient` as a parameter,
 * which is what lets tests inject a fake one and never hit the network or
 * require real `gh`/GitHub auth.
 *
 * `@octokit/rest` ships as an ESM-only package, while this project compiles
 * to CommonJS. A static `import { Octokit } from '@octokit/rest'` at the
 * top of this file would make `require()`-ing this module throw
 * `ERR_REQUIRE_ESM` as soon as it's loaded -- even if this function is
 * never called (which would break every CLI invocation and every test,
 * since program.ts registers the push command unconditionally). A dynamic
 * `import()` defers loading the ESM module until `createOctokit` actually
 * runs, which only happens on a real `deliveryos push` invocation.
 *
 * Under a `commonjs` build target, tsc compiles this dynamic `import()` down
 * to a `require()` call (see dist/engine/github/github.js), so loading an
 * ESM-only package this way only works because of Node's native
 * `require(esm)` support (unflagged since Node 22.12/23.x, and in all 24.x).
 * `package.json`'s `engines.node` pins that floor so an install on an older
 * Node prints an engine-mismatch warning instead of this failing with a
 * confusing `ERR_REQUIRE_ESM` at push time.
 */
export async function createOctokit(token: string): Promise<GithubClient> {
  const { Octokit } = await import('@octokit/rest');
  return new Octokit({ auth: token });
}
