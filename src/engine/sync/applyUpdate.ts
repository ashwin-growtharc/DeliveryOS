import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { readLockfile, upsertEntry } from '../lockfile/lockfile';
import { findRemote } from '../remote/remoteRegistry';
import { cachePath } from '../remote/remoteCache';
import { fetchAndReset } from '../git/git';
import { buildCatalog } from '../catalog/catalog';
import { computeChangedFiles, listFilesRecursive } from '../push/diff';
import { pristinePath, resolveContainedPath } from '../paths';
import { ProgressCallback, POST_INSTALL_TIMEOUT_MS } from '../pull/pull';
import { isExecError, isToolNotFoundError } from '../execHelpers';
import { compareVersions } from './sync';

/** One artifact's real update-apply outcome -- either it was actually
 * updated (`applied: true`), or nothing was touched and `reason` says why. */
export interface ApplyUpdateResult {
  id: string;
  remote: string;
  previousVersion: string;
  availableVersion: string;
  applied: boolean;
  /** Always set when `applied` is false -- a person should never see a
   * silent no-op. Never set when `applied` is true. */
  reason?: string;
  postInstallOutput?: string;
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
    await fetchAndReset(cachePath(name));
  }

  const catalog = buildCatalog();
  const results: ApplyUpdateResult[] = [];

  for (const entry of relevantEntries) {
    const match = catalog.find(
      (candidate) => candidate.manifest.id === entry.id && candidate.remoteName === entry.remote,
    );
    // Vanished upstream entirely, or its remote was since unregistered --
    // out of scope here, same as checkForUpdates's own skip.
    if (!match) {
      continue;
    }

    const previousVersion = entry.version;
    const availableVersion = match.manifest.version;
    if (compareVersions(availableVersion, previousVersion) <= 0) {
      // Not actually outdated -- omitted, not reported, so a bulk
      // "apply everything outdated" call's output stays focused on real
      // updates instead of restating every already-current artifact.
      continue;
    }

    const report = (applied: boolean, reason?: string, postInstallOutput?: string, note?: string): void => {
      results.push({ id: entry.id, remote: entry.remote, previousVersion, availableVersion, applied, reason, postInstallOutput, note });
    };

    if (!entry.installTarget) {
      report(false, 'This artifact was pulled before its install location was tracked -- re-pull it once, then updates can be applied.');
      continue;
    }

    let changedFiles;
    try {
      changedFiles = computeChangedFiles(entry.installTarget, pristinePath(cwd, entry.id));
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

    const installTarget = resolveContainedPath(cwd, manifest.install_target);
    if (!installTarget) {
      report(false, `The new version's install_target resolves outside the project -- refusing to update.`);
      continue;
    }
    if (installTarget !== entry.installTarget) {
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

    onProgress?.('update', `Updating "${entry.id}" ${previousVersion} -> ${availableVersion}...`);

    const pristineTarget = pristinePath(cwd, entry.id);
    // fs.cpSync below only adds/overwrites files the new payload has --
    // it never deletes a file the CURRENT install has that the new
    // version dropped. Diffing the OLD pristine snapshot against the NEW
    // payload (not the current install against the new payload -- they're
    // identical at this point, since changedFiles was already confirmed
    // empty above) finds exactly those removed files.
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

    if (fs.existsSync(pristineTarget)) {
      fs.rmSync(pristineTarget, { recursive: true, force: true });
    }
    fs.cpSync(installTarget, pristineTarget, { recursive: true });
    await upsertEntry(cwd, { ...entry, version: availableVersion });

    const note = manifest.wiring_actions.length > 0
      ? 'This version declares wiring suggestions -- worth checking the Wiring section again in case this update added a new one.'
      : undefined;
    report(true, undefined, postInstallOutput, note);
  }

  return results;
}
