import * as fs from 'fs';
import * as path from 'path';
import properLockfile from 'proper-lockfile';
import { remoteCachePath, remotesCacheRoot } from '../paths';
import { cloneTo, fetchAndReset } from '../git/git';

/** Filesystem path of the local clone cache for a named remote. */
export function cachePath(name: string): string {
  return remoteCachePath(name);
}

/** Clones `url` into the cache directory for `name`. */
export async function cloneRemote(name: string, url: string): Promise<string> {
  const dest = cachePath(name);
  await cloneTo(url, dest);
  return dest;
}

/**
 * Runs `fn` holding an exclusive inter-process lock on a named remote's
 * cache clone.
 *
 * The cache at `~/.deliveryos/remotes/<name>` is a shared, MUTABLE git
 * working tree serving two incompatible roles at once: it is the catalog's
 * read-model, and it is `push`'s staging area. Five operations write to it
 * -- `push`, `refreshCatalog`, `checkForUpdates`, `applyAvailableUpdates`
 * and `resolvePendingPushes` -- four of them via `fetchAndReset`, which is
 * `checkout -B` plus `reset --hard`. It had no lock at all, while the
 * lockfile and the remote registry (both far smaller shared resources) each
 * had one.
 *
 * The concrete failure: the desktop app fires a background auto-sync tick
 * every 20 minutes. One landing between push's staging step and its commit
 * ran `git reset --hard` and silently discarded the staged edit, so the PR
 * carried only a version bump -- a lost update, not a crash, so nothing
 * surfaced it.
 *
 * Locks a sibling `<name>.lock` marker file rather than the cache directory
 * itself: the directory is created and destroyed by clone/remove, and
 * `proper-lockfile` needs a stable target that outlives those. `realpath:
 * false` for the same reason `lockfile.ts` uses it -- the target need not
 * already exist. Retries are generous because the holder may legitimately be
 * running a network fetch or a full push.
 */
export async function withRemoteCacheLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const root = remotesCacheRoot();
  fs.mkdirSync(root, { recursive: true });
  const lockTarget = path.join(root, `${name}.lock`);
  if (!fs.existsSync(lockTarget)) {
    fs.writeFileSync(lockTarget, '', 'utf-8');
  }

  const release = await properLockfile.lock(lockTarget, {
    realpath: false,
    // A push does real network I/O while holding this, so a waiter has to be
    // willing to sit for a while rather than failing fast.
    retries: { retries: 60, minTimeout: 100, maxTimeout: 2000 },
    // Without this, a process killed mid-push would leave the lock held
    // forever. proper-lockfile refreshes the mtime while alive, so a stale
    // lock is one whose holder genuinely died.
    stale: 5 * 60 * 1000,
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * Fetches a named remote's cache clone back to the remote's current tip,
 * holding the cache lock for the duration.
 *
 * Every caller that wants a fresh cache should use this rather than calling
 * `fetchAndReset(cachePath(name))` directly -- taking the lock is not
 * optional, and a helper that takes it internally is one that no future call
 * site can forget. `fetchAndReset` is `checkout -B` plus `reset --hard`, so
 * an unlocked one landing inside a concurrent `push` destroyed that push's
 * staged edit.
 */
export async function refreshRemoteCache(name: string): Promise<void> {
  await withRemoteCacheLock(name, () => fetchAndReset(cachePath(name)));
}
