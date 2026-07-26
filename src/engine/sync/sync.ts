import { readLockfile } from '../lockfile/lockfile';
import { findRemote } from '../remote/remoteRegistry';
import { cachePath } from '../remote/remoteCache';
import { fetchAndReset } from '../git/git';
import { buildCatalog } from '../catalog/catalog';
import { ProgressCallback } from '../pull/pull';

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
