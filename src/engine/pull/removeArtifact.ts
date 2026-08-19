import * as fs from 'fs';
import * as path from 'path';
import { readLockfile, removeEntry } from '../lockfile/lockfile';
import { resolveArtifact } from './pull';
import { resolveContainedTargetFile, resolveWiringActions } from './wiring';
import { readExistingEnvValues } from './installParams';
import { pristinePath } from '../paths';
import { ArtifactNotPulledError } from '../errors';

/** What `removeArtifact` actually did against a real project -- every field
 * reports something that genuinely happened (or genuinely didn't), never a
 * best-effort guess. */
export interface RemoveResult {
  removedInstallTarget: boolean;
  removedWiredFiles: string[];
  /** Anything the artifact's wiring touched that was NOT in wiredFiles --
   * i.e. a file that already existed before the pull, or one that went
   * through the AI wiring-merge flow. Never auto-deleted; just listed so
   * the person knows to look at it. */
  filesNeedingManualReview: string[];
  /** This artifact's own install_params keys still sitting in .env.local,
   * if any -- deliberately left alone (a value the person may still want,
   * or one shared with something else), just named so they know it's
   * still there. */
  envParamsStillSet: string[];
  removedPristineSnapshot: boolean;
}

/**
 * Backs out a previously-pulled artifact (Phase 13's uninstall): deletes its
 * install_target and every file `applyDeterministicWiring` created fresh for
 * it (`entry.wiredFiles`), deletes its pristine snapshot, and drops its
 * lockfile entry -- in that order, lockfile last, so a crash mid-removal
 * leaves the lockfile entry as a real record of what still needs cleaning up
 * rather than silently forgetting the artifact was ever tracked.
 *
 * Deliberately does NOT touch `.env.local` (`envParamsStillSet` is purely
 * informational) and does NOT delete anything a wiring_action merely
 * detected as already-existing or that went through the AI wiring-merge
 * flow (`filesNeedingManualReview`) -- neither is something DeliveryOS
 * itself created, so neither is safe to delete automatically.
 */
export async function removeArtifact(cwd: string, id: string): Promise<RemoveResult> {
  const lockfile = readLockfile(cwd);
  const entry = lockfile.entries.find((e) => e.id === id);
  if (!entry) {
    throw new ArtifactNotPulledError(
      `"${id}" has no lockfile entry in this project -- nothing to remove (it was never pulled here, or has already been removed).`,
    );
  }

  // Prefer the real path recorded at pull time; an old-shape entry (pulled
  // before installTarget was recorded) falls back to resolving it fresh via
  // the manifest -- same function pull.ts itself uses. If that ALSO fails
  // (remote unregistered, artifact deleted from the catalog), fail loud and
  // honest rather than guess a path to delete.
  let installTarget: string;
  if (entry.installTarget) {
    installTarget = entry.installTarget;
  } else {
    let resolved;
    try {
      resolved = resolveArtifact(id, entry.remote);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new ArtifactNotPulledError(
        `"${id}"'s install location was never recorded (pulled before this was tracked), and it can no `
          + `longer be resolved from its manifest either: ${detail}. Nothing was removed -- locate and `
          + `delete its installed files manually, then remove its lockfile entry by hand.`,
      );
    }
    installTarget = path.resolve(cwd, resolved.manifest.install_target);
  }

  let removedInstallTarget = false;
  if (fs.existsSync(installTarget)) {
    fs.rmSync(installTarget, { recursive: true, force: true });
    removedInstallTarget = true;
  }

  // Defense in depth, same posture as applyDeterministicWiring's own
  // filesystem-write call: a lockfile-recorded path is still re-validated
  // for containment here, never trusted blindly, even though wiredFiles is
  // DeliveryOS's own prior write -- the lockfile is a plain project-local
  // JSON file, not something signature-verified the way a payload is.
  const wiredFiles = entry.wiredFiles ?? [];
  const removedWiredFiles: string[] = [];
  for (const wiredFile of wiredFiles) {
    const contained = resolveContainedTargetFile(cwd, wiredFile);
    if (!contained || !fs.existsSync(contained)) {
      continue;
    }
    fs.rmSync(contained, { recursive: true, force: true });
    removedWiredFiles.push(wiredFile);
  }

  // Both of these degrade gracefully to [] when the manifest can no longer
  // be resolved (remote unregistered, artifact deleted from the catalog) --
  // wiredFiles above is already the authoritative record of what DeliveryOS
  // itself created, so a real removal still completes even without this.
  let filesNeedingManualReview: string[] = [];
  let envParamsStillSet: string[] = [];
  try {
    const resolved = resolveArtifact(id, entry.remote);
    const wiredSet = new Set(wiredFiles);
    filesNeedingManualReview = resolveWiringActions(resolved.manifest.wiring_actions, cwd)
      .filter((action) => action.targetFileExists && !wiredSet.has(action.targetFile))
      .map((action) => action.targetFile);

    const existingEnvValues = readExistingEnvValues(cwd);
    envParamsStillSet = resolved.manifest.install_params
      .filter((param) => existingEnvValues[param.key] !== undefined)
      .map((param) => param.key);
  } catch {
    filesNeedingManualReview = [];
    envParamsStillSet = [];
  }

  const pristineTarget = pristinePath(cwd, id);
  let removedPristineSnapshot = false;
  if (fs.existsSync(pristineTarget)) {
    fs.rmSync(pristineTarget, { recursive: true, force: true });
    removedPristineSnapshot = true;
  }

  // Last: the real file deletions above have already happened, so a crash
  // right here still leaves an accurate (if now-stale) lockfile entry to
  // clean up rather than one that silently claims nothing was ever pulled.
  await removeEntry(cwd, id);

  return {
    removedInstallTarget,
    removedWiredFiles,
    filesNeedingManualReview,
    envParamsStillSet,
    removedPristineSnapshot,
  };
}
