import * as fs from 'fs';
import * as path from 'path';
import { GitOperationError } from '../../errors';
import { RemoteBackend } from './types';

/**
 * A catalog that lives in an ordinary directory.
 *
 * The point of this is not local folders for their own sake -- it is
 * SharePoint, OneDrive and Google Drive. All three install a sync client that
 * makes their content appear as a normal folder, so one adapter covers all
 * three with no accounts, no API keys and nothing for a client's IT department
 * to approve. A company whose shared material lives in SharePoint cannot use
 * DeliveryOS at all today, and that is a sales objection rather than a feature
 * request.
 *
 * Note what is NOT here: no Microsoft Graph, no Drive SDK, no OAuth. Reading a
 * folder the operating system already put on disk is the cheapest thing that
 * works, and every cloud integration was researched and deliberately deferred
 * (see `docs/client-shaped-deliveryos.html`).
 */

/**
 * Files a sync client leaves behind that are not content.
 *
 * This matters more than it looks. Without it they are read as part of an
 * artifact's payload AND, once installed, as local edits -- so a stray
 * `desktop.ini` would show up as an uncommitted change the user never made.
 * `listFilesRecursive` skips only `.git`, which is the right list for a git
 * clone and the wrong one for a synced folder.
 */
const IGNORED_EXACT = new Set(['desktop.ini', '.ds_store', 'thumbs.db', '.dropbox', 'icon\r']);
const IGNORED_PREFIXES = ['~$', '.~lock.'];
const IGNORED_SUFFIXES = ['.tmp', '.crdownload', '.partial'];

/** Kept out of the cache entirely: pointing at a folder that happens to be a
 * git repository should produce a plain directory of files, not a second clone
 * whose `.git` would then look like a remote we could fetch from. */
const NEVER_COPIED = new Set(['.git']);

export function isSyncDetritus(name: string): boolean {
  const lower = name.toLowerCase();
  if (IGNORED_EXACT.has(lower)) return true;
  if (IGNORED_PREFIXES.some((p) => lower.startsWith(p))) return true;
  return IGNORED_SUFFIXES.some((s) => lower.endsWith(s));
}

/**
 * Where a folder-backed cache records what it was copied from and when.
 *
 * The git backend gets both for free -- the clone knows its own origin, and
 * `FETCH_HEAD`'s mtime is the fetch time. A copied directory knows neither, so
 * this file is the folder equivalent, and it lives at the cache root where
 * nothing looks for content: `discoverManifests` reads only `artifacts/`.
 *
 * Recording the source here rather than adding a field to `RemoteEntry` follows
 * the precedent `lastFetchedAt` already set, and for the same reason -- it keeps
 * a registry schema migration out of a change that does not need one.
 */
const STAMP = '.deliveryos-source.json';

interface Stamp {
  source: string;
  fetchedAt: string;
}

function readStamp(dest: string): Stamp | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dest, STAMP), 'utf-8')) as Stamp;
    return typeof parsed.source === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Copies `from` into `to`, skipping detritus.
 *
 * A file that cannot be read is SKIPPED rather than fatal, and that is the
 * OneDrive Files-On-Demand case: a placeholder stats perfectly well and then
 * fails to open, because the real bytes are still in the cloud. Aborting the
 * whole copy for one unavailable file would make a 200-artifact catalog
 * unusable because somebody had not opened one document recently.
 *
 * The consequence surfaces where it should: a missing manifest is reported
 * through `discoverManifests`'s existing `skipped` channel, and a missing
 * payload file fails at pull time, naming the file.
 */
function copyTree(from: string, to: string): { copied: number; unreadable: string[] } {
  const unreadable: string[] = [];
  let copied = 0;

  function walk(src: string, dst: string): void {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (NEVER_COPIED.has(entry.name) || isSyncDetritus(entry.name)) continue;
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        walk(s, d);
      } else if (entry.isFile()) {
        try {
          fs.copyFileSync(s, d);
          copied += 1;
        } catch {
          unreadable.push(path.relative(from, s).split(path.sep).join('/'));
        }
      }
      // Symlinks and anything else are ignored on purpose. A synced folder has
      // no business containing one, and following it could copy from outside
      // the source tree entirely.
    }
  }

  walk(from, to);
  return { copied, unreadable };
}

function writeStamp(dest: string, source: string): void {
  const stamp: Stamp = { source, fetchedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dest, STAMP), `${JSON.stringify(stamp, null, 2)}\n`, 'utf-8');
}

export const folderBackend: RemoteBackend = {
  kind: 'folder',

  capabilities: {
    // A folder cannot hold a proposal that somebody reviews while the original
    // stays untouched. `push` asserts this and refuses by name rather than
    // failing three layers deeper in `parseGithubUrl`.
    opensPullRequests: false,
    // SharePoint and OneDrive DO keep real version history, and writing through
    // the sync client produces it -- but that lives in the cloud, and nothing
    // here can read it from a plain directory. Declaring `false` describes what
    // this backend can offer, not what the storage underneath happens to do.
    hasVersionHistory: false,
    // Nothing stops a sync daemon rewriting files mid-read. `withRemoteCacheLock`
    // only coordinates DeliveryOS's own processes.
    supportsAtomicWrite: false,
  },

  async materialize(source, dest) {
    const resolved = path.resolve(source);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new GitOperationError(
        `"${source}" is not a folder on this machine. If it is a link to shared storage, `
          + 'open it in your sync client first and use the folder path it creates.',
      );
    }

    const { unreadable } = copyTree(resolved, dest);
    writeStamp(dest, resolved);

    // Only the wholly-unusable case is fatal. Some files being unavailable is a
    // normal, recoverable state for a synced folder.
    if (unreadable.length > 0 && !fs.existsSync(path.join(dest, 'artifacts'))) {
      throw new GitOperationError(
        `Copied nothing usable from "${source}" -- ${unreadable.length} file(s) could not be read. `
          + 'If this folder syncs from the cloud, its contents may not be downloaded yet.',
      );
    }
  },

  async refresh(dest) {
    const stamp = readStamp(dest);
    if (!stamp) {
      throw new GitOperationError(
        `Cannot refresh "${dest}": no record of where it was copied from. Remove the remote and add it again.`,
      );
    }
    if (!fs.existsSync(stamp.source)) {
      throw new GitOperationError(
        `The folder this was copied from is no longer there: "${stamp.source}". `
          + 'If it lives in shared storage, check the sync client is still running.',
      );
    }

    // Replace rather than merge. A merge would leave files that were deleted
    // upstream sitting in the cache forever, and the catalog would keep
    // reporting artifacts the source no longer has -- the same class of bug as
    // an update that adds files but never removes them.
    fs.rmSync(dest, { recursive: true, force: true });
    copyTree(stamp.source, dest);
    writeStamp(dest, stamp.source);
  },

  lastChangedAt(dest) {
    const stamp = readStamp(dest);
    if (!stamp) return undefined;
    const when = new Date(stamp.fetchedAt);
    return Number.isNaN(when.getTime()) ? undefined : when;
  },
};
