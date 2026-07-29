import * as os from 'os';
import * as path from 'path';

/**
 * Single source of truth for every ~/.deliveryos/* and ./.deliveryos/* path
 * used anywhere in DeliveryOS. Nothing else in the codebase should
 * string-concat these paths directly.
 *
 * The global home directory can be overridden via the DELIVERYOS_HOME
 * environment variable. This exists specifically so tests (and any future
 * tooling) never touch the real developer machine's ~/.deliveryos.
 */

/** Root of the global DeliveryOS state directory (registry + remote caches). */
export function deliveryOsHome(): string {
  const override = process.env.DELIVERYOS_HOME;
  if (override && override.length > 0) {
    return override;
  }
  return path.join(os.homedir(), '.deliveryos');
}

/** Path to the global remote registry file. */
export function remotesRegistryPath(): string {
  return path.join(deliveryOsHome(), 'remotes.json');
}

/** Root directory under which all remote caches are cloned. */
export function remotesCacheRoot(): string {
  return path.join(deliveryOsHome(), 'remotes');
}

/** Path to the local clone cache for a specific named remote. */
export function remoteCachePath(name: string): string {
  return path.join(remotesCacheRoot(), name);
}

/** Project-local (cwd-scoped) DeliveryOS directory. */
export function projectDeliveryOsDir(cwd: string): string {
  return path.join(cwd, '.deliveryos');
}

/** Project-local (cwd-scoped) lockfile path. */
export function lockfilePath(cwd: string): string {
  return path.join(projectDeliveryOsDir(cwd), 'lock.json');
}

/** Project-local (cwd-scoped) directory holding pristine (as-pulled)
 * snapshots of every pulled artifact's payload, keyed by id. Used by
 * `push` to diff a local edit against what was actually pulled. */
export function pristineDir(cwd: string): string {
  return path.join(projectDeliveryOsDir(cwd), 'pristine');
}

/** Path to the pristine snapshot for a specific pulled artifact id. */
export function pristinePath(cwd: string, id: string): string {
  return path.join(pristineDir(cwd), id);
}

/** Root directory for cached compiled UI-component previews (Phase 6).
 * Deliberately global (under `deliveryOsHome()`, alongside
 * `remotesCacheRoot()`), NOT cwd-scoped like `pristineDir` -- a compiled
 * preview needs to be viewable for a catalog entry that hasn't been
 * pulled into any project yet (the whole point of browsing live previews
 * before deciding to pull), and a compiled preview for the same
 * (remote, id, version) is identical regardless of which project folder
 * happens to be open, so caching it per-project would just recompile the
 * same output pointlessly for every different project. */
export function previewCacheRoot(): string {
  return path.join(deliveryOsHome(), 'preview-cache');
}

/** Rejects any path segment that could escape `previewCacheRoot()` via
 * `path.join` -- e.g. a manifest `id` of `../../../etc` or a remote name
 * containing a path separator. `remoteName`/`id`/`version` all ultimately
 * originate from data DeliveryOS doesn't fully control (a pushed
 * manifest, a remote's own name) rather than a fixed internal enum, so
 * this is a real boundary, not defense-in-depth for its own sake. */
function assertSafePathSegment(segment: string, label: string): void {
  if (segment.length === 0 || segment.includes('/') || segment.includes('\\') || segment === '.' || segment === '..') {
    throw new Error(`Invalid ${label}: "${segment}"`);
  }
}

/** Path to a specific compiled preview's cached HTML file, keyed by
 * (remote, id, version) so a version bump naturally invalidates the
 * cache (a stale entry is simply never looked up again, not explicitly
 * deleted) -- never pushed or pulled, purely a local derived artifact. */
export function previewCachePath(remoteName: string, id: string, version: string): string {
  assertSafePathSegment(remoteName, 'remote name');
  assertSafePathSegment(id, 'artifact id');
  assertSafePathSegment(version, 'version');
  return path.join(previewCacheRoot(), remoteName, id, version, 'index.html');
}
