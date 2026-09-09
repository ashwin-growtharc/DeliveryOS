import * as fs from 'fs';
import * as path from 'path';
import { isSyncDetritus } from '../remote/backends';
import { AdoptionPlanError } from '../errors';

/**
 * Copies a client's folder into a catalog repository, once, as one tree.
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
 * content into 200 places. This way a later re-mirror is one boring operation.
 */

export interface MirrorResult {
  /** Paths written, relative to the destination root, forward-slashed. Handed
   * straight to `commitPaths`, which takes a list. */
  written: string[];
  /** Files that could not be read. The OneDrive Files-On-Demand case: a
   * placeholder stats fine and then fails to open because the bytes are still
   * in the cloud. Reported rather than fatal, and surfaced in the pull request
   * so a reviewer sees what did not make it. */
  unreadable: string[];
}

/** Directories at the destination root that a mirror must never touch, because
 * they are the catalog's own bookkeeping rather than client content. */
const RESERVED = new Set(['.git', 'artifacts']);

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

  const written: string[] = [];
  const unreadable: string[] = [];

  const walk = (from: string, to: string): void => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      // Same filter the folder backend applies, and for the same reason: sync
      // clutter read as artifact content is clutter committed to a client's
      // catalog forever.
      if (entry.name === '.git' || isSyncDetritus(entry.name)) continue;

      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) {
        walk(src, dst);
      } else if (entry.isFile()) {
        try {
          fs.copyFileSync(src, dst);
          written.push(path.relative(dest, dst).split(path.sep).join('/'));
        } catch {
          unreadable.push(path.relative(resolved, src).split(path.sep).join('/'));
        }
      }
      // Symlinks skipped deliberately: following one could copy from outside
      // the folder the client actually shared.
    }
  };

  walk(resolved, dest);

  if (written.length === 0) {
    throw new AdoptionPlanError(
      `Nothing to mirror from "${source}" -- no readable files found.`
        + (unreadable.length > 0
          ? ` ${unreadable.length} file(s) could not be read; if this folder syncs from the cloud, `
            + 'its contents may not be downloaded yet.'
          : ''),
    );
  }

  return { written, unreadable };
}
