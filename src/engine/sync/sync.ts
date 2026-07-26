import * as fs from 'fs';
import * as path from 'path';
import { readLockfile, upsertEntry } from '../lockfile/lockfile';
import { findRemote } from '../remote/remoteRegistry';
import { cachePath } from '../remote/remoteCache';
import { fetchAndReset } from '../git/git';
import { buildCatalog } from '../catalog/catalog';
import { ProgressCallback } from '../pull/pull';
import { pristinePath } from '../paths';
import { parseGithubUrl, getPullRequestStatus, createOctokit, GithubClient } from '../github/github';
import { getGithubToken } from '../github/githubAuth';

/** One artifact whose registered remote currently has a newer version than
 * what's recorded in the cwd-scoped lockfile. */
export interface UpdateInfo {
  id: string;
  remote: string;
  installedVersion: string;
  availableVersion: string;
}

/**
 * Compares two `x.y.z` version strings as numeric tuples, returning -1, 0,
 * or 1 (same convention as `Array.prototype.sort`'s comparator). Manifests
 * already validate `version` matches `/^\d+\.\d+\.\d+$/` at parse time (see
 * `src/engine/manifest/schema.ts`), so this simple numeric-tuple compare is
 * correct and sufficient -- no semver range/prerelease handling needed.
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const length = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < length; i += 1) {
    const x = partsA[i] ?? 0;
    const y = partsB[i] ?? 0;
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }

  return 0;
}

/**
 * Checks every remote referenced by the cwd-scoped lockfile for newer
 * versions of the artifacts pulled from it.
 *
 * Only refreshes remotes actually referenced by a lockfile entry (not every
 * registered remote) -- an artifact-drift check has no reason to pay for a
 * fetch against a remote nothing was ever pulled from. A remote that was
 * since removed from the registry (`findRemote` returns undefined) is
 * skipped silently rather than failing the whole check -- the corresponding
 * lockfile entries simply can't be checked for drift anymore.
 *
 * After refreshing every needed remote's local cache, `buildCatalog()` is
 * called exactly once so it reads the freshly-reset caches, then each
 * lockfile entry is matched against the catalog by both `id` and `remote`.
 * An entry whose artifact has disappeared upstream (removed from the
 * remote entirely) is likewise skipped -- reconciling that is out of scope
 * for drift detection.
 */
export async function checkForUpdates(
  cwd: string,
  onProgress?: ProgressCallback,
): Promise<UpdateInfo[]> {
  const lockfile = readLockfile(cwd);
  const remoteNames = Array.from(new Set(lockfile.entries.map((entry) => entry.remote)));

  for (const name of remoteNames) {
    const remote = findRemote(name);
    if (!remote) {
      continue;
    }
    onProgress?.('fetch', `Fetching latest from ${name}...`);
    await fetchAndReset(cachePath(name));
  }

  const catalog = buildCatalog();
  const updates: UpdateInfo[] = [];

  for (const entry of lockfile.entries) {
    const match = catalog.find(
      (candidate) => candidate.manifest.id === entry.id && candidate.remoteName === entry.remote,
    );
    if (!match) {
      continue;
    }
    if (compareVersions(match.manifest.version, entry.version) > 0) {
      updates.push({
        id: entry.id,
        remote: entry.remote,
        installedVersion: entry.version,
        availableVersion: match.manifest.version,
      });
    }
  }

  return updates;
}

/** One artifact this project previously pushed a PR for, and what that PR's
 * real current state turned out to be when checked. */
export interface PendingPushStatus {
  id: string;
  remote: string;
  prNumber: number;
  prUrl: string;
  state: 'open' | 'closed';
  merged: boolean;
}

/**
 * Checks every lockfile entry with a `pendingPr` (set by `pushArtifact`
 * right after opening an edit-mode PR) against GitHub's real, current state
 * for that PR -- opening a PR never changes local state on its own (the
 * edit isn't accepted just because a PR exists for it), so without this
 * there's no way to ever learn whether a push was merged, rejected, or is
 * still sitting open.
 *
 * - Still open: left entirely alone, just reported.
 * - Merged: the pushed edit is now what's upstream, by definition (a merged
 *   PR's file content matches what was pushed, regardless of merge
 *   strategy) -- resyncs the pristine snapshot from the CURRENT live
 *   install_target (not a fresh network copy; the live copy already IS the
 *   now-accepted content) so `edited_locally` correctly resolves back to
 *   `pulled`, updates the recorded version to whatever the remote's
 *   manifest now says (in case the merge also bumped it), and clears
 *   `pendingPr`. Deliberately does NOT re-run `post_install` -- this is a
 *   status resync, not a fresh pull, and re-running a project's setup
 *   command just to update bookkeeping would be unwanted, wasteful side
 *   effect for what should be a fast, quiet check.
 * - Closed without merging (rejected): clears `pendingPr` (nothing left to
 *   track) but deliberately leaves the local edit and its `edited_locally`
 *   status untouched -- the change was NOT accepted, so that divergence is
 *   still real and meaningful, not something to silently paper over.
 *
 * `octokit`, if supplied, is used as-is instead of building a real client --
 * the same test seam `pushArtifact` already uses.
 */
export async function resolvePendingPushes(
  cwd: string,
  onProgress?: ProgressCallback,
  octokit?: GithubClient,
): Promise<PendingPushStatus[]> {
  const lockfile = readLockfile(cwd);
  const pending = lockfile.entries.filter((entry) => entry.pendingPr);
  const results: PendingPushStatus[] = [];

  for (const entry of pending) {
    const remote = findRemote(entry.remote);
    if (!remote || !entry.pendingPr) {
      continue;
    }

    onProgress?.('pr-status', `Checking PR #${entry.pendingPr.number} for "${entry.id}"...`);
    const { owner, repo } = parseGithubUrl(remote.url);
    const client = octokit ?? (await createOctokit(getGithubToken()));
    const status = await getPullRequestStatus(client, owner, repo, entry.pendingPr.number);

    results.push({
      id: entry.id,
      remote: entry.remote,
      prNumber: status.number,
      prUrl: status.url,
      state: status.state,
      merged: status.merged,
    });

    if (status.merged) {
      onProgress?.('resync', `"${entry.id}" was merged -- resyncing local status...`);
      await fetchAndReset(cachePath(entry.remote));
      const catalog = buildCatalog();
      const match = catalog.find(
        (candidate) => candidate.manifest.id === entry.id && candidate.remoteName === entry.remote,
      );
      if (match) {
        const installTarget = path.resolve(cwd, match.manifest.install_target);
        const pristineTarget = pristinePath(cwd, entry.id);
        if (fs.existsSync(pristineTarget)) {
          fs.rmSync(pristineTarget, { recursive: true, force: true });
        }
        fs.cpSync(installTarget, pristineTarget, { recursive: true });
        upsertEntry(cwd, {
          id: entry.id,
          version: match.manifest.version,
          remote: entry.remote,
        });
      }
    } else if (status.state === 'closed') {
      upsertEntry(cwd, { ...entry, pendingPr: undefined });
    }
  }

  return results;
}
