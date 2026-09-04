import * as fs from 'fs';
import { readLockfile } from '../lockfile/lockfile';
import { findRemote } from '../remote/remoteRegistry';
import { resolveArtifact } from '../pull/pull';
import { computeChangedFiles, ChangedFile } from './diff';
import { bumpVersion, VersionBumpKind } from '../manifest/version';
import { compareVersions } from '../sync/sync';
import {
  pristinePath,
  resolveContainedPath,
  adaptSrcDirPath,
  isRootInstall,
  readPayloadFootprint,
} from '../paths';
import {
  PushModeConflictError,
  RemoteRegistryError,
  ManifestValidationError,
  NoLocalChangesError,
} from '../errors';

/**
 * What a push WOULD do, without doing any of it.
 *
 * `pushArtifact` computes all of this and then throws it away: the changed-file
 * list at `push.ts:558`, `previousVersion`/`newVersion` at `:703-704`, the
 * staleness comparison at `:625`. None of it is reachable without also opening
 * a pull request, which is the gap `docs/agent-surface-plan.md:379-382` records
 * as the reason push is not an agent surface:
 *
 *   "Push is all-or-nothing over the whole pulled folder with no diff preview
 *    and no confirmation (verified). An agent pushing a filled-in risk register
 *    would publish client data to a shared repo."
 *
 * That is not hypothetical. `PLAN.md:180` ships a `risk-register` artifact
 * whose own README says "fill in your own copy, never push it back", and
 * `docs/delivery-tools-requirements.md:145` describes a scoping calculator
 * whose instance half is "a specific client's quoted number". Push publishes
 * the whole pulled folder, and `ARCHITECTURE.md:363` states the hard rule: "No
 * customer data in any DeliveryOS-shared remote, ever."
 *
 * So this is the control, not ceremony: it makes the file list visible BEFORE
 * anything is published.
 *
 * DELIBERATELY NOT A REFACTOR OF `pushArtifact`. Extracting `push.ts:487-679`
 * into a shared helper would be tidier and is the obvious suggestion, but that
 * is the most safety-critical function in the repo -- the one whose comments
 * record a bug that opened a PR *deleting an artifact's entire payload* on a
 * shared remote. This composes the same pure helpers instead, and
 * `planPush.equivalence.test.ts` pins that its file list matches what a real
 * push actually commits, so the two cannot drift silently. If they ever do, that
 * test fails rather than a PR being wrong.
 */

export type PushMode = 'edit' | 'metadata' | 'new';

export interface PushPlan {
  id: string;
  remoteName: string;
  mode: PushMode;

  /** Absolute path the payload is diffed from. */
  installTarget: string;

  /** Exactly what a push would put in the PR, in the order it would list them. */
  changedFiles: ChangedFile[];

  previousVersion: string;
  /** Absent for a metadata-only edit, which never bumps. */
  newVersion?: string;

  /** True when the remote has moved past what this project pulled. A push would
   * refuse with `StalePushError` unless forced. */
  stale: boolean;
  /** The version upstream is on now, when `stale`. */
  upstreamVersion?: string;

  /** Set when this project already has an unresolved PR open for this artifact.
   *
   * Load-bearing, not informational: `push.ts:624` reads `pendingPr` as
   * `hasOwnPushInFlight` and **disables the stale-push guard entirely** for the
   * next push. So an open PR silently removes a safety check for whoever
   * pushes next, and a caller deciding whether to push deserves to know. */
  pendingPr?: { number: number; url: string };
}

/**
 * Runs every check `pushArtifact` performs before its first remote mutation
 * (`push.ts:753`), in the same order, and returns what it found.
 *
 * Throws the same errors a real push would throw for the same reasons, so a
 * caller that previews successfully has already cleared the local refusals.
 * It reaches no network and writes nothing.
 *
 * Only `mode: 'edit'` is supported. Metadata-only and propose-new are
 * deliberately out of scope: propose-new is authoring rather than contributing
 * (it needs kind/owner/description/payloadPath), and `push.ts:772` never
 * records a `pendingPr` for it, so DeliveryOS would never follow the PR up.
 */
export function planPush(
  id: string,
  cwd: string,
  options: { bump?: VersionBumpKind } = {},
): PushPlan {
  const lockfile = readLockfile(cwd);
  const lockEntry = lockfile.entries.find((e) => e.id === id);

  // Same refusal and wording as push.ts:199-203, so a preview and a push agree
  // about what is trackable.
  if (!lockEntry) {
    throw new PushModeConflictError(
      `"${id}" is not tracked (no lockfile entry in this project) -- it can only be previewed as an edit `
        + 'to an artifact this project has pulled.',
    );
  }

  const remoteName = lockEntry.remote;
  if (!findRemote(remoteName)) {
    throw new RemoteRegistryError(`No remote named "${remoteName}" is registered`);
  }

  const entry = resolveArtifact(id, remoteName);
  const { manifest } = entry;

  // push.ts:518-528. The lockfile's recorded target wins when it is still
  // valid for THIS cwd, because it is where the payload actually landed --
  // re-deriving it from the manifest was the bug that made a push propose
  // deleting an artifact's whole payload.
  const recorded = lockEntry.installTarget;
  const recordedIsUsable = recorded !== undefined && resolveContainedPath(cwd, recorded) === recorded;
  const installTarget = recordedIsUsable
    ? recorded
    : resolveContainedPath(cwd, adaptSrcDirPath(cwd, manifest.install_target) ?? manifest.install_target);

  if (!installTarget) {
    throw new ManifestValidationError(
      `Artifact "${id}"'s install_target ("${manifest.install_target}") resolves outside the project -- `
        + 'refusing to preview a push.',
    );
  }

  // push.ts:536-542. A missing install target makes computeChangedFiles report
  // every pristine file as `deleted`, which is a changeset that would sail past
  // the emptiness guard.
  if (!fs.existsSync(installTarget)) {
    throw new ManifestValidationError(
      `Artifact "${id}"'s files are not at "${installTarget}" -- nothing there to push. If this project `
        + 'moved or was cloned from somewhere else, re-pull it once so its recorded location matches '
        + 'where the files actually are.',
    );
  }

  const pristine = pristinePath(cwd, id);
  const rootInstall = isRootInstall(cwd, installTarget);
  const topLevelScope = rootInstall ? readPayloadFootprint(pristine) : undefined;
  if (rootInstall && !topLevelScope) {
    throw new ManifestValidationError(
      `Artifact "${id}" installs at the project root, and its pristine snapshot is missing, so there is `
        + 'no record of which files belong to it -- refusing to preview rather than guess at the whole '
        + `project. Re-pull it (\`deliveryos pull ${id}\`) to rebuild the snapshot.`,
    );
  }

  const changedFiles = computeChangedFiles(installTarget, pristine, { topLevelScope });
  if (changedFiles.length === 0) {
    throw new NoLocalChangesError(
      `No local changes detected for "${id}" -- its files are byte-for-byte identical to the pristine `
        + 'snapshot taken at pull time. Nothing to push.',
    );
  }

  // push.ts:625. Note this reports staleness even when `pendingPr` is set,
  // unlike the real guard, which skips the whole check in that case. A preview
  // that hid it would be hiding the exact condition its caller must decide
  // about.
  const stale = compareVersions(manifest.version, lockEntry.version) > 0;

  return {
    id,
    remoteName,
    mode: 'edit',
    installTarget,
    changedFiles,
    previousVersion: lockEntry.version,
    newVersion: bumpVersion(lockEntry.version, options.bump ?? 'patch'),
    stale,
    ...(stale ? { upstreamVersion: manifest.version } : {}),
    ...(lockEntry.pendingPr ? { pendingPr: lockEntry.pendingPr } : {}),
  };
}
