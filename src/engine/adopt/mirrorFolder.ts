import * as fs from 'fs';
import * as path from 'path';
import { copyTree } from '../remote/backends';
import { AdoptionPlanError } from '../errors';
import { sha256Hex } from '../provenance/digest';

/**
 * Copies a client's folder into a catalog repository as one tree, and remembers
 * what it copied so the next mirror can say what changed.
 *
 * WHY A COPY IS FORCED HERE RATHER THAN CHOSEN
 *
 * Adoption's whole idea is to leave a client's files where they are and lay a
 * thin manifest layer over them. That works when the client hands over a git
 * repository. It cannot work for SharePoint, OneDrive or Drive, for two
 * reasons that are both structural:
 *
 *  - `payload_path` is resolved against the remote's own root and containment
 *    checked, so a manifest cannot point at anything outside the repository it
 *    lives in. A manifest in a catalog cannot reference a file in SharePoint.
 *  - SharePoint is not a git remote. Even if it could be referenced, nothing
 *    downstream -- refresh, contribution, the pull-request lifecycle -- works
 *    against it.
 *
 * So for those clients the material has to reach a git repository before
 * DeliveryOS can do anything useful with it, and this is that step.
 *
 * ONE TREE, NOT N COPIES
 *
 * The whole folder is mirrored as a unit, preserving the client's own directory
 * names at the repository root -- exactly how `growtharc-ai-helpers` looks, with
 * `agents/`, `rules/` and `commands/` sitting where the original collection put
 * them. The alternative, copying each file into its own `artifacts/<id>/payload/`,
 * would turn re-syncing into 200 separate copy targets and fork the client's
 * content into 200 places.
 *
 * WHY THE MIRROR KEEPS A RECORD
 *
 * The first version of this was additive: it overwrote what it copied and
 * never removed anything, so a file the client deleted stayed in the catalog
 * forever -- the same class of bug as an update that adds files and never
 * removes them. Deleting is only safe when the mirror knows what it put there
 * in the first place: `.deliveryos-mirror.json` at the catalog root records
 * every mirrored path with its hash. Removal is confined to that list, so a
 * client folder that happens to be named like a catalog file can never delete
 * something the mirror did not create. The hashes are also what lets the next
 * mirror -- and, later, a release back to the client -- say which files
 * actually changed rather than that "something was copied".
 */

export const MIRROR_RECORD = '.deliveryos-mirror.json';

export interface MirrorRecord {
  /** Absolute path of the folder mirrored from, on the machine that mirrored
   * it. Recorded so a later release knows where to write back to; note that
   * it lands in the catalog, which is the client's own repository. */
  source: string;
  sourceLabel: string;
  mirroredAt: string;
  /** Relative path -> sha256 of the bytes as mirrored. */
  files: Record<string, string>;
}

export interface MirrorResult {
  /** Paths written, relative to the destination root, forward-slashed. */
  written: string[];
  /** Files that could not be read. The OneDrive Files-On-Demand case: a
   * placeholder stats fine and then fails to open because the bytes are still
   * in the cloud. Reported rather than fatal, and surfaced in the pull request
   * so a reviewer sees what did not make it. */
  unreadable: string[];
  /** Against the previous mirror's record. On a first mirror everything is
   * `added`. */
  added: string[];
  changed: string[];
  unchanged: string[];
  /** Previously mirrored, absent from the source now, and deleted from the
   * destination by this mirror. */
  removed: string[];
  /** Everything the commit must include: the written files, the record, and
   * the removals (staging a deleted path is how git records a deletion). */
  stagePaths: string[];
  record: MirrorRecord;
}

/** Directories at the destination root that a mirror must never touch, because
 * they are the catalog's own bookkeeping rather than client content. */
const RESERVED = new Set(['.git', 'artifacts']);

export function readMirrorRecord(dest: string): MirrorRecord | undefined {
  const file = path.join(dest, MIRROR_RECORD);
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<MirrorRecord>;
    if (typeof parsed.source !== 'string' || typeof parsed.files !== 'object' || parsed.files === null) {
      return undefined;
    }
    return parsed as MirrorRecord;
  } catch {
    // A corrupt record means "no record": the mirror behaves as a first mirror,
    // which adds everything and removes nothing. The safe direction.
    return undefined;
  }
}

/**
 * Mirrors `source` into `dest`.
 *
 * Refuses rather than merges when a top-level name would collide with the
 * catalog's own `artifacts/` directory: silently blending a client's folder
 * called `artifacts` into the manifest layer would corrupt the catalog in a way
 * that is very hard to see afterwards.
 */
export function mirrorFolder(source: string, dest: string): MirrorResult {
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new AdoptionPlanError(
      `"${source}" is not a folder on this machine. If the material lives in shared storage, `
        + 'open it in the sync client first and use the folder path it creates.',
    );
  }

  for (const entry of fs.readdirSync(resolved)) {
    if (RESERVED.has(entry)) {
      throw new AdoptionPlanError(
        `"${source}" contains a top-level "${entry}" directory, which is a name the catalog uses `
          + 'for its own bookkeeping. Mirror a subfolder instead, or rename it first.',
      );
    }
  }

  const previous = readMirrorRecord(dest);

  // The same copy the folder backend does when it materialises a remote --
  // same debris filter, same treatment of an unreadable placeholder -- so a
  // dry run, a mirror and a folder remote can never disagree about which
  // files exist.
  const { written, unreadable } = copyTree(resolved, dest);

  if (written.length === 0) {
    throw new AdoptionPlanError(
      `Nothing to mirror from "${source}" -- no readable files found.`
        + (unreadable.length > 0
          ? ` ${unreadable.length} file(s) could not be read; if this folder syncs from the cloud, `
            + 'its contents may not be downloaded yet.'
          : ''),
    );
  }

  const files: Record<string, string> = {};
  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const rel of written) {
    const hash = sha256Hex(fs.readFileSync(path.join(dest, rel)));
    files[rel] = hash;
    const before = previous?.files[rel];
    if (before === undefined) added.push(rel);
    else if (before !== hash) changed.push(rel);
    else unchanged.push(rel);
  }

  // An unreadable placeholder is not a deletion: the file exists, its bytes
  // are just not here. Its previous hash is carried forward so the next mirror
  // does not treat a file that finally downloaded as new.
  const unreadableSet = new Set(unreadable);
  for (const rel of unreadable) {
    if (previous?.files[rel] !== undefined) files[rel] = previous.files[rel];
  }

  const removed: string[] = [];
  if (previous) {
    for (const rel of Object.keys(previous.files)) {
      if (files[rel] !== undefined || unreadableSet.has(rel)) continue;
      // Only ever a path this mirror recorded putting there. Never a walk of
      // the destination; never anything under RESERVED.
      const abs = path.join(dest, rel);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) fs.rmSync(abs);
      removed.push(rel);
    }
  }

  const record: MirrorRecord = {
    source: resolved,
    sourceLabel: path.basename(resolved),
    mirroredAt: new Date().toISOString(),
    files,
  };
  fs.writeFileSync(path.join(dest, MIRROR_RECORD), `${JSON.stringify(record, null, 2)}\n`, 'utf-8');

  return {
    written,
    unreadable,
    added: added.sort(),
    changed: changed.sort(),
    unchanged: unchanged.sort(),
    removed: removed.sort(),
    stagePaths: [...written, MIRROR_RECORD, ...removed],
    record,
  };
}
