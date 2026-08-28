import { listRemotes } from '../remote/remoteRegistry';
import { cachePath, refreshRemoteCache } from '../remote/remoteCache';
import { discoverManifests, SkippedManifest } from '../manifest/parser';
import { Manifest } from '../manifest/schema';
import { readLockfile } from '../lockfile/lockfile';
import { computeChangedFiles } from '../push/diff';
import { pristinePath, resolveContainedPath, isRootInstall, readPayloadFootprint } from '../paths';

export interface CatalogEntry {
  manifest: Manifest;
  remoteName: string;
}

export type LocalStatus = 'not_pulled' | 'pulled' | 'edited_locally';

export interface CatalogListEntry {
  manifest: Manifest;
  remoteName: string;
  localStatus: LocalStatus;
  installTarget: string;
  /** Set when a previous push opened a PR for this artifact that hasn't
   * been resolved yet (see `sync.ts`'s `resolvePendingPushes`) -- lets a
   * caller show real transparency about a push's outcome without a
   * separate network call just to display it, since this is already-known
   * local lockfile data. */
  pendingPr?: { number: number; url: string };
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
    const { manifests, skipped } = discoverManifests(cachePath(remote.name));
    for (const manifest of manifests) {
      entries.push({ manifest, remoteName: remote.name });
    }
    // Reported, never fatal. A single unloadable manifest used to throw and
    // take the whole catalog with it -- 227 artifacts made unreachable by one
    // bad file. Surfaced here so a broken artifact is still visible as a
    // problem rather than silently vanishing, without stopping anyone else
    // from browsing.
    for (const entry of skipped) {
      lastSkippedManifests.push({ ...entry, remoteName: remote.name });
    }
  }

  return entries;
}

/** Manifests skipped by the most recent `buildCatalog()` call, if any.
 *
 * Deliberately a module-level record rather than a return value: `buildCatalog`
 * has many callers and returning a tuple from all of them would be a wide,
 * mechanical change for a signal that is purely advisory. Callers that want to
 * warn read this immediately after calling. */
const lastSkippedManifests: Array<SkippedManifest & { remoteName: string }> = [];

/** Returns (and clears) the manifests skipped by the last `buildCatalog()`. */
export function takeSkippedManifests(): Array<SkippedManifest & { remoteName: string }> {
  return lastSkippedManifests.splice(0, lastSkippedManifests.length);
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
      await refreshRemoteCache(remote.name);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      onProgress?.('fetch', `Could not refresh "${remote.name}", skipping: ${detail}`);
    }
  }

  return buildCatalog();
}

/**
 * Computes each catalog entry's status relative to the cwd-scoped
 * lockfile/pristine snapshot:
 *  - no lockfile entry -> 'not_pulled'
 *  - lockfile entry, no diff against the pristine snapshot -> 'pulled'
 *  - lockfile entry, diff detected -> 'edited_locally'
 *  - lockfile entry, but the diff can't be computed (e.g. a missing
 *    pristine snapshot, `PristineSnapshotMissingError`) -> falls back to
 *    'pulled' rather than throwing, so one bad entry never breaks a whole
 *    listing for every other artifact in the same call.
 *
 * Originally lived only in `src/sidecar.ts` (as a private function backing
 * `catalog.list`/`catalog.refresh`), so `deliveryos list` (the CLI) never
 * had this -- a real CLI/sidecar parity gap: the app's own Browse view
 * showed pulled/edited/not-pulled state over the exact same catalog data
 * the CLI's `list` command was already reading, just without ever
 * computing it. Extracted here so both share the one implementation.
 */
export function annotateCatalog(
  entries: CatalogEntry[],
  cwd: string,
  remote: string | undefined,
): CatalogListEntry[] {
  const filtered = remote ? entries.filter((entry) => entry.remoteName === remote) : entries;
  const lockfile = readLockfile(cwd);

  return filtered.map((entry) => {
    const { manifest, remoteName } = entry;
    // manifest.install_target is untrusted (the artifact author's own
    // manifest) -- same containment check pull.ts already applies before
    // ever writing there. This function only ever READS via
    // computeChangedFiles below, but its `installTarget` is also handed
    // back to callers (the app's "Open folder"/Detail "installs to"
    // display) -- a crafted value shouldn't silently resolve to something
    // outside the project just because this ran across every remote's
    // catalog, not just artifacts the user chose to pull. One bad manifest
    // degrades to `not_pulled` for that entry alone; it never breaks
    // listing the rest of the catalog.
    // allowRoot stays TRUE: a root install_target is a legitimate scaffold
    // shape that pullArtifact installs correctly, and rejecting it here was
    // what made such an artifact read `not_pulled` forever no matter how many
    // times it was successfully pulled. Nothing on this path deletes anything;
    // the diff below is narrowed instead. See isRootInstall.
    const installTarget = resolveContainedPath(cwd, manifest.install_target);
    const lockEntry = lockfile.entries.find((e) => e.id === manifest.id);

    let localStatus: LocalStatus;
    if (!installTarget) {
      localStatus = 'not_pulled';
    } else if (!lockEntry) {
      localStatus = 'not_pulled';
    } else {
      const pristine = pristinePath(cwd, manifest.id);
      // At the project root `installTarget` is the user's whole project, so the
      // diff has to be narrowed to the entries this artifact actually owns --
      // otherwise every unrelated file reads as a local edit and the artifact
      // is permanently `edited_locally`.
      const rootInstall = isRootInstall(cwd, installTarget);
      const topLevelScope = rootInstall ? readPayloadFootprint(pristine) : undefined;
      if (rootInstall && !topLevelScope) {
        // Snapshot gone (a stale pull), so the footprint is unknowable. An
        // unscoped walk of the project root is exactly what must not happen
        // here -- degrade to `pulled`, the same way the catch below already
        // does for a missing snapshot on the normal path.
        localStatus = 'pulled';
      } else {
        try {
          const changedFiles = computeChangedFiles(installTarget, pristine, { topLevelScope });
          localStatus = changedFiles.length === 0 ? 'pulled' : 'edited_locally';
        } catch {
          localStatus = 'pulled';
        }
      }
    }

    return {
      manifest,
      remoteName,
      localStatus,
      installTarget: installTarget ?? manifest.install_target,
      pendingPr: lockEntry?.pendingPr,
    };
  });
}
