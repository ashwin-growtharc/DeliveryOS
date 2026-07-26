import { listRemotes } from '../remote/remoteRegistry';
import { cachePath } from '../remote/remoteCache';
import { discoverManifests } from '../manifest/parser';
import { Manifest } from '../manifest/schema';
import { fetchAndReset } from '../git/git';

export interface CatalogEntry {
  manifest: Manifest;
  remoteName: string;
}

/**
 * Aggregates manifests across every registered remote's local cache.
 *
 * Note: if the same artifact id appears in more than one remote, this is
 * NOT an error here -- catalog aggregation is purely additive. Resolving
 * (and rejecting) that ambiguity is the responsibility of `pull`.
 */
export function buildCatalog(): CatalogEntry[] {
  const remotes = listRemotes();
  const entries: CatalogEntry[] = [];

  for (const remote of remotes) {
    const manifests = discoverManifests(cachePath(remote.name));
    for (const manifest of manifests) {
      entries.push({ manifest, remoteName: remote.name });
    }
  }

  return entries;
}

/**
 * Fetches every registered remote's local cache to its current tip, then
 * returns `buildCatalog()`. `buildCatalog()` alone only ever reads whatever
 * is already on disk under `~/.deliveryos/remotes/<name>/` -- nothing in
 * `pull`, `push`, or plain "Refresh" ever updated that cache for a remote
 * with no lockfile entries pointing at it, so an artifact proposed via
 * `push --new` and merged upstream would never show up in Browse until
 * *something else* happened to fetch that same remote (e.g. later pulling a
 * different, already-tracked artifact from it). This is what Browse's
 * "Refresh" button now calls instead of `buildCatalog()` directly, so
 * "Refresh" actually refreshes from the remote, not just from local disk.
 *
 * A single remote's fetch failing (network flake, revoked access, remote
 * since deleted upstream) doesn't abort the rest -- reported to `onProgress`
 * and otherwise skipped, so one bad remote never blocks browsing everything
 * else.
 */
export async function refreshCatalog(
  onProgress?: (stage: string, message: string) => void,
): Promise<CatalogEntry[]> {
  for (const remote of listRemotes()) {
    onProgress?.('fetch', `Fetching latest from ${remote.name}...`);
    try {
      await fetchAndReset(cachePath(remote.name));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      onProgress?.('fetch', `Could not refresh "${remote.name}", skipping: ${detail}`);
    }
  }

  return buildCatalog();
}
