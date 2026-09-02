import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { readLockfile, upsertEntry } from '../lockfile/lockfile';
import { findRemote } from '../remote/remoteRegistry';
import { cachePath, refreshRemoteCache } from '../remote/remoteCache';
import { buildCatalog } from '../catalog/catalog';
import { computeChangedFiles, listFilesRecursive } from '../push/diff';
import { pristinePath, resolveContainedPath, isRootInstall, readPayloadFootprint, adaptSrcDirPath } from '../paths';
import { ProgressCallback, POST_INSTALL_TIMEOUT_MS, POST_INSTALL_MAX_BUFFER_BYTES, writePristineSnapshot } from '../pull/pull';
import { isSensitiveTargetPath } from '../pull/wiring';
import { isExecError, isToolNotFoundError } from '../execHelpers';
import { compareVersions } from './sync';

/** One artifact's real update-apply outcome -- either it was actually
 * updated (`applied: true`), or nothing was touched and `reason` says why. */
export interface ApplyUpdateResult {
  id: string;
  remote: string;
  previousVersion: string;
  /** The version found upstream. ABSENT only when the artifact could not be
   * found in the catalog at all (removed upstream, its remote unregistered,
   * or its manifest now failing validation) -- there is no upstream version
   * to name in that case, and echoing `previousVersion` would read as
   * "1.0.0 -> 1.0.0 available". Always set when `applied` is true. */
  availableVersion?: string;
  applied: boolean;
  /** Always set when `applied` is false -- a person should never see a
   * silent no-op. Never set when `applied` is true. */
  reason?: string;
  postInstallOutput?: string;
  /** What the new version changed, relative to the copy this project had.
   * Populated only when `applied` is true -- on a refusal nothing was touched,
   * so there is nothing to report. Empty when the diff could not be computed
   * (a missing pristine snapshot), which is deliberately not the same as "no
   * changes". */
  changedFiles?: Array<{ relPath: string; status: string }>;
  /** Set only when applied is true AND the new version declares
   * wiring_actions -- a version bump can add a NEW integration step this
   * function deliberately does not attempt to auto-apply (that's a
   * separate, already-existing Tier 2 flow, not part of "update"), so a
   * person is told to go check it rather than silently missing it. */
  note?: string;
}

/**
 * Fills the real gap `checkForUpdates` (sync.ts) always left open: it only
 * ever reported "installed -> available," never actually re-pulled or
 * re-applied anything. This is the missing other half -- but deliberately
 * conservative, not a full 3-way merge.
 *
 * Safe to apply ONLY when the current `install_target` is byte-for-byte
 * identical to its pristine snapshot (`computeChangedFiles` returns `[]`)
 * -- i.e. nothing has locally edited this artifact since it was pulled.
 * An artifact with real local edits is reported, never silently skipped
 * and never guessed at: merging a local edit against a new upstream
 * version is the same hard problem `requestWiringMerge.ts`'s AI-assisted
 * merge already exists for at the single-file level, and extending that
 * to a whole artifact's worth of files is real, separate, future work --
 * not attempted here. `onlyId`, when given, scopes this to a single
 * artifact (the app's own per-artifact "Update" action); omitted, every
 * outdated artifact in the lockfile is attempted in one pass (the CLI's
 * `check-updates --apply`).
 *
 * Mirrors `checkForUpdates`'s own fetch-then-catalog shape exactly (only
 * remotes actually referenced by a relevant lockfile entry are fetched),
 * and a single artifact's post_install failing never aborts the rest of
 * the batch -- same "one bad one doesn't block the others" posture
 * `refreshCatalog`/`resolvePendingPushes` already established.
 */
export async function applyAvailableUpdates(
  cwd: string,
  onProgress?: ProgressCallback,
  onlyId?: string,
): Promise<ApplyUpdateResult[]> {
  const lockfile = readLockfile(cwd);
  const relevantEntries = onlyId
    ? lockfile.entries.filter((entry) => entry.id === onlyId)
    : lockfile.entries;
  const remoteNames = Array.from(new Set(relevantEntries.map((entry) => entry.remote)));

  for (const name of remoteNames) {
    const remote = findRemote(name);
    if (!remote) {
      continue;
    }
    onProgress?.('fetch', `Fetching latest from ${name}...`);
    await refreshRemoteCache(name);
  }

  const catalog = buildCatalog();
  const results: ApplyUpdateResult[] = [];

  for (const entry of relevantEntries) {
    const previousVersion = entry.version;
    // Declared before `report` and assigned only once a catalog match exists,
    // so the !match branch below can report through the SAME single reporting
    // path as every other degradation in this loop.
    let availableVersion: string | undefined;
    // `changedFiles` is assigned only on the success path below, so a refusal
    // never claims to know what upstream changed.
    let upstreamChangesForReport: Array<{ relPath: string; status: string }> | undefined;
    const report = (applied: boolean, reason?: string, postInstallOutput?: string, note?: string): void => {
      results.push({
        id: entry.id, remote: entry.remote, previousVersion, availableVersion, applied, reason,
        postInstallOutput, note, changedFiles: upstreamChangesForReport,
      });
    };

    const match = catalog.find(
      (candidate) => candidate.manifest.id === entry.id && candidate.remoteName === entry.remote,
    );
    if (!match) {
      // Was a bare `continue`, contradicting this function's own documented
      // contract ("Always set when applied is false -- a person should never
      // see a silent no-op"): the CLI printed "No updates available." and the
      // app's Update button reported nothing at all for an artifact that had
      // actually vanished from its remote.
      report(
        false,
        `"${entry.id}" is no longer in remote "${entry.remote}"'s catalog -- it may have been removed `
          + `upstream, its remote unregistered, or its manifest may now be failing validation (run `
          + `\`deliveryos list\`, which reports manifests it could not load). Nothing was changed.`,
      );
      continue;
    }

    availableVersion = match.manifest.version;
    if (compareVersions(availableVersion, previousVersion) <= 0) {
      // Not actually outdated -- omitted, not reported, so a bulk
      // "apply everything outdated" call's output stays focused on real
      // updates instead of restating every already-current artifact.
      // INTENTIONAL, and different from the !match branch above: this
      // artifact is present and fine. Do not "fix" this one too.
      continue;
    }

    if (!entry.installTarget) {
      report(false, 'This artifact was pulled before its install location was tracked -- re-pull it once, then updates can be applied.');
      continue;
    }

    // A root install_target means entry.installTarget IS the whole project, so
    // the clean-check has to be narrowed to the entries this artifact owns --
    // otherwise every unrelated file in the project reads as a local edit and
    // the update is refused forever. See isRootInstall.
    const entryPristine = pristinePath(cwd, entry.id);
    const entryIsRootInstall = isRootInstall(cwd, entry.installTarget);
    const entryTopLevelScope = entryIsRootInstall ? readPayloadFootprint(entryPristine) : undefined;
    if (entryIsRootInstall && !entryTopLevelScope) {
      report(false, 'This artifact installs at the project root and its pristine snapshot is missing, so there is no record of which files belong to it -- re-pull it once, then updates can be applied.');
      continue;
    }
    let changedFiles;
    try {
      changedFiles = computeChangedFiles(entry.installTarget, entryPristine, { topLevelScope: entryTopLevelScope });
    } catch (err) {
      report(false, `Could not verify this artifact's local state: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (changedFiles.length > 0) {
      const names = changedFiles.slice(0, 5).map((c) => c.relPath).join(', ');
      const more = changedFiles.length > 5 ? `, and ${changedFiles.length - 5} more` : '';
      report(
        false,
        `${changedFiles.length} local change${changedFiles.length === 1 ? '' : 's'} detected (${names}${more}) -- `
          + `refusing to auto-update over a local edit. Push the edit first (or resolve it by hand), then try again.`,
      );
      continue;
    }

    const remoteDir = cachePath(entry.remote);
    const manifest = match.manifest;

    let payloadSrc: string;
    if (manifest.payload_path) {
      const contained = resolveContainedPath(remoteDir, manifest.payload_path);
      if (!contained) {
        report(false, `The new version's payload_path resolves outside the remote's own directory -- refusing to update.`);
        continue;
      }
      payloadSrc = contained;
    } else {
      payloadSrc = path.join(remoteDir, 'artifacts', manifest.id, 'payload');
    }
    if (!fs.existsSync(payloadSrc)) {
      report(false, `The new version's payload was not found on disk (${payloadSrc}) -- the remote may be out of date.`);
      continue;
    }

    // allowRoot stays TRUE, matching pullArtifact: a root install_target is a
    // legitimate scaffold shape, and refusing it here meant such an artifact
    // could never be updated. The two genuinely dangerous operations at the
    // project root -- the stale-file sweep and the snapshot below -- are both
    // already footprint-scoped rather than whole-directory.
    //
    // Adapted the SAME way pullArtifact adapts it (pull.ts) before recording
    // entry.installTarget. Resolving the manifest's RAW value here meant that
    // in any project without a `src/` directory -- where adaptSrcDirPath
    // shortens `src/lib/x` to `lib/x` at pull time -- the lockfile's shortened
    // path never equalled this one, so the relocation guard below refused
    // EVERY update for EVERY artifact whose install_target starts with `src/`.
    // Permanently, and with a message blaming the new version for a move that
    // never happened.
    const effectiveInstallTarget = adaptSrcDirPath(cwd, manifest.install_target) ?? manifest.install_target;
    const installTarget = resolveContainedPath(cwd, effectiveInstallTarget);
    if (!installTarget) {
      report(false, `The new version's install_target resolves outside the project -- refusing to update.`);
      continue;
    }
    // Accept EITHER spelling of the same manifest string. adaptSrcDirPath is
    // filesystem-dependent, so a project that gained a root `app/` after the
    // pull would otherwise produce a fresh false "this version moved
    // install_target". Both candidates derive from the same manifest value, so
    // a genuine relocation (a different string) still fails both and is still
    // refused -- see this file's own e2e control case.
    const rawInstallTarget = resolveContainedPath(cwd, manifest.install_target);
    if (installTarget !== entry.installTarget && rawInstallTarget !== entry.installTarget) {
      // A version that relocates install_target is a real but rare edge
      // case -- refusing rather than guessing which of the two locations
      // is "right" keeps this safe; remove + re-pull handles it manually.
      report(
        false,
        `This version moved install_target from "${entry.installTarget}" to "${installTarget}" -- refusing to `
          + `auto-update across a location change. Remove and re-pull it instead.`,
      );
      continue;
    }

    // The relocation guard above only catches a NEW version moving into a
    // sensitive location. An artifact pulled before pull.ts gained this check
    // is already installed in one, and would otherwise keep updating into it
    // forever.
    if (isSensitiveTargetPath(path.resolve(cwd), installTarget)) {
      report(
        false,
        `This artifact installs into a location whose contents can run on their own `
          + `("${manifest.install_target}") -- refusing to update. Remove it and review the manifest by hand.`,
      );
      continue;
    }

    onProgress?.('update', `Updating "${entry.id}" ${previousVersion} -> ${availableVersion}...`);

    const pristineTarget = pristinePath(cwd, entry.id);
    // fs.cpSync below only adds/overwrites files the new payload has --
    // it never deletes a file the CURRENT install has that the new
    // version dropped. Diffing the OLD pristine snapshot against the NEW
    // payload (not the current install against the new payload -- they're
    // identical at this point, since changedFiles was already confirmed
    // empty above) finds exactly those removed files.
    // What the new version actually changes, computed against the same two
    // trees the stale-file sweep below already walks.
    //
    // This comparison existed and was thrown away: files were DELETED based on
    // it and the person was never told which. Meanwhile the refusal path a
    // hundred lines up will name five of *their* changed files -- so the one
    // thing reported in detail was your own edit, and the thing that actually
    // overwrote your files was reported as a version number.
    let upstreamChanges: ReturnType<typeof computeChangedFiles> = [];
    try {
      upstreamChanges = computeChangedFiles(payloadSrc, pristineTarget, { topLevelScope: entryTopLevelScope });
    } catch {
      // A missing pristine snapshot is already handled above for the paths that
      // need it; here an unknowable diff must not block a legitimate update.
      upstreamChanges = [];
    }

    const oldFiles = new Set(listFilesRecursive(pristineTarget));
    const newFiles = new Set(listFilesRecursive(payloadSrc));
    for (const relPath of oldFiles) {
      if (!newFiles.has(relPath)) {
        const staleFile = path.join(installTarget, relPath);
        if (fs.existsSync(staleFile)) {
          fs.rmSync(staleFile, { force: true });
        }
      }
    }
    fs.cpSync(payloadSrc, installTarget, { recursive: true });

    let postInstallOutput: string | undefined;
    if (manifest.post_install) {
      try {
        postInstallOutput = execSync(manifest.post_install, {
          cwd: installTarget,
          stdio: 'pipe',
          timeout: POST_INSTALL_TIMEOUT_MS,
          // Same env and buffer as pull.ts's own post_install call -- this
          // is the SAME manifest command, just run on the update path
          // instead of the first install, so it needs the same contract.
          //
          // DELIVERYOS_PROJECT_ROOT was missing here, which broke
          // `check-updates --apply` for every backend plugin: the authoring
          // skill mandates `cd "$DELIVERYOS_PROJECT_ROOT" && npm install`,
          // and with the variable unset that expands to `cd "" && npm
          // install`. Reported as "post_install failed", with the update
          // already half-applied on disk. See pull.ts's own call site for
          // the full history of why this variable exists.
          env: { ...process.env, DELIVERYOS_PROJECT_ROOT: cwd },
          // Node's default is 1 MB, which a real `npm install` routinely
          // exceeds -- and blowing it surfaces as a generic post_install
          // failure rather than anything that names the real cause.
          maxBuffer: POST_INSTALL_MAX_BUFFER_BYTES,
        }).toString('utf-8');
      } catch (err) {
        const stdout = isExecError(err) ? err.stdout?.toString('utf-8') ?? '' : '';
        const stderr = isExecError(err) ? err.stderr?.toString('utf-8') ?? '' : '';
        const detail = err instanceof Error ? err.message : String(err);
        const output = [stdout, stderr].filter((s) => s.trim().length > 0).join('\n');
        // Files are already updated on disk at this point -- there's no
        // coherent "old version" left to roll back to (the same accepted
        // gap pullArtifact's own post_install failure has, see its doc
        // comment). Pristine/lockfile are deliberately NOT updated below,
        // so the next status check correctly reports this as a real,
        // visible divergence rather than silently claiming success.
        const kind = isExecError(err) && err.code === 'ETIMEDOUT'
          ? 'timed out'
          : isToolNotFoundError([detail, output].join('\n'))
            ? "could not run (its tool isn't on this machine's PATH)"
            : 'failed';
        report(
          false,
          `Files were updated to ${availableVersion}, but its post_install command ${kind}: ${detail}`
            + (output ? `\n${output}` : '')
            + `\nThe update is only half-applied on disk -- re-run post_install by hand, or remove and re-pull.`,
        );
        continue;
      }
    }

    // Same helper pullArtifact uses. This used to be a bare
    // fs.cpSync(installTarget, pristineTarget), which for a root install both
    // throws ERR_FS_CP_EINVAL (the snapshot lives inside the directory being
    // copied) and would snapshot the user's entire project -- pull had handled
    // that case since adb677c, and this path had not.
    writePristineSnapshot(cwd, installTarget, payloadSrc, pristineTarget);
    await upsertEntry(cwd, { ...entry, version: availableVersion });

    const note = manifest.wiring_actions.length > 0
      ? 'This version declares wiring suggestions -- worth checking the Wiring section again in case this update added a new one.'
      : undefined;
    upstreamChangesForReport = upstreamChanges.map((c) => ({ relPath: c.relPath, status: c.status }));
    report(true, undefined, postInstallOutput, note);
  }

  return results;
}
