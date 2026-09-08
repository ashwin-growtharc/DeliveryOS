import * as fs from 'fs';
import {
  addRemoteEntry,
  findRemote,
  removeRemoteEntry,
  deriveNameFromUrl,
  RemoteEntry,
} from './remoteRegistry';
import { cloneRemote, cachePath } from './remoteCache';
import { classifyRemoteUrl } from './classifyRemoteUrl';
import { detectBackendKind } from './backends';
import { RemoteBackendKind } from './backends/types';
import { RemoteRegistryError } from '../errors';

/**
 * Registering and unregistering a remote, in the engine.
 *
 * This orchestration existed twice, in two adapters, and both admitted it: the
 * sidecar's copy carried the comment *"mirrors `runRemoteAdd`'s order exactly
 * (src/cli/commands/remoteAdd.ts)"*. The order is not incidental -- checking
 * for an existing registration BEFORE cloning is what stops a duplicate name
 * leaving a stray clone behind and corrupting the existing entry -- so having
 * it written twice meant one copy could drift from the other silently.
 *
 * Hoisted here because a third caller now needs it: the MCP configuration
 * port. That is the moment a duplicated decision becomes a real liability
 * rather than a tidiness complaint.
 */

export interface AddedRemote {
  name: string;
  url: string;
  /** Where the clone landed, so a caller can tell the user. */
  dest: string;
  /** Which backend was chosen. Reported so the CLI can say "(folder)" rather
   * than leaving someone to discover at push time that this is not a git
   * remote. */
  backend: RemoteBackendKind;
}

/**
 * Registers `url` as a remote and clones it.
 *
 * `name` is derived from the URL when omitted, the same way both adapters
 * already did it. Throws `RemoteRegistryError` for a name already in use --
 * checked first, so nothing is cloned before the refusal.
 */
export async function addRemote(url: string, name?: string): Promise<AddedRemote> {
  // Before anything else, and before a name is even derived: refuse URLs that
  // cannot be git remotes, with a sentence that says what to do instead.
  //
  // Previously the first thing to inspect a URL was `git clone`, so pasting a
  // SharePoint link produced git's own stderr -- accurate, and no help at all.
  // Deriving the name first was also actively harmful for those URLs: a
  // SharePoint browser link derives a "name" like
  // `AllItems.aspx?id=%2Fsites%2FHR`, which passes the path-segment guard and
  // then fails much deeper in git or the filesystem.
  const verdict = classifyRemoteUrl(url);
  if (!verdict.supported) {
    throw new RemoteRegistryError(verdict.reason);
  }

  const resolvedName = name ?? deriveNameFromUrl(url);

  // Fail fast, before cloning. A duplicate name discovered after the clone
  // leaves a stray directory and risks overwriting a working registration.
  if (findRemote(resolvedName)) {
    throw new RemoteRegistryError(`A remote named "${resolvedName}" is already registered`);
  }

  // Decided once, here, and recorded -- rather than re-derived on every read.
  // A remote must be read back with the backend it was added with: re-detecting
  // would silently change behaviour if a folder later gained a `.git`, or if a
  // sync client was uninstalled and the folder disappeared.
  const backend = detectBackendKind(url);

  const dest = await cloneRemote(resolvedName, url, backend);
  await addRemoteEntry({
    name: resolvedName,
    url,
    addedAt: new Date().toISOString(),
    // Omitted for git so that a registry written by this build stays readable,
    // and diffable, against every one written before it. Absent already means
    // git everywhere that reads this.
    ...(backend === 'git' ? {} : { backend }),
  });

  return { name: resolvedName, url, dest, backend };
}

export interface RemovedRemote {
  name: string;
  /** False when the cache directory was already gone -- deleted by hand, or
   * never successfully cloned. Not an error: there is simply nothing left to
   * clean up. */
  cacheDeleted: boolean;
}

/**
 * Unregisters a remote and deletes its local cache clone.
 *
 * Deliberately does not touch any project's lockfile or pulled files: those
 * are per-project and stay on disk exactly as pulled. Only the ability to
 * pull/push against this remote again goes away, until it is re-added.
 *
 * Throws `RemoteRegistryError` when the name is not registered.
 */
export async function removeRemote(name: string): Promise<RemovedRemote> {
  await removeRemoteEntry(name);

  const dest = cachePath(name);
  const existed = fs.existsSync(dest);
  if (existed) {
    fs.rmSync(dest, { recursive: true, force: true });
  }

  return { name, cacheDeleted: existed };
}

export type { RemoteEntry };
