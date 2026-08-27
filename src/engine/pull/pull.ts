import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { buildCatalog, CatalogEntry } from '../catalog/catalog';
import { cachePath } from '../remote/remoteCache';
import { upsertEntry, readLockfile } from '../lockfile/lockfile';
import { pristinePath, resolveContainedPath, adaptSrcDirPath } from '../paths';
import { ArtifactResolutionError, ManifestValidationError, PostInstallError } from '../errors';
import { Manifest } from '../manifest/schema';
import {
  resolveInstallParamValues,
  applyInstallParams,
  readExistingEnvValues,
  applyEnvExamplePlaceholders,
} from './installParams';
import { verifyArtifactSignature } from '../provenance/verify';
import { isExecError, isToolNotFoundError } from '../execHelpers';

export interface PullResult {
  manifest: Manifest;
  remoteName: string;
  installTarget: string;
  postInstallOutput?: string;
  /** Which of this artifact's declared `install_params` still have no
   * value -- neither provided by the caller nor covered by the param's
   * own `default`. Never a hard failure (see `applyInstallParams`'s own
   * doc comment): a pull with missing required params still succeeds,
   * so a person can configure the rest later rather than lose an
   * otherwise-successful pull over one missing value. Always `[]` for
   * an artifact with no `install_params` at all. */
  missingRequiredParams: string[];
  /** Set only when this pull actually wrote a real secret value into
   * `.env.local` AND that file doesn't look covered by the project's own
   * `.gitignore` -- see `checkEnvLocalGitignoreCoverage`. Absent for the
   * overwhelming majority of pulls (no install_params written at all). */
  gitignoreWarning?: string;
}

/**
 * Shared progress-reporting hook for `pullArtifact`/`pushArtifact`. Callers
 * that don't care (the CLI commands) simply omit it -- every call site is a
 * no-op-safe `onProgress?.(...)`, so passing undefined changes no behavior.
 * The sidecar (`src/sidecar.ts`) is the one real consumer: it wires this to
 * emit `{event:'progress'}` lines to the Tauri host mid-call, which is what
 * lets the desktop UI show live stage-by-stage status instead of appearing
 * to hang during a long pull/push.
 */
export type ProgressCallback = (stage: string, message: string) => void;

// post_install commands are commonly `npm install`-shaped: on a fresh
// machine with a cold npm/pip cache, no local package cache, native
// module builds, or just a slow network, this can legitimately take
// several minutes -- longer runway than the build-verify timeout
// (`verifyBuild.ts`'s `BUILD_VERIFY_TIMEOUT_MS`) since this runs exactly
// once per pull rather than repeatedly, and installs are typically
// slower than a plain rebuild.
export const POST_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Resolves which catalog entry `id` refers to. Throws
 * ArtifactResolutionError if the id doesn't exist anywhere, or if it exists
 * in more than one remote and `remoteName` wasn't supplied to disambiguate.
 */
export function resolveArtifact(
  id: string,
  remoteName: string | undefined,
  catalog: CatalogEntry[] = buildCatalog(),
): CatalogEntry {
  const matches = catalog.filter((entry) => entry.manifest.id === id);

  if (matches.length === 0) {
    throw new ArtifactResolutionError(`No artifact with id "${id}" found in any registered remote`);
  }

  if (remoteName) {
    const match = matches.find((entry) => entry.remoteName === remoteName);
    if (!match) {
      throw new ArtifactResolutionError(
        `No artifact with id "${id}" found in remote "${remoteName}"`,
      );
    }
    return match;
  }

  if (matches.length > 1) {
    const remoteNames = matches.map((entry) => entry.remoteName).join(', ');
    throw new ArtifactResolutionError(
      `Artifact id "${id}" is ambiguous: found in multiple remotes (${remoteNames}). Use --remote to disambiguate.`,
    );
  }

  return matches[0];
}

/**
 * Pulls the artifact identified by `id` (optionally scoped to `remoteName`)
 * into `cwd`: copies its payload into install_target, runs post_install if
 * present, applies any declared install_params (`providedValues`, e.g. a
 * CLI's `--set KEY=VALUE` flags or the app's own required-config
 * checklist), then upserts the cwd-scoped lockfile. The lockfile is only
 * updated once the copy and post_install both succeed.
 *
 * `postInstallTimeoutMs` defaults to `POST_INSTALL_TIMEOUT_MS` for every
 * real caller (none pass it) -- it exists purely so tests can exercise the
 * real timeout path with a real hung command in milliseconds instead of
 * actually waiting out the production constant.
 */
export async function pullArtifact(
  id: string,
  remoteName: string | undefined,
  cwd: string,
  onProgress?: ProgressCallback,
  providedValues: Record<string, string> = {},
  postInstallTimeoutMs: number = POST_INSTALL_TIMEOUT_MS,
): Promise<PullResult> {
  onProgress?.('resolve', `Resolving artifact "${id}"...`);
  const entry = resolveArtifact(id, remoteName);
  const { manifest, remoteName: resolvedRemoteName } = entry;

  const remoteDir = cachePath(resolvedRemoteName);
  // `payload_path`/`install_target` are untrusted -- they come from
  // whatever the artifact author's manifest says, not something DeliveryOS
  // controls, and (unlike the payload's own content) neither is covered by
  // signature verification below. Resolving either with plain path.join/
  // path.resolve and no containment check would let a value like
  // "../../../../evil" or an absolute path escape the remote's own clone
  // (for payload_path) or the project (for install_target) entirely --
  // exactly the threat model `resolveContainedTargetFile` already guards
  // wiring_actions' own target_file against; this is that same check
  // applied to the two manifest fields that didn't have it yet.
  //
  // `payload_path`, when set, points directly at the artifact's real payload
  // location (a file or directory) relative to the remote's root, bypassing
  // the artifacts/<id>/payload/ convention entirely. Absent: unchanged.
  let payloadSrc: string;
  if (manifest.payload_path) {
    const contained = resolveContainedPath(remoteDir, manifest.payload_path);
    if (!contained) {
      throw new ManifestValidationError(
        `Artifact "${manifest.id}"'s payload_path ("${manifest.payload_path}") resolves outside the `
          + `remote's own directory -- refusing to pull.`,
      );
    }
    payloadSrc = contained;
  } else {
    payloadSrc = path.join(remoteDir, 'artifacts', manifest.id, 'payload');
  }
  if (!fs.existsSync(payloadSrc)) {
    throw new ArtifactResolutionError(
      `Artifact "${manifest.id}"'s payload was not found at the expected location (${payloadSrc}) -- `
        + `the remote may be out of date, or payload_path may be wrong. Try refreshing the catalog.`,
    );
  }
  // Adapts an install_target that assumes the `src/` convention (e.g.
  // `src/lib/auth`) to whichever convention this REAL project actually
  // uses -- see adaptSrcDirPath's own doc comment for why. Falls back to
  // the manifest's own literal value when neither convention is yet
  // detectable (a genuinely fresh project): resolving that ambiguity
  // for real is a judgment call for the Wiring section's own AI-assist
  // flow, not something the synchronous pull path guesses at.
  const effectiveInstallTarget = adaptSrcDirPath(cwd, manifest.install_target) ?? manifest.install_target;
  const installTarget = resolveContainedPath(cwd, effectiveInstallTarget);
  if (!installTarget) {
    throw new ManifestValidationError(
      `Artifact "${manifest.id}"'s install_target ("${manifest.install_target}") resolves outside the `
        + `project -- refusing to install.`,
    );
  }

  // Verifies BEFORE any files are written -- a no-op for the overwhelming
  // majority of artifacts, which declare no `signature` at all. The
  // signature bundle (a real Sigstore bundle, if present) always lives
  // alongside the manifest at artifacts/<id>/signature.bundle, regardless
  // of any `payload_path` override -- it's a property of the manifest
  // record, not the payload location.
  onProgress?.('verify', 'Verifying artifact signature...');
  const signatureBundlePath = path.join(remoteDir, 'artifacts', manifest.id, 'signature.bundle');
  const signatureBundle = fs.existsSync(signatureBundlePath)
    ? JSON.parse(fs.readFileSync(signatureBundlePath, 'utf-8'))
    : undefined;
  await verifyArtifactSignature(manifest, payloadSrc, signatureBundle);

  onProgress?.('copy', `Copying payload files to ${installTarget}...`);
  fs.cpSync(payloadSrc, installTarget, { recursive: true });

  let postInstallOutput: string | undefined;
  if (manifest.post_install) {
    onProgress?.('post_install', `Running: ${manifest.post_install}`);
    // `stdio: 'pipe'` (not 'inherit') is required here: this function can run
    // inside the Tauri sidecar (src/sidecar.ts), whose stdout is a
    // newline-delimited JSON stream -- a post_install command's raw output
    // written directly to the parent's stdout via 'inherit' would corrupt
    // that stream mid-line. Capturing it instead and returning it lets each
    // caller (CLI vs. sidecar) decide how to surface it.
    try {
      postInstallOutput = execSync(manifest.post_install, {
        cwd: installTarget,
        stdio: 'pipe',
        timeout: postInstallTimeoutMs,
      }).toString('utf-8');
    } catch (err) {
      const stdout = isExecError(err) ? err.stdout?.toString('utf-8') ?? '' : '';
      const stderr = isExecError(err) ? err.stderr?.toString('utf-8') ?? '' : '';
      const detail = err instanceof Error ? err.message : String(err);
      const output = [stdout, stderr].filter((s) => s.trim().length > 0).join('\n');

      // Confirmed empirically: `execSync` killed for exceeding its
      // `timeout` throws with `code: 'ETIMEDOUT'` -- unlike the
      // promisified async `exec` used in `verifyBuild.ts`, which reports
      // no distinct code at all for the same condition (see that file's
      // doc comment).
      if (isExecError(err) && err.code === 'ETIMEDOUT') {
        throw new PostInstallError(
          `post_install command timed out after ${postInstallTimeoutMs}ms for artifact "${manifest.id}" (still running/hung, no result was produced): ${manifest.post_install}`
            + (output ? `\n${output}` : ''),
        );
      }

      if (isToolNotFoundError([detail, output].join('\n'))) {
        throw new PostInstallError(
          `post_install command's tool was not found on this machine's PATH for artifact "${manifest.id}": ${manifest.post_install}`
            + (output ? `\n${output}` : ''),
        );
      }

      throw new PostInstallError(
        `post_install command failed for artifact "${manifest.id}": ${detail}`
          + (output ? `\n${output}` : ''),
      );
    }
  }

  // Snapshot a pristine copy of the artifact as-pulled, so `push`/status
  // checks can later diff a local edit against exactly what a fresh pull
  // left behind (not against mtimes, which change on every checkout/copy).
  // Snapshotting from `installTarget` -- AFTER post_install has already run,
  // not from `payloadSrc` before it -- is deliberate: post_install commonly
  // generates its own files (node_modules/, a lockfile, an .egg-info/ dir)
  // as an expected, normal side effect of a fresh pull. Snapshotting from
  // payloadSrc (pre-post_install) would make every one of those generated
  // files look like a local edit the moment post_install finishes, even
  // though the user hasn't touched anything yet.
  onProgress?.('snapshot', 'Recording installed state...');
  const pristineTarget = pristinePath(cwd, manifest.id);
  if (fs.existsSync(pristineTarget)) {
    fs.rmSync(pristineTarget, { recursive: true, force: true });
  }
  fs.cpSync(installTarget, pristineTarget, { recursive: true });

  // Deliberately after the pristine snapshot above, and writes to `cwd`
  // itself (`.env.local`), never into `installTarget` -- see
  // `applyInstallParams`'s own doc comment for why that separation is the
  // real point, not just a convenient ordering. A no-op (writes nothing)
  // for the overwhelming majority of artifacts, which declare no
  // install_params at all.
  onProgress?.('install-params', 'Applying install-time configuration...');
  const { values, missingRequired } = resolveInstallParamValues(
    manifest.install_params,
    providedValues,
    readExistingEnvValues(cwd),
  );
  const { gitignoreWarning } = applyInstallParams(cwd, values);
  // Tier 1 of the wiring agent (Phase 7 item 6) -- derived straight from
  // install_params, no separate declared action. Same no-op guarantee as
  // applyInstallParams for the overwhelming majority of artifacts that
  // declare no install_params at all.
  applyEnvExamplePlaceholders(cwd, manifest.install_params);

  onProgress?.('lockfile', 'Updating lockfile...');
  // Spreads any existing entry first (not a bare {id, version, remote,
  // installTarget}) -- a real, confirmed bug found via review: re-pulling
  // an already-installed artifact (a normal, supported action -- see the
  // "re-pulling upserts instead of duplicating" test) silently wiped that
  // entry's `pendingPr`/`wiredFiles`, breaking PR tracking and the
  // uninstall-safety guarantee (removeArtifact.ts reads `wiredFiles` to
  // know which files it's safe to delete). Same spread-the-existing-entry
  // pattern sync.ts/applyUpdate.ts/push.ts/pullAndAutoWire.ts already use
  // for this exact reason.
  const existingEntry = readLockfile(cwd).entries.find((e) => e.id === manifest.id);
  await upsertEntry(cwd, {
    ...existingEntry,
    id: manifest.id,
    version: manifest.version,
    remote: resolvedRemoteName,
    installTarget,
  });

  return {
    manifest,
    remoteName: resolvedRemoteName,
    installTarget,
    postInstallOutput,
    missingRequiredParams: missingRequired,
    gitignoreWarning,
  };
}
