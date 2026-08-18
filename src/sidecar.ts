#!/usr/bin/env node
/**
 * Sidecar entry point for the Tauri app. This is a SEPARATE process entry
 * point from `src/index.ts` -- it is never wired into `src/cli/program.ts`,
 * and it must never call `console.log`/`console.error` directly the way the
 * CLI commands do, because stdout here is a line-delimited JSON protocol
 * that the Tauri host process parses one line at a time. Any stray
 * non-JSON line would corrupt that stream.
 *
 * Protocol: the host writes one JSON object per line to stdin:
 *   { "id": string, "command": string, "args"?: object }
 * and this process writes exactly one JSON object per line to stdout in
 * response:
 *   { "id": string, "ok": true, "result": <value> }
 *   { "id": string, "ok": false, "error": { "type": string, "message": string } }
 *
 * The process keeps reading/responding to further lines until stdin
 * closes (EOF), at which point it exits cleanly.
 *
 * For long-running commands (`artifact.pull`/`artifact.push`), the sidecar
 * also writes zero or more intermediate progress lines BEFORE the final
 * response line for that same request:
 *   { "id": string, "event": "progress", "stage": string, "message": string }
 * `id` here is the same request id the eventual final response will carry,
 * so the host can correlate a stream of progress lines with the call that
 * produced them. These are purely additive -- they never replace or delay
 * the final `{ok, result}` / `{ok:false, error}` line, which remains the
 * actual completion signal.
 */
import * as path from 'path';
import * as readline from 'readline';
import { buildCatalog, refreshCatalog, CatalogEntry } from './engine/catalog/catalog';
import { readLockfile } from './engine/lockfile/lockfile';
import { computeChangedFiles } from './engine/push/diff';
import { pristinePath } from './engine/paths';
import { pullArtifact, resolveArtifact, ProgressCallback } from './engine/pull/pull';
import { resolveInstallParamValues, applyInstallParams, readExistingEnvValues } from './engine/pull/installParams';
import { resolveWiringActions } from './engine/pull/wiring';
import { pullAndAutoWire } from './engine/pull/pullAndAutoWire';
import { requestBuildFix, applyBuildFix } from './engine/pull/fixBuildFailure';
import { requestAntiPatternFix, applyAntiPatternFix } from './engine/scan/fixAntiPattern';
import { pushArtifact, PushOptions } from './engine/push/push';
import { checkForUpdates, resolvePendingPushes } from './engine/sync/sync';
import { scanForNewArtifacts } from './engine/scan/scan';
import { detectArtifactMetadata } from './engine/scan/detectArtifactMetadata';
import { suggestMetadata } from './engine/scan/suggestMetadata';
import { suggestAntiPatterns } from './engine/scan/suggestAntiPatterns';
import { getCommitIdentity } from './engine/git/git';
import {
  listRemotes,
  addRemoteEntry,
  removeRemoteEntry,
  findRemote,
  deriveNameFromUrl,
} from './engine/remote/remoteRegistry';
import { cloneRemote, cachePath } from './engine/remote/remoteCache';
import * as fs from 'fs';
import { RemoteRegistryError } from './engine/errors';
import { Manifest } from './engine/manifest/schema';
import { compileArtifactPreview, compileLocalPreview } from './engine/preview/resolveArtifactPreview';
import { readArtifactPayloadFile } from './engine/payload/readPayloadFile';
import { resolvePayloadDir, resolveWithinPayloadDir } from './engine/payload/payloadDir';
import { listArtifactPayloadComponents } from './engine/payload/listPayloadComponents';
import { checkSourceDrift } from './engine/drift/checkDrift';
import { pullPayloadComponent } from './engine/payload/pullPayloadComponent';
import {
  parseColorTokens,
  parseTypeScale,
  parseUsageRules,
  parseLayoutRules,
} from './engine/guidelines/parseGuidelinesTokens';
import { parseRoutesTree } from './engine/routes/parseRoutesTree';

interface SidecarRequest {
  id: string;
  command: string;
  args?: Record<string, unknown>;
}

interface SidecarSuccessResponse {
  id: string | null;
  ok: true;
  result: unknown;
}

interface SidecarErrorResponse {
  id: string | null;
  ok: false;
  error: { type: string; message: string };
}

type SidecarResponse = SidecarSuccessResponse | SidecarErrorResponse;

/** A handler may return its result synchronously or asynchronously --
 * `handleLine` always `await`s whatever comes back (awaiting a
 * non-Promise value is a no-op), so both shapes work uniformly.
 *
 * Every handler also receives a `ctx` object carrying `onProgress`, built
 * fresh per request by `handleLine` -- most handlers simply ignore it; only
 * `artifact.pull`/`artifact.push` actually call it, to surface live
 * stage-by-stage progress for those long-running commands. */
type CommandHandler = (
  args: Record<string, unknown>,
  ctx: { onProgress: ProgressCallback },
) => unknown | Promise<unknown>;

type LocalStatus = 'not_pulled' | 'pulled' | 'edited_locally';

export interface CatalogListEntry {
  manifest: Manifest;
  remoteName: string;
  localStatus: LocalStatus;
  installTarget: string;
  /** Set when a previous push opened a PR for this artifact that hasn't
   * been resolved yet (see `resolvePendingPushes`) -- lets the UI show real
   * transparency about a push's outcome without a separate network call
   * just to display it, since this is already-known local lockfile data. */
  pendingPr?: { number: number; url: string };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`"${key}" is required`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Extracts a plain string->string map (e.g. install-param values the app's
 * required-config checklist collected) -- absent or malformed entirely
 * defaults to `{}` rather than throwing, since providing no values at all
 * is the overwhelmingly common case (most artifacts declare none). */
function optionalStringRecord(args: Record<string, unknown>, key: string): Record<string, string> {
  const value = args[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Computes each catalog entry's status relative to the cwd-scoped
 * lockfile/pristine snapshot:
 *  - no lockfile entry -> 'not_pulled'
 *  - lockfile entry, no diff against the pristine snapshot -> 'pulled'
 *  - lockfile entry, diff detected -> 'edited_locally'
 *  - lockfile entry, but the diff can't be computed (e.g. a missing
 *    pristine snapshot, `PristineSnapshotMissingError`) -> falls back to
 *    'pulled' rather than throwing, so one bad entry never breaks Browse
 *    for every other artifact in the same `catalog.list` call.
 */
function annotateCatalog(
  entries: CatalogEntry[],
  cwd: string,
  remote: string | undefined,
): CatalogListEntry[] {
  const filtered = remote ? entries.filter((entry) => entry.remoteName === remote) : entries;
  const lockfile = readLockfile(cwd);

  return filtered.map((entry) => {
    const { manifest, remoteName } = entry;
    const installTarget = path.resolve(cwd, manifest.install_target);
    const lockEntry = lockfile.entries.find((e) => e.id === manifest.id);

    let localStatus: LocalStatus;
    if (!lockEntry) {
      localStatus = 'not_pulled';
    } else {
      try {
        const changedFiles = computeChangedFiles(installTarget, pristinePath(cwd, manifest.id));
        localStatus = changedFiles.length === 0 ? 'pulled' : 'edited_locally';
      } catch {
        localStatus = 'pulled';
      }
    }

    return { manifest, remoteName, localStatus, installTarget, pendingPr: lockEntry?.pendingPr };
  });
}

function catalogList(args: Record<string, unknown>): CatalogListEntry[] {
  const cwd = requireString(args, 'cwd');
  const remote = optionalString(args, 'remote');
  return annotateCatalog(buildCatalog(), cwd, remote);
}

/** Like `catalog.list`, but re-fetches every registered remote's local cache
 * first (see `refreshCatalog`'s doc comment) -- what Browse's "Refresh"
 * button calls, so it actually reflects a merge/change made upstream since
 * the last fetch instead of just re-reading stale local disk state. */
async function catalogRefresh(
  args: Record<string, unknown>,
  onProgress?: ProgressCallback,
): Promise<CatalogListEntry[]> {
  const cwd = requireString(args, 'cwd');
  const remote = optionalString(args, 'remote');
  const entries = await refreshCatalog(onProgress);
  return annotateCatalog(entries, cwd, remote);
}

async function remoteAdd(
  args: Record<string, unknown>,
): Promise<{ name: string; url: string; dest: string }> {
  const url = requireString(args, 'url');
  const name = optionalString(args, 'name') ?? deriveNameFromUrl(url);

  // Check for an existing registration before cloning anything, so a
  // duplicate name fails fast without corrupting the existing entry or
  // leaving behind a stray clone -- mirrors `runRemoteAdd`'s order exactly
  // (src/cli/commands/remoteAdd.ts).
  if (findRemote(name)) {
    throw new RemoteRegistryError(`A remote named "${name}" is already registered`);
  }

  const dest = await cloneRemote(name, url);
  addRemoteEntry({ name, url, addedAt: new Date().toISOString() });

  return { name, url, dest };
}

/** Unregisters a remote and deletes its local cache clone -- mirrors
 * `runRemoteRemove`'s order exactly (src/cli/commands/remoteAdd.ts).
 * Doesn't touch any project's lockfile/pulled files, only this remote's
 * own registration + cache. */
function remoteRemove(args: Record<string, unknown>): { name: string } {
  const name = requireString(args, 'name');
  removeRemoteEntry(name); // throws RemoteRegistryError if not registered
  const dest = cachePath(name);
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  return { name };
}

/** Command map: every command the frontend/Tauri layer can invoke. */
const commands: Record<string, CommandHandler> = {
  'catalog.list': (args) => catalogList(args),

  'catalog.refresh': (args, { onProgress }) => catalogRefresh(args, onProgress),

  'artifact.pull': (args, { onProgress }) => {
    const id = requireString(args, 'id');
    const cwd = requireString(args, 'cwd');
    const remote = optionalString(args, 'remote');
    const values = optionalStringRecord(args, 'values');
    return pullArtifact(id, remote, cwd, onProgress, values);
  },

  // Phase 10 item 1: "deterministic apply-and-test on Pull, no agent
  // involved yet." A separate command from artifact.pull, not a change to
  // it -- the app's own Pull button opts into this explicitly (only for
  // artifacts that declare wiring_actions); the CLI's `deliveryos pull`
  // keeps using the plain command above, unchanged.
  'artifact.pullAndAutoWire': (args, { onProgress }) => {
    const id = requireString(args, 'id');
    const cwd = requireString(args, 'cwd');
    const remote = optionalString(args, 'remote');
    const values = optionalStringRecord(args, 'values');
    return pullAndAutoWire(id, remote, cwd, onProgress, values);
  },

  // Configures an already-pulled artifact's install_params without a full
  // re-pull -- e.g. the user filled in the required-config checklist
  // AFTER pulling, or is going back to fix one value later. Resolves the
  // SAME manifest/params pullArtifact itself would (via resolveArtifact),
  // so the "provided value wins over the param's own default" rule stays
  // identical in both places, not two subtly different implementations.
  'artifact.applyInstallParams': (args) => {
    const id = requireString(args, 'id');
    const cwd = requireString(args, 'cwd');
    const remote = optionalString(args, 'remote');
    const values = optionalStringRecord(args, 'values');
    const entry = resolveArtifact(id, remote);
    const resolved = resolveInstallParamValues(
      entry.manifest.install_params,
      values,
      readExistingEnvValues(cwd),
    );
    applyInstallParams(cwd, resolved.values);
    return { missingRequiredParams: resolved.missingRequired };
  },

  // Reads one file (e.g. README.md) directly out of an artifact's payload
  // in its remote's local cache -- lets Detail render real setup
  // documentation for a non-visual artifact (backend-plugin) before
  // anyone decides to pull it, the same "browse before you commit"
  // principle preview.compile already established for ui-component.
  'artifact.readPayloadFile': (args) => {
    const remote = requireString(args, 'remote');
    const id = requireString(args, 'id');
    const relativePath = requireString(args, 'path');
    const content = readArtifactPayloadFile(remote, id, relativePath);
    return { content };
  },

  // Phase 11 Detail-view task: one read + parse of a design-kit-shaped
  // artifact's GUIDELINES.md, gating the new Detail section on real
  // content presence -- never a `kind: template` check, matching this
  // codebase's own backend-plugin-section convention (field/file presence,
  // not kind). `present: false` (with empty arrays) is the normal case for
  // any artifact that isn't design-kit-shaped, not an error.
  'artifact.parseGuidelines': (args) => {
    const remote = requireString(args, 'remote');
    const id = requireString(args, 'id');
    const content = readArtifactPayloadFile(remote, id, 'GUIDELINES.md');
    // A 0-byte/whitespace-only GUIDELINES.md is treated the same as absent
    // -- matches the truthiness check the Documentation tab's own
    // renderDocumentationTab already uses on this same file (app.js);
    // without this, an empty file used to show the Design/Components tabs
    // with nothing in them while Documentation stayed hidden for the same
    // file, a real inconsistency (found via review).
    if (content === undefined || content.trim().length === 0) {
      return { present: false, colorTokens: [], typeScale: [], usageRules: {}, layoutRules: null };
    }
    return {
      present: true,
      colorTokens: parseColorTokens(content),
      typeScale: parseTypeScale(content),
      usageRules: parseUsageRules(content),
      layoutRules: parseLayoutRules(content),
    };
  },

  // Route/page map Detail section: one read + parse of a whole-app
  // template's src/routes.tsx, gating the new Detail section on real
  // file presence -- never a `kind: template` check, matching this
  // codebase's own backend-plugin/guidelines-section convention.
  // `present: false` (with an empty routes array) is the normal case for
  // any artifact that doesn't ship a routes.tsx, not an error.
  'artifact.parseRoutes': (args) => {
    const remote = requireString(args, 'remote');
    const id = requireString(args, 'id');
    const content = readArtifactPayloadFile(remote, id, 'src/routes.tsx');
    if (content === undefined) {
      return { present: false, routes: [] };
    }
    return { present: true, routes: parseRoutesTree(content, 'routes.tsx') };
  },

  // Lists every real, preview-having component in a design-kit-shaped
  // payload's components/ directory, for Detail's live component grid.
  'artifact.listPayloadComponents': (args) => {
    const remote = requireString(args, 'remote');
    const id = requireString(args, 'id');
    return { components: listArtifactPayloadComponents(remote, id) };
  },

  // Pulls ONE component out of a design-kit-shaped bundle -- unlike
  // artifact.pull, this is not tracked (no lockfile entry, no pristine
  // snapshot): a component isn't its own artifact, there's no
  // install_target for "just Header." destDir comes from a real native
  // folder dialog the app already drives (window.__TAURI__.dialog.open),
  // never a fixed convention path -- the person picks where it lands in
  // their own project, same as every other destination-picking action
  // in this app (Add New's payload picker, Settings' Change folder).
  'artifact.pullPayloadComponent': (args) => {
    const remote = requireString(args, 'remote');
    const id = requireString(args, 'id');
    const relativeDir = requireString(args, 'relativeDir');
    const destDir = requireString(args, 'destDir');
    return pullPayloadComponent(remote, id, relativeDir, destDir);
  },

  // Tier 2 of the wiring agent (Phase 7 item 6): resolves every
  // wiring_action a manifest declares against the REAL project at `cwd` --
  // purely read-only detection (does the target file already exist?),
  // never a file mutation. Lets Detail's Wiring subsection show a
  // concrete, tailored suggestion instead of the README's own generic
  // copy-paste instructions.
  'artifact.resolveWiringActions': (args) => {
    const id = requireString(args, 'id');
    const cwd = requireString(args, 'cwd');
    const remote = optionalString(args, 'remote');
    const entry = resolveArtifact(id, remote);
    return resolveWiringActions(entry.manifest.wiring_actions, cwd);
  },

  'artifact.push': async (args, { onProgress }) => {
    const id = requireString(args, 'id');
    const cwd = requireString(args, 'cwd');
    const options = (args.options ?? {}) as PushOptions;
    return await pushArtifact(id, options, cwd, undefined, onProgress);
  },

  'remote.list': () => listRemotes(),

  'remote.add': async (args) => remoteAdd(args),

  'remote.remove': (args) => remoteRemove(args),

  'sync.checkForUpdates': (args, { onProgress }) => {
    const cwd = requireString(args, 'cwd');
    return checkForUpdates(cwd, onProgress);
  },

  'sync.resolvePendingPushes': (args, { onProgress }) => {
    const cwd = requireString(args, 'cwd');
    return resolvePendingPushes(cwd, onProgress);
  },

  'scan.run': (args, { onProgress }) => {
    const cwd = requireString(args, 'cwd');
    const remote = requireString(args, 'remote');
    return scanForNewArtifacts(cwd, remote, onProgress);
  },

  // Phase 10 item 3 (extended): reads a real payload's actual source --
  // process.env.X usage, import/dependency statements, a JSDoc/frontmatter
  // comment -- and proposes install_params/stacks/description together.
  // The Add New wizard calls this once a payload path (and its already-
  // chosen kind) are known, pre-filling editable fields rather than blank
  // ones, for every kind, not just backend-plugin-shaped payloads.
  'artifact.detectMetadata': (args) => {
    const payloadPath = requireString(args, 'payloadPath');
    const kind = requireString(args, 'kind');
    return detectArtifactMetadata(payloadPath, kind);
  },

  // Phase 10 item 3 (extended): a real default for Add New's Owner field --
  // the local machine's own git identity (`git config user.name`, already
  // resolved the same way a real push commit's author is), not a guess.
  // Still freely editable before submit, same as every other autofilled
  // field here.
  'git.identity': (args) => {
    const cwd = requireString(args, 'cwd');
    return getCommitIdentity(cwd);
  },

  // The first AI-invoking command in Add New's autofill -- everything
  // else here is static analysis. Only called on an explicit "Suggest
  // with Claude" button click, never automatically. See
  // suggestMetadata.ts's own doc comment for the real, tested limitations
  // of the tool-restriction flags used here.
  'artifact.suggestMetadata': (args) => {
    const payloadPath = requireString(args, 'payloadPath');
    const kind = requireString(args, 'kind');
    return suggestMetadata(payloadPath, kind);
  },

  // Phase 11 item 3: the subjective counterpart to item 2's mechanical
  // self-nesting detector -- same "explicit button, never automatic"
  // rule as artifact.suggestMetadata above, same real cost (latency + a
  // real API call). See suggestAntiPatterns.ts's own doc comments.
  'artifact.suggestAntiPatterns': (args) => {
    const payloadPath = requireString(args, 'payloadPath');
    return suggestAntiPatterns(payloadPath);
  },

  // Phase 10 item 2: the "ask" half of "want help fixing this?" -- only
  // ever offered by the UI for a file item 1's own auto-wiring just
  // wrote (AppliedWiringResult.applied), never an arbitrary file guessed
  // from build-error text. No write, no audit-log entry -- see
  // fixBuildFailure.ts's own doc comments for why.
  'artifact.requestBuildFix': (args) => {
    const cwd = requireString(args, 'cwd');
    const filePath = requireString(args, 'filePath');
    const buildError = requireString(args, 'buildError');
    return requestBuildFix(cwd, filePath, buildError);
  },

  // Phase 10 item 2: the "apply" half -- writes the fix for real, re-runs
  // the real build to confirm it, rolls back automatically if it doesn't
  // actually resolve the failure, and appends exactly one audit-log
  // entry either way. Only reached after an explicit human confirmation
  // click in the UI; never automatic.
  'artifact.applyBuildFix': (args) => {
    const cwd = requireString(args, 'cwd');
    const filePath = requireString(args, 'filePath');
    const fixedFile = requireString(args, 'fixedFile');
    const buildError = requireString(args, 'buildError');
    const costUsd = typeof args.costUsd === 'number' ? args.costUsd : undefined;
    const durationMs = typeof args.durationMs === 'number' ? args.durationMs : undefined;
    return applyBuildFix(cwd, filePath, fixedFile, buildError, { costUsd, durationMs });
  },

  // Phase 11 item 4: the "ask" half of the fix step for a design
  // anti-pattern finding (item 2/item 3) -- same "no write, no
  // audit-log entry" shape as artifact.requestBuildFix above.
  'artifact.requestAntiPatternFix': (args) => {
    const payloadPath = requireString(args, 'payloadPath');
    const finding = requireString(args, 'finding');
    return requestAntiPatternFix(payloadPath, finding);
  },

  // Phase 11 item 4: the "apply" half -- writes the fix for real,
  // re-compiles the candidate's live preview to confirm it still
  // works, rolls back automatically if it doesn't, and appends exactly
  // one audit-log entry either way. Only reached after an explicit
  // human confirmation click; never automatic.
  'artifact.applyAntiPatternFix': (args) => {
    const cwd = requireString(args, 'cwd');
    const payloadPath = requireString(args, 'payloadPath');
    const file = requireString(args, 'file');
    const fixedFile = requireString(args, 'fixedFile');
    const finding = requireString(args, 'finding');
    const costUsd = typeof args.costUsd === 'number' ? args.costUsd : undefined;
    const durationMs = typeof args.durationMs === 'number' ? args.durationMs : undefined;
    return applyAntiPatternFix(cwd, payloadPath, file, fixedFile, finding, { costUsd, durationMs });
  },

  // Real preview-compile command (Phase 6, Phase B), replacing Phase A's
  // temporary `preview.compileDebug`. Reads directly from the named
  // remote's own cloned cache (no pull required) -- the UI Components
  // page can show a live preview for anything in the catalog, not just
  // artifacts already pulled into the current project.
  'preview.compile': (args) => {
    const remote = requireString(args, 'remote');
    const id = requireString(args, 'id');
    return compileArtifactPreview(remote, id);
  },

  // Phase 6, Phase D: a Scan-discovered ui-component candidate has no
  // remote/id/version yet (it's never been pushed) -- this compiles its
  // live preview directly from wherever it currently sits on disk
  // (`payloadPath`, a real project folder or a synthetic staged
  // directory; see `detectUiComponentCandidates`), so Add New's Review
  // step can show it before the user decides to propose it at all.
  'preview.compileLocal': (args) => {
    const payloadPath = requireString(args, 'payloadPath');
    return compileLocalPreview(payloadPath);
  },

  // Phase 11 Detail-view task: compiles ONE component's live preview out
  // of a design-kit-shaped payload's components/<Name> subdirectory, for
  // Detail's grid (one call per component, run in parallel by the app).
  // Modeled on preview.compileLocal above, NOT a preview.compile variant --
  // unlike preview.compileLocal (only ever called with the user's OWN
  // project path during Add New), `relativeDir` here is resolved and
  // sandboxed against the artifact's real payload dir server-side, since
  // the caller only supplies a remote/id/relativeDir, never a raw path.
  'preview.compilePayloadComponent': (args) => {
    const remote = requireString(args, 'remote');
    const id = requireString(args, 'id');
    const relativeDir = requireString(args, 'relativeDir');
    const payloadDir = resolvePayloadDir(remote, id);
    const componentDir = resolveWithinPayloadDir(payloadDir, relativeDir);
    return compileLocalPreview(componentDir);
  },

  // Source-drift-detection: checks whether the real external project an
  // extracted artifact's SOURCES.json points at has changed since
  // extraction. `source` is a local folder the user picks via a native
  // dialog (Detail's own new "Check for source drift" section) --
  // resolvePayloadDir/checkSourceDrift throw a clear, typed error
  // (SourcesFileMissingError) if the artifact was never recorded with
  // source-drift tracking, which the app surfaces as a toast, same as any
  // other RPC error.
  'artifact.checkSourceDrift': (args) => {
    const remote = requireString(args, 'remote');
    const id = requireString(args, 'id');
    const source = requireString(args, 'source');
    const payloadDir = resolvePayloadDir(remote, id);
    return { results: checkSourceDrift(payloadDir, source) };
  },
};

/**
 * Writes a single response line. Uses plain `JSON.stringify` with no
 * pretty-printing arguments -- this is load-bearing: it guarantees the
 * entire response (including any embedded `\n` inside a string field,
 * e.g. a multi-line artifact description) is escaped onto one physical
 * line, so the host's line-based reader never sees a response split
 * across multiple lines.
 */
function writeResponse(response: SidecarResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

/**
 * Writes a single progress line for an in-flight request, using the exact
 * same "one JSON object per line, no pretty-printing" discipline as
 * `writeResponse` -- for the same reason: a description or message field
 * containing an embedded `\n` must not split this onto multiple physical
 * lines. Always written before that request's eventual `writeResponse` call,
 * never after.
 */
function writeProgress(id: string | null, stage: string, message: string): void {
  process.stdout.write(JSON.stringify({ id, event: 'progress', stage, message }) + '\n');
}

function errorInfo(err: unknown): { type: string; message: string } {
  if (err instanceof Error) {
    return { type: err.name, message: err.message };
  }
  return { type: 'Error', message: String(err) };
}

/**
 * Handles a single request line. This is `async` (some commands --
 * `artifact.push`, `remote.add` -- do real async work like git clone/push
 * and GitHub API calls), but it never throws/rejects: every error path
 * resolves to a `writeResponse` call. That's what makes it safe for `main`
 * to fire this off without awaiting it per line (see below).
 */
async function handleLine(line: string): Promise<void> {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return;
  }

  let request: SidecarRequest;
  try {
    request = JSON.parse(trimmed) as SidecarRequest;
  } catch (err) {
    // No `id` could be recovered from unparseable input, so respond with
    // id: null rather than crashing the process or dropping the line
    // silently.
    writeResponse({ id: null, ok: false, error: errorInfo(err) });
    return;
  }

  const { id, command, args } = request;

  try {
    const handler = commands[command];
    if (!handler) {
      throw new Error(`Unknown command "${String(command)}"`);
    }
    const ctx = { onProgress: (stage: string, message: string) => writeProgress(id, stage, message) };
    const result = await handler(args ?? {}, ctx);
    writeResponse({ id, ok: true, result });
  } catch (err) {
    writeResponse({ id, ok: false, error: errorInfo(err) });
  }
}

function main(): void {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  // Tracks requests whose `handleLine` call hasn't resolved yet. This is
  // what lets `close` (stdin EOF) wait for in-flight async handlers
  // (`artifact.push`, `remote.add`) to actually finish and write their
  // response before the process exits, instead of racing them: without
  // this, a host that sends one request and closes stdin immediately
  // afterward (or this sidecar being piped a batch of lines directly, as
  // in manual smoke-testing) could hit EOF while e.g. a `remote.add`
  // clone is still running, and `process.exit(0)` would kill it
  // mid-flight with no response ever written.
  let pendingCount = 0;
  let stdinClosed = false;

  function exitIfDone(): void {
    if (stdinClosed && pendingCount === 0) {
      process.exit(0);
    }
  }

  rl.on('line', (line) => {
    // Fire-and-forget from the readline loop's perspective: `handleLine`
    // may await real async work (git clone, GitHub API calls), but the
    // loop must keep accepting further lines concurrently rather than
    // blocking on any one request's completion -- there's no shared
    // mutable state across a single call, so overlapping in-flight
    // requests are safe. `handleLine` never throws/rejects (every error
    // path writes an error response instead), so `.finally` is purely for
    // pending-count bookkeeping, never error handling.
    pendingCount += 1;
    void handleLine(line).finally(() => {
      pendingCount -= 1;
      exitIfDone();
    });
  });
  rl.on('close', () => {
    stdinClosed = true;
    exitIfDone();
  });
}

main();
