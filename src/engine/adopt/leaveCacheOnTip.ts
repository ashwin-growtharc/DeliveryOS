import { fetchAndReset, cleanUntracked } from '../git/git';
import { ProgressCallback } from '../pull/pull';

/**
 * Puts a remote's cache back on the remote's real tip after an adoption,
 * whether or not the adoption succeeded.
 *
 * WHY THIS IS A `finally` AND NOT A LAST STEP
 *
 * The cache is the catalog's read-model as well as the adoption's staging
 * area. Both adoption paths used to reset it only on the success path, so a
 * failed `pushBranch` or `openPullRequest` left the cache checked out on
 * `deliveryos/adopt/<stamp>` with the unmerged mirror committed -- and every
 * later `list`, `pull` or preview read that branch as the remote's real state.
 * `pushArtifact` had, and fixed, exactly this defect; its `finally` documents
 * the consequences.
 *
 * WHY CLEAN AS WELL AS RESET
 *
 * `reset --hard` restores tracked files and does nothing about untracked ones.
 * The mirrored client tree and the manifests are untracked until `commitPaths`
 * runs, so a refusal from `planAdoption` -- an id collision, say -- left them
 * sitting in the cache. Manifests under `artifacts/` are read by
 * `discoverManifests` regardless of git state, so half an adoption that never
 * committed was still visible to the catalog.
 *
 * Best-effort, and not silent: a reset that fails is reported through
 * `onProgress`, which is the only channel that exists when the adoption itself
 * threw. Same posture as `pushArtifact`.
 */
export async function leaveCacheOnTip(
  cacheDir: string,
  remoteName: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  try {
    await fetchAndReset(cacheDir);
    await cleanUntracked(cacheDir);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    onProgress?.(
      'fetch',
      `This machine's local cache of remote "${remoteName}" could not be reset to its tip after the `
        + `adoption (${detail}). Until something fetches that remote again, a list, pull or preview from `
        + 'it may read this adoption\'s unmerged branch as if it were the remote\'s real state. Run '
        + '"deliveryos list" against it before pulling.',
    );
  }
}
