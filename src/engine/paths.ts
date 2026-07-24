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
