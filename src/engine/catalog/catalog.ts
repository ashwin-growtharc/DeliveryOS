import { listRemotes } from '../remote/remoteRegistry';
import { cachePath } from '../remote/remoteCache';
import { discoverManifests } from '../manifest/parser';
import { Manifest } from '../manifest/schema';

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
