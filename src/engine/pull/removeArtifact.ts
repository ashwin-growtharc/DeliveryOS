import * as fs from 'fs';
import { execSync } from 'child_process';
import { readLockfile, removeEntry } from '../lockfile/lockfile';
import { resolveArtifact, POST_INSTALL_MAX_BUFFER_BYTES } from './pull';
import { resolveContainedTargetFile, resolveWiringActions } from './wiring';
import { readExistingEnvValues } from './installParams';
import { pristinePath, resolveContainedPath } from '../paths';
import { ArtifactNotPulledError } from '../errors';
import { isExecError, isToolNotFoundError, rmDirWithRetry } from '../execHelpers';

// Same 10-minute runway as pull.ts's POST_INSTALL_TIMEOUT_MS, same
// reasoning (a real, one-shot lifecycle command, not something run
// repeatedly) -- see that constant's own doc comment.
const POST_REMOVE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Runs a manifest's `post_remove` command, if any -- mirrors
 * `pull.ts`'s own `post_install` execution shape (`execSync`, piped
 * stdio, the same timeout/tool-not-found classification via
 * `execHelpers.ts`) with ONE deliberate difference: this never throws.
 * `post_install`'s failure safely aborts a pull (nothing has been
 * recorded as installed yet); `post_remove`'s failure must NOT abort a
 * removal -- see `removeArtifact`'s own doc comment for why a hard-fail
 * here would trap a person with both a broken side effect (e.g. a
 * still-running Docker container) AND a DeliveryOS that refuses to let
 * them finish removing the artifact tracking it. Returns whichever of
 * `output`/`warning` actually applies; a caller with no `post_remove`
 * declared at all never calls this function in the first place.
 */
function runPostRemoveCommand(
  command: string,
  installTarget: string,
  projectRoot: string,
  timeoutMs: number = POST_REMOVE_TIMEOUT_MS,
): { output?: string; warning?: string } {
  try {
    // DELIVERYOS_PROJECT_ROOT: same real, confirmed fix as post_install's
    // own identical addition in pull.ts -- see that file's doc comment
    // for the full story (a fixed relative `cd ../..` escape silently
    // overshoots whenever adaptSrcDirPath shortens install_target's
    // effective depth). Runs with cwd: installTarget by default (same as
    // post_install, and for the same reason -- its command may reference
    // files inside it), but a manifest that needs the real project root
    // now has an absolute, always-correct path to reach it.
    const output = execSync(command, {
      cwd: installTarget,
      stdio: 'pipe',
      timeout: timeoutMs,
      env: { ...process.env, DELIVERYOS_PROJECT_ROOT: projectRoot },
      // Same 1 MB-default trap as post_install/verifyBuild: a chatty
      // teardown command would otherwise be killed with ENOBUFS and
      // reported as a post_remove failure.
      maxBuffer: POST_INSTALL_MAX_BUFFER_BYTES,
    }).toString('utf-8');
    return { output };
  } catch (err) {
    const stdout = isExecError(err) ? err.stdout?.toString('utf-8') ?? '' : '';
    const stderr = isExecError(err) ? err.stderr?.toString('utf-8') ?? '' : '';
    const detail = err instanceof Error ? err.message : String(err);
    const combined = [stdout, stderr].filter((s) => s.trim().length > 0).join('\n');

    if (isExecError(err) && err.code === 'ETIMEDOUT') {
      return {
        warning: `post_remove command timed out after ${timeoutMs}ms (still running/hung, no result was produced): ${command}`
          + (combined ? `\n${combined}` : ''),
      };
    }
    if (isToolNotFoundError([detail, combined].join('\n'))) {
      return {
        warning: `post_remove command's tool was not found on this machine's PATH: ${command}`
          + (combined ? `\n${combined}` : ''),
      };
    }
    return {
      warning: `post_remove command failed: ${detail}`
        + (combined ? `\n${combined}` : ''),
    };
  }
}

/** What `removeArtifact` actually did against a real project -- every field
 * reports something that genuinely happened (or genuinely didn't), never a
 * best-effort guess. */
export interface RemoveResult {
  removedInstallTarget: boolean;
  /** Set when `installTarget` still existed but could not actually be
   * deleted after retrying (a real, confirmed Windows race -- see
   * `rmDirWithRetry`'s own doc comment in `execHelpers.ts`). Informational
   * only, same posture as `postRemoveWarning`: the rest of removal
   * (wired files, pristine snapshot, lockfile entry) still completes
   * regardless, so a stuck directory lock never traps a person mid-removal. */
  installTargetWarning?: string;
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
  /** Captured stdout of a real, successfully-run `post_remove` command --
   * absent when the manifest declares none, or when it couldn't be
   * resolved at all (same graceful degradation as filesNeedingManualReview/
   * envParamsStillSet below). */
  postRemoveOutput?: string;
  /** Set when `post_remove` was declared and actually ran, but failed --
   * informational only, same posture as envParamsStillSet: removal still
   * completed normally regardless. See `runPostRemoveCommand`'s own doc
   * comment for why this never blocks removal the way a failing
   * post_install blocks a pull. */
  postRemoveWarning?: string;
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
export async function removeArtifact(
  cwd: string,
  id: string,
  // Test-only override -- production always uses POST_REMOVE_TIMEOUT_MS.
  // Same shape as pullArtifact's own postInstallTimeoutMs parameter.
  postRemoveTimeoutMs: number = POST_REMOVE_TIMEOUT_MS,
): Promise<RemoveResult> {
  const lockfile = readLockfile(cwd);
  const entry = lockfile.entries.find((e) => e.id === id);
  if (!entry) {
    throw new ArtifactNotPulledError(
      `"${id}" has no lockfile entry in this project -- nothing to remove (it was never pulled here, or has already been removed).`,
    );
  }

  // Only ever the real path recorded at pull time. An old-shape entry
  // (pulled before installTarget was recorded) REFUSES rather than falling
  // back to re-reading `install_target` from the manifest.
  //
  // That fallback used to exist and was a genuine trust bug: `install_target`
  // is a remote-controlled, MUTABLE field, and this function feeds whatever
  // it resolves to straight into a recursive delete. Re-reading it at removal
  // time meant whoever controls the remote -- not DeliveryOS, and not the
  // user -- decided what got deleted, and could change that decision after
  // the artifact was already installed. `resolveContainedPath` was the only
  // guard, and it permitted the project root itself.
  //
  // Re-pulling is cheap and records a real `installTarget`, so refusing costs
  // the user one command and removes the whole class of problem. This is
  // exactly the posture ArtifactNotPulledError already documents.
  if (!entry.installTarget) {
    throw new ArtifactNotPulledError(
      `"${id}"'s install location was never recorded in lock.json (it was pulled before DeliveryOS `
        + `tracked that). Nothing was removed. Re-pull it (\`deliveryos pull ${id}\`) so the real `
        + `install location is recorded, then remove it -- or delete its files manually and drop its `
        + `lockfile entry by hand. DeliveryOS will not infer a delete target from the artifact's `
        + `current manifest, because that value lives on the remote and can change after install.`,
    );
  }
  const rawInstallTarget: string = entry.installTarget;

  // Defense in depth, same posture as the wiredFiles re-validation just
  // below: `lock.json` is a plain project-local JSON file a person could
  // hand-edit (or, for the fallback branch above, a value freshly re-read
  // from an untrusted manifest) -- never trusted blindly before a
  // recursive delete, even though `entry.installTarget` is normally
  // DeliveryOS's own prior write. Unlike wiredFiles (silently skipped when
  // uncontained -- a minor, secondary part of the artifact), this is the
  // PRIMARY thing being removed, so a failed containment check fails loud
  // rather than quietly reporting "removed: false" for what looks like a
  // normal, successful no-op.
  const installTarget = resolveContainedPath(cwd, rawInstallTarget, { allowRoot: false });
  if (!installTarget) {
    throw new ArtifactNotPulledError(
      `"${id}"'s recorded install location ("${rawInstallTarget}") does not resolve to a directory `
        + `inside this project -- refusing to delete it. It either escapes the project, or it IS the `
        + `project root, which would delete everything. Nothing was removed; check lock.json by hand `
        + `before retrying.`,
    );
  }

  // Resolved ONCE, here -- before any deletion -- and reused for both
  // post_remove execution (needs installTarget to still exist on disk,
  // since its command may reference files inside it, e.g. a
  // docker-compose.yml) and the review-lists computation below (moved
  // earlier from its own previous location for exactly this reason).
  // `resolveWiringActions`/`readExistingEnvValues` both check the
  // PROJECT ROOT (cwd), never installTarget's own contents, so moving
  // this earlier changes nothing about what either one reports -- only
  // post_remove's own timing requirement forced the move. Degrades
  // gracefully to `undefined` when the manifest can no longer be
  // resolved (remote unregistered, artifact deleted from the catalog) --
  // wiredFiles is already the authoritative record of what DeliveryOS
  // itself created, so a real removal still completes even without this.
  //
  // Always resolved fresh here: nothing above needs the manifest any more
  // now that the install location comes only from the lockfile.
  let resolvedManifest: ReturnType<typeof resolveArtifact>['manifest'] | undefined;
  try {
    resolvedManifest = resolveArtifact(id, entry.remote).manifest;
  } catch {
    resolvedManifest = undefined;
  }

  let postRemoveOutput: string | undefined;
  let postRemoveWarning: string | undefined;
  if (resolvedManifest?.post_remove && fs.existsSync(installTarget)) {
    const result = runPostRemoveCommand(resolvedManifest.post_remove, installTarget, cwd, postRemoveTimeoutMs);
    postRemoveOutput = result.output;
    postRemoveWarning = result.warning;
  }

  let removedInstallTarget = false;
  let installTargetWarning: string | undefined;
  if (fs.existsSync(installTarget)) {
    // A just-run post_remove (above) may have timed out and left a real
    // grandchild process still holding a lock on this exact directory --
    // see rmDirWithRetry's own doc comment (execHelpers.ts). Caught here,
    // deliberately: even rmDirWithRetry's own widened retry budget can't
    // guarantee a stuck lock clears in time, and this function's whole
    // design exists so a person is never trapped mid-removal (the exact
    // posture runPostRemoveCommand's own failures already take) -- the
    // rest of removal (wired files, pristine snapshot, lockfile entry)
    // still needs to complete even when this one step doesn't.
    try {
      await rmDirWithRetry(installTarget);
      removedInstallTarget = true;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      installTargetWarning = `Could not delete "${installTarget}" -- something may still be holding it open `
        + `(this can happen right after a slow post_remove command was killed for exceeding its timeout): `
        + `${detail}. The rest of removal still completed; delete this directory by hand once nothing is `
        + `using it.`;
    }
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

  let filesNeedingManualReview: string[] = [];
  let envParamsStillSet: string[] = [];
  if (resolvedManifest) {
    const wiredSet = new Set(wiredFiles);
    filesNeedingManualReview = resolveWiringActions(resolvedManifest.wiring_actions, cwd)
      .filter((action) => action.targetFileExists && !wiredSet.has(action.targetFile))
      .map((action) => action.targetFile);

    const existingEnvValues = readExistingEnvValues(cwd);
    envParamsStillSet = resolvedManifest.install_params
      .filter((param) => existingEnvValues[param.key] !== undefined)
      .map((param) => param.key);
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
    installTargetWarning,
    removedWiredFiles,
    filesNeedingManualReview,
    envParamsStillSet,
    removedPristineSnapshot,
    postRemoveOutput,
    postRemoveWarning,
  };
}
