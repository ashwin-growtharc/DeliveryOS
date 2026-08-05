import simpleGit, { SimpleGit } from 'simple-git';
import * as fs from 'fs';
import { GitOperationError } from '../errors';

/**
 * Thin wrapper around simple-git. Clones `url` into `dest` (which must not
 * already exist). On failure, any partial directory created by the clone
 * attempt is removed and git's own stderr/message is bubbled up.
 *
 * Forces `core.autocrlf=false` for this clone specifically (not the user's
 * global git config) -- a real bug found via Phase 7's end-to-end test:
 * without this, a Windows machine with the (very common) global
 * `core.autocrlf=true` setting checks text payload files out with CRLF
 * line endings, while a Linux CI runner signing/hashing that same content
 * sees LF -- `computePayloadDigest` would then never match a real,
 * untampered artifact's recorded `content_digest` for any such user. This
 * keeps every DeliveryOS-managed cache byte-faithful to what's actually
 * committed, regardless of the host machine's own git config.
 */
export async function cloneTo(url: string, dest: string): Promise<void> {
  const git = simpleGit();
  try {
    await git.clone(url, dest, ['--config', 'core.autocrlf=false']);
  } catch (err) {
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new GitOperationError(message);
  }
}

/** Reads a single git config key's effective value (local, then global,
 * then system, per git's own resolution order), or undefined if unset. */
async function readGitConfig(git: SimpleGit, key: string): Promise<string | undefined> {
  try {
    const value = (await git.raw(['config', '--get', key])).trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export interface GitIdentity {
  name: string;
  email: string;
}

/**
 * Resolves the commit identity to use for a push, preferring whatever git
 * config (local or global) is already ambient in `repoDir`, falling back to
 * a generic DeliveryOS identity if nothing is configured at all (e.g. a
 * freshly cloned cache dir on a machine/CI without git config set up).
 */
export async function getCommitIdentity(repoDir: string): Promise<GitIdentity> {
  const git = simpleGit(repoDir);
  const name = (await readGitConfig(git, 'user.name')) ?? 'DeliveryOS';
  const email = (await readGitConfig(git, 'user.email')) ?? 'deliveryos@local.invalid';
  return { name, email };
}

/**
 * Asks `origin` directly which branch its HEAD points at (`git ls-remote
 * --symref origin HEAD`), rather than trusting anything about the local
 * cache's current checkout. This is deliberately independent of whatever
 * branch happens to be checked out locally -- a previous push may have left
 * the cache's HEAD sitting on a leftover `deliveryos/<id>/...` branch (that
 * branch/commit/push-to-remote already happened even if that earlier push
 * then failed at the GitHub-auth step), and trusting the local checkout
 * would silently branch the *next* push off of that leftover state instead
 * of the remote's real default branch tip.
 */
async function getRemoteDefaultBranch(git: SimpleGit): Promise<string> {
  const output = await git.raw(['ls-remote', '--symref', 'origin', 'HEAD']);
  const match = output.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
  if (!match) {
    throw new Error("Could not determine origin's default branch (no HEAD symref returned)");
  }
  return match[1];
}

/**
 * Refreshes an already-cloned remote cache dir ahead of a push: fetches
 * `origin`, determines the remote's *actual current* default branch (never
 * assumed from local state -- see `getRemoteDefaultBranch`), then
 * force-checks-out and hard-resets that branch to `origin/<branch>`.
 *
 * Using `checkout -B <branch> origin/<branch>` (rather than a plain
 * `checkout <branch>`) is what makes this safe to call regardless of what
 * the local cache's HEAD was left on: it creates the default branch locally
 * if it doesn't exist, or forcibly rewinds it to match origin if it does,
 * discarding any leftover local branch/commit state from a previous push in
 * either case. This guarantees every push starts from a clean, current copy
 * of the remote's real default branch, never on top of a previous push's
 * leftover branch. Bubbles up git's own stderr/message on failure, wrapped
 * in GitOperationError.
 */
export async function fetchAndReset(repoDir: string): Promise<void> {
  const git = simpleGit(repoDir);
  try {
    await git.fetch(['origin']);
    const defaultBranch = await getRemoteDefaultBranch(git);
    await git.checkout(['-B', defaultBranch, `origin/${defaultBranch}`]);
    await git.reset(['--hard', `origin/${defaultBranch}`]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new GitOperationError(message);
  }
}

/** Creates and checks out a new local branch in `repoDir`, off the current
 * HEAD. `repoDir` is expected to already be reset to the base tip via
 * `fetchAndReset` before this is called. */
export async function createBranch(repoDir: string, branchName: string): Promise<void> {
  const git = simpleGit(repoDir);
  try {
    await git.checkoutLocalBranch(branchName);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new GitOperationError(message);
  }
}

/**
 * Stages exactly `paths` (relative to `repoDir`) -- including deletions,
 * which `git add <path>` stages for an already-tracked path that's been
 * removed from the working tree -- and commits them under `identity`. The
 * identity is set as repo-local config immediately before committing, so
 * this works deterministically even in environments with no ambient git
 * identity configured at all.
 */
export async function commitPaths(
  repoDir: string,
  paths: string[],
  message: string,
  identity: GitIdentity,
): Promise<void> {
  const git = simpleGit(repoDir);
  try {
    await git.addConfig('user.name', identity.name, false, 'local');
    await git.addConfig('user.email', identity.email, false, 'local');
    await git.add(paths);
    await git.commit(message);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new GitOperationError(detail);
  }
}

/** Pushes `branchName` to `origin`, setting it as the upstream. */
export async function pushBranch(repoDir: string, branchName: string): Promise<void> {
  const git = simpleGit(repoDir);
  try {
    await git.push('origin', branchName, ['--set-upstream']);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new GitOperationError(message);
  }
}
