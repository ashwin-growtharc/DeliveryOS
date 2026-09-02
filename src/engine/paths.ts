import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Single source of truth for every ~/.deliveryos/* and ./.deliveryos/* path
 * used anywhere in DeliveryOS. Nothing else in the codebase should
 * string-concat these paths directly.
 *
 * The global home directory can be overridden via the DELIVERYOS_HOME
 * environment variable. This exists specifically so tests (and any future
 * tooling) never touch the real developer machine's ~/.deliveryos.
 */

/** Root of the global DeliveryOS state directory (registry + remote caches). */
export function deliveryOsHome(): string {
  const override = process.env.DELIVERYOS_HOME;
  if (override && override.length > 0) {
    return override;
  }
  return path.join(os.homedir(), '.deliveryos');
}

/** Path to the global remote registry file. */
export function remotesRegistryPath(): string {
  return path.join(deliveryOsHome(), 'remotes.json');
}

/** Root directory under which all remote caches are cloned. */
export function remotesCacheRoot(): string {
  return path.join(deliveryOsHome(), 'remotes');
}

/** Path to the local clone cache for a specific named remote. `name`
 * ultimately comes from a `remote add --name` flag / RPC arg, not a fixed
 * internal enum -- sanitized the same way `previewCachePath` below already
 * sanitizes its own segments, so a value like `../../../SomeFolder` can't
 * clone (or later, on `remote remove`, delete) outside `remotesCacheRoot()`. */
export function remoteCachePath(name: string): string {
  assertSafePathSegment(name, 'remote name');
  return path.join(remotesCacheRoot(), name);
}

/** Project-local (cwd-scoped) DeliveryOS directory. */
export function projectDeliveryOsDir(cwd: string): string {
  return path.join(cwd, '.deliveryos');
}

/** Project-local (cwd-scoped) lockfile path. */
export function lockfilePath(cwd: string): string {
  return path.join(projectDeliveryOsDir(cwd), 'lock.json');
}

/** Project-local (cwd-scoped) audit log for Phase 10 item 2's "want help
 * fixing this?" flow -- append-only JSON-lines, one entry per fix
 * actually APPLIED (never on a request or a discard, which leave no
 * trace by design). The first append-only log file in this codebase;
 * kept deliberately simple (no read-modify-write, no existing log
 * convention to match) rather than introducing a heavier
 * logging/rotation mechanism this project doesn't otherwise need. */
export function buildFixLogPath(cwd: string): string {
  return path.join(projectDeliveryOsDir(cwd), 'build-fix-log.jsonl');
}

/** Project-local (cwd-scoped) audit log for Phase 11 item 4's design-fix
 * flow -- same append-only, apply-only-not-request-or-discard shape as
 * `buildFixLogPath` above, in its own file rather than a shared one: the
 * target here is a not-yet-pushed candidate's payload, not a real
 * project file, and keeping the two logs separate means neither one's
 * entries need a discriminant field to tell them apart later. */
export function designFixLogPath(cwd: string): string {
  return path.join(projectDeliveryOsDir(cwd), 'design-fix-log.jsonl');
}

/** Project-local (cwd-scoped) audit log for a backend-plugin's Tier-2
 * "AI wiring merge" flow -- same append-only, apply-only-not-request-or-
 * discard shape as `buildFixLogPath`/`designFixLogPath` above, in its own
 * file rather than a shared one for the same reason: the target here is
 * a real project file a `wiring_action` names that already existed
 * before the pull (`whenPresent`, previously a dead end with no
 * mechanism at all -- see `requestWiringMerge.ts`), a distinct case from
 * either of the other two logs. */
export function wiringMergeLogPath(cwd: string): string {
  return path.join(projectDeliveryOsDir(cwd), 'wiring-merge-log.jsonl');
}

/** Project-local (cwd-scoped) audit log for the AI-assisted wiring-
 * placement fallback's own "apply" half (`applyWiringPlacement`) -- same
 * append-only, apply-only-not-request-or-discard shape as
 * `wiringMergeLogPath` above, in its own file for the same reason: a
 * placement decision (which relative path a brand-new file landed at) is
 * a distinct kind of event from a merge into an already-existing file. */
export function wiringPlacementLogPath(cwd: string): string {
  return path.join(projectDeliveryOsDir(cwd), 'wiring-placement-log.jsonl');
}

/** Project-local (cwd-scoped) context file `deliveryos wire-with-claude`
 * writes for a real interactive `claude` session to read -- see
 * `buildWireContextMarkdown`'s own doc comment for why this is a file
 * the agent reads itself (via its own already-permissioned Read tool)
 * rather than text interpolated into the process's own argv. `id` comes
 * from a CLI argument already validated against a real lockfile entry by
 * the time this is called, but sanitized the same way `remoteCachePath`
 * sanitizes its own segments regardless -- defense in depth, not because
 * a specific exploit is known here. */
export function wireContextPath(cwd: string, id: string): string {
  assertSafePathSegment(id, 'artifact id');
  return path.join(projectDeliveryOsDir(cwd), `wire-context-${id}.md`);
}

/** Project-local (cwd-scoped) directory holding pristine (as-pulled)
 * snapshots of every pulled artifact's payload, keyed by id. Used by
 * `push` to diff a local edit against what was actually pulled. */
export function pristineDir(cwd: string): string {
  return path.join(projectDeliveryOsDir(cwd), 'pristine');
}

/** Path to the pristine snapshot for a specific pulled artifact id.
 *
 * `id` is sanitized the same way `remoteCachePath`, `wireContextPath` and
 * `previewCachePath` already sanitize their own segments -- this function
 * was the one sibling that did not, and it is the one whose result is fed
 * straight into `fs.rmSync(..., { recursive: true, force: true })` by
 * `removeArtifact`. Every other caller reaches it through a catalog match
 * (and `parser.ts` refuses any manifest whose `id` differs from its own
 * folder name, so a traversing id cannot reach the catalog), but
 * `removeArtifact` looks its entry up ONLY in the lockfile -- a plain
 * project-local JSON file anyone can hand-edit. `readLockfile` now drops
 * such an entry before it ever gets here; this is the backstop for any
 * caller that builds an id some other way. */
export function pristinePath(cwd: string, id: string): string {
  assertSafePathSegment(id, 'artifact id');
  return path.join(pristineDir(cwd), id);
}

/**
 * True when an artifact's resolved `install_target` IS the project root.
 *
 * That is a legitimate shape -- a scaffold artifact whose whole job is to drop
 * config files at the top level (eslint.config.js, .prettierrc, ...) has
 * nowhere else to put them, and `pullArtifact` installs one correctly. But it
 * breaks the assumption every OTHER consumer makes, that `installTarget` is a
 * directory containing nothing but the artifact: at the project root the
 * directory is the user's ENTIRE project, and only the handful of top-level
 * entries the payload actually provided belong to the artifact.
 *
 * Every call site that reads, diffs or deletes `installTarget` has to narrow it
 * back down with `readPayloadFootprint` -- see its doc comment.
 */
export function isRootInstall(cwd: string, installTarget: string): boolean {
  return path.resolve(installTarget) === path.resolve(cwd);
}

/**
 * The top-level entry names a ROOT-install artifact actually owns, read off its
 * pristine snapshot.
 *
 * `pullArtifact` deliberately builds that snapshot from the payload's own
 * top-level entries for exactly this case (copying the whole of `installTarget`
 * is both impossible and wrong at the project root -- see its comment), which
 * makes the snapshot the authoritative record of the artifact's footprint.
 *
 * `undefined` means the snapshot is missing entirely -- a stale or
 * pre-upgrade pull. The footprint is then genuinely unknowable, and callers
 * must refuse rather than guess: guessing at the project root means either
 * reporting the user's whole project as artifact content, or deleting it.
 */
export function readPayloadFootprint(pristineDir: string): string[] | undefined {
  if (!fs.existsSync(pristineDir)) {
    return undefined;
  }
  return fs.readdirSync(pristineDir);
}

/** Root directory for cached compiled UI-component previews (Phase 6).
 * Deliberately global (under `deliveryOsHome()`, alongside
 * `remotesCacheRoot()`), NOT cwd-scoped like `pristineDir` -- a compiled
 * preview needs to be viewable for a catalog entry that hasn't been
 * pulled into any project yet (the whole point of browsing live previews
 * before deciding to pull), and a compiled preview for the same
 * (remote, id, version) is identical regardless of which project folder
 * happens to be open, so caching it per-project would just recompile the
 * same output pointlessly for every different project. */
export function previewCacheRoot(): string {
  return path.join(deliveryOsHome(), 'preview-cache');
}

/** Resolves `candidate` against `root`, returning the absolute path only
 * when it's genuinely contained within `root` -- `undefined` otherwise.
 * Generalizes `wiring.ts`'s `resolveContainedTargetFile` (which does the
 * same thing, just always rooted at a project's `cwd`) so the same
 * containment check can guard any other untrusted manifest-supplied path
 * -- `install_target`, `payload_path` -- against `../../..` or an absolute
 * path escaping whichever root it's meant to stay inside (a project's
 * `cwd` for `install_target`, a remote's cache clone for `payload_path`).
 *
 * `root` itself counts as contained by default -- correct for
 * `payload_path`, where a whole-repo artifact legitimately points at the
 * cache clone's own root. It is NOT correct for `install_target`, where
 * resolving to the project's own `cwd` means "install over / delete the
 * entire project": `removeArtifact` feeds this straight into a recursive
 * delete, so an `install_target` of `"."` would take the user's whole
 * project with it. Those call sites pass `{ allowRoot: false }`. */
export function resolveContainedPath(
  root: string,
  candidate: string,
  options: { allowRoot?: boolean } = {},
): string | undefined {
  const { allowRoot = true } = options;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    return undefined;
  }
  if (!allowRoot && resolved === resolvedRoot) {
    return undefined;
  }
  return resolved;
}

/**
 * Adapts a manifest-declared path that assumes the `src/` directory
 * convention (`src/app/...`, `src/lib/...`, an `install_target` of
 * `src/lib/auth`) to whichever convention the REAL consuming project
 * actually uses. Every existing `wiring_actions`/`install_target` in
 * this catalog assumes `src/` by default (matching how `nextauth-
 * credentials`/`email-code-auth` were authored) -- silently wrong for a
 * project that doesn't use it, confirmed the hard way: a real pull
 * wrote `email-code-auth`'s API route to `src/app/api/auth/[...nextauth]/
 * route.ts` in a project whose real pages live under root `app/`, and
 * Next.js never served it from there at all.
 *
 * Detection mirrors Next.js's own real rule, confirmed directly against
 * its source (`node_modules/next/dist/lib/find-pages-dir.js`):
 * ```js
 * function findDir(dir, name) {
 *   // prioritize ./${name} over ./src/${name}
 *   ...
 * }
 * ```
 * Root `app/`/`pages/` wins whenever it exists; `src/app`/`src/pages`
 * is only ever checked when neither root one does. This function
 * mirrors exactly that precedence, but only ever adjusts a path that
 * actually starts with a literal `src/` segment -- never adds one, and
 * never touches a path that doesn't start with it.
 *
 * Returns the ORIGINAL `manifestPath` unchanged when the project
 * genuinely uses the `src/` convention (safe, backward-compatible --
 * matches every existing test/artifact's own assumption). Returns
 * `undefined` -- not a guess -- when NEITHER convention is yet
 * detectable (a genuinely fresh project, or a non-Next stack this
 * heuristic doesn't apply to at all): resolving that case is a real
 * judgment call, not this function's job.
 */
export function adaptSrcDirPath(cwd: string, manifestPath: string): string | undefined {
  const normalized = manifestPath.split(path.sep).join('/');
  if (!normalized.startsWith('src/')) {
    return manifestPath;
  }

  const hasRootAppOrPages =
    fs.existsSync(path.join(cwd, 'app')) || fs.existsSync(path.join(cwd, 'pages'));
  if (hasRootAppOrPages) {
    return normalized.slice('src/'.length);
  }

  const hasSrcAppOrPages =
    fs.existsSync(path.join(cwd, 'src', 'app')) || fs.existsSync(path.join(cwd, 'src', 'pages'));
  if (hasSrcAppOrPages) {
    return manifestPath;
  }

  return undefined;
}

/** Rejects any path segment that could escape `previewCacheRoot()` via
 * `path.join` -- e.g. a manifest `id` of `../../../etc` or a remote name
 * containing a path separator. `remoteName`/`id`/`version` all ultimately
 * originate from data DeliveryOS doesn't fully control (a pushed
 * manifest, a remote's own name) rather than a fixed internal enum, so
 * this is a real boundary, not defense-in-depth for its own sake. */
function assertSafePathSegment(segment: string, label: string): void {
  if (segment.length === 0 || segment.includes('/') || segment.includes('\\') || segment === '.' || segment === '..') {
    throw new Error(`Invalid ${label}: "${segment}"`);
  }
}

/** Path to a specific compiled preview's cached entry, keyed by (remote,
 * id, version, compilerVersion) so either an artifact version bump OR a
 * change to the compiler ITSELF naturally invalidates the cache (a stale
 * entry is simply never looked up again, not explicitly deleted) --
 * never pushed or pulled, purely a local derived artifact. Filename is
 * `compiled.json`, not `index.html` (Phase B's original shape) -- Phase C
 * caches the whole `CompiledPreview` object (html + variantNames +
 * propsSchemas), not just a raw HTML string; old Phase-B-era cache
 * entries simply become unreachable under this new filename, same
 * "invalidated by the key changing, nothing explicitly deleted"
 * philosophy as a version bump.
 *
 * `compilerVersion` (see `PREVIEW_COMPILER_VERSION` in compile.ts) exists
 * because of a real, confirmed bug: an already-pushed artifact whose OWN
 * version never changes can sit cached indefinitely, silently invisible
 * to every subsequent fix to the compiler's own output (Tailwind CSS
 * generation, vendored libraries, the iframe scrollbar fix, and whatever
 * width/height measurement race fixes came before those) -- confirmed by
 * hand against a real, months-old cached entry for a real pushed
 * component (`decrypting-text`) still missing every one of those fixes,
 * still running whatever measurement logic existed when it was first
 * compiled, including races since fixed. Bumping `PREVIEW_COMPILER_VERSION`
 * whenever compile.ts's output-affecting logic changes makes every
 * previously-cached preview across every remote/artifact/version stop
 * being looked up in one move, with no manual cache-clearing step for
 * anyone to remember. */
/** `subKey`, when given, adds one more path segment before `compiled.json`
 * -- for a `kind: template` artifact's own `components/<Name>/` preview,
 * where a single (remoteName, id, version) covers MANY distinct previews,
 * one per component, that would otherwise collide on the same cache file. */
export function previewCachePath(
  remoteName: string,
  id: string,
  version: string,
  compilerVersion: string,
  subKey?: string,
): string {
  assertSafePathSegment(remoteName, 'remote name');
  assertSafePathSegment(id, 'artifact id');
  assertSafePathSegment(version, 'version');
  assertSafePathSegment(compilerVersion, 'compiler version');
  const segments = [previewCacheRoot(), remoteName, id, version, `compiler-v${compilerVersion}`];
  if (subKey !== undefined) {
    assertSafePathSegment(subKey, 'preview sub-key');
    segments.push(subKey);
  }
  segments.push('compiled.json');
  return path.join(...segments);
}

/** Project-local (cwd-scoped) staging directory for one `scan` run's
 * synthetically-assembled UI-component payloads -- see
 * `detectUiComponents.ts`'s "flat convention" case, where a component file
 * has no dedicated folder of its own (e.g. `src/ui/button.tsx` sitting
 * flat among many unrelated siblings) and a COPY of it plus a generated
 * `preview.tsx` need somewhere real on disk to live as a payload. Deliberately
 * cwd-scoped like `pristineDir`, NOT global under `deliveryOsHome()` like
 * `previewCacheRoot` -- a staged payload is a disposable, per-project,
 * per-scan-run artifact (copied from a file that only exists in THIS
 * project), not something reusable across different projects the way a
 * compiled preview cache entry is. Nothing deletes this directory between
 * scans; a subdirectory is simply overwritten the next time scan stages
 * that same candidate id again, the same "invalidated by being
 * overwritten, nothing explicitly cleaned up" philosophy `previewCachePath`
 * already relies on for its own cache entries. */
export function scanStagingDir(cwd: string): string {
  return path.join(projectDeliveryOsDir(cwd), 'scan-staging');
}
