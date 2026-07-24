import { remoteCachePath } from '../paths';
import { cloneTo } from '../git/git';

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
