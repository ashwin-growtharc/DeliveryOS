import * as fs from 'fs';
import * as path from 'path';
import { WiringAction } from '../manifest/schema';
import { adaptSrcDirPath } from '../paths';

/**
 * A manifest's `target_file` is untrusted input -- it comes from whatever
 * the artifact's own author wrote, and (unlike the payload itself) is
 * NEVER covered by signature verification's own content-digest check.
 * Resolving it against `cwd` with plain `path.resolve` and no containment
 * check would let a value like `"../../../../evil.txt"` or an absolute
 * path escape the project entirely -- verified directly: `path.resolve`
 * happily walks past `cwd`'s own root with enough `../` segments, or
 * ignores `cwd` altogether when `targetFile` is already absolute. Returns
 * the resolved absolute path only when it's genuinely inside `cwd`;
 * `undefined` otherwise, so every caller has to explicitly decide what
 * "refused to resolve" means for it rather than silently trusting a path
 * that was never supposed to leave the project.
 */
export function resolveContainedTargetFile(cwd: string, targetFile: string): string | undefined {
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, targetFile);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return undefined;
  }
  return resolved;
}

/**
 * Directories where an auto-written file can execute or run on its own,
 * without the person ever having reviewed it -- found via security review:
 * `resolveContainedTargetFile` above only checked that a `target_file`
 * stays inside the project, which a real git hook, CI workflow, or
 * editor-auto-run task all trivially satisfy. Since `deliveryos pull`
 * defaults to auto-writing any wiring target that doesn't already exist
 * (Phase 19), an unsigned artifact's manifest (the common case -- most
 * artifacts declare no `signature` at all, and even a real signature only
 * covers the payload's own content-digest, never `wiring_actions`) could
 * otherwise place a real `.git/hooks/post-checkout`, `.github/workflows/*`,
 * or `.vscode/tasks.json` with zero human review before it runs on its
 * own. Deliberately a narrow, specific denylist (real, well-known auto-run
 * locations) rather than a broad heuristic -- this is defense against a
 * genuinely malicious/compromised manifest, not a judgment call about
 * "risky-looking" paths.
 */
const SENSITIVE_TARGET_PREFIXES = ['.git/', '.github/workflows/', '.vscode/', '.husky/'];

function isSensitiveTargetPath(root: string, resolvedPath: string): boolean {
  const relative = path.relative(root, resolvedPath).split(path.sep).join('/').toLowerCase();
  return SENSITIVE_TARGET_PREFIXES.some(
    (prefix) => relative === prefix.slice(0, -1) || relative.startsWith(prefix),
  );
}

/** One `wiring_action` resolved against a real project (`cwd`) -- purely
 * read-only detection, never a file mutation. `applicable` is whichever of
 * the action's own `whenAbsent`/`whenPresent` variants actually applies,
 * already picked so a caller (the sidecar command, Detail's UI) never has
 * to re-implement the "does whenPresent exist?" fallback logic itself. */
export interface ResolvedWiringAction {
  description: string;
  targetFile: string;
  targetFileExists: boolean;
  instructions: string;
  /** Absent exactly when the target file already exists AND the action
   * declared no `whenPresent` at all -- "this already exists, review before
   * touching it," with nothing safe to paste verbatim. Present in every
   * other case (a fresh file always has a `whenAbsent.snippet`; an existing
   * one might still offer a `whenPresent.snippet` for merge guidance). */
  snippet?: string;
  /** True when the target file already exists AND its real current content
   * matches `whenAbsent.snippet` exactly (trimmed) -- i.e. this is exactly
   * what a fresh auto-wire would have produced, most commonly because it
   * WAS auto-wired already (or a real merge happened to land on the same
   * content). Found via direct user testing: "Merge with Claude" still
   * offered itself for a file that's already 100% correctly wired, only to
   * have Claude correctly notice there's nothing to change and refuse --
   * a wasted click and a wasted `claude` subprocess call for an outcome
   * this function already had enough information to know in advance.
   * Never set for a targetFileExists:false action (nothing to compare
   * against yet) or the two safety-refusal cases above (out-of-bounds /
   * sensitive path) -- those are never "already correct," they're refused. */
  alreadyWired?: boolean;
  /** True when `targetFile` assumes the `src/` convention (`adaptSrcDirPath`'s
   * own doc comment) and this project's real convention isn't yet
   * detectable -- neither a root `app/`/`pages/` nor a `src/app`/`src/pages`
   * exists to check against. `targetFile` is still the manifest's raw,
   * UNADAPTED value in this case (there's nothing more specific to show),
   * and `targetFileExists` is always `false` -- deciding WHERE it goes is
   * a real judgment call for a human (or the "Ask Claude where this goes"
   * flow) to resolve, never something to guess and auto-write. `snippet`
   * IS still populated here (from `whenAbsent`, same as the normal
   * absent-file case): whichever of the two conventions actually turns
   * out to be right, its parent directory (`app/` or `src/app`) is
   * PROVABLY absent right now too (that's the only way this branch is
   * ever reached at all -- see `adaptSrcDirPath`), so the target file
   * itself can't already exist under either interpretation either. */
  placementAmbiguous?: boolean;
}

/**
 * Resolves every Tier-2 `wiring_action` a manifest declares against the
 * REAL installing project (`cwd`) -- read-only, no file ever gets touched
 * here. `targetFile` is resolved against `cwd` itself (the project root),
 * the same convention `applyInstallParams`/`applyEnvExamplePlaceholders`
 * already use for `.env.local`/`.env.example` -- deliberately never
 * `install_target`/payload-relative, since these actions describe edits to
 * files that live at the CONSUMING project's own root/conventions
 * (`auth.ts`, `middleware.ts`), not inside the artifact's own installed
 * folder.
 *
 * This is the entire mechanism for Tier 2: detect what's there, hand back a
 * concrete, tailored suggestion. Nothing here ever writes a file or
 * attempts to merge/splice into existing source -- that's the person's own
 * job in their own editor, per the tier's own definition ("shown as a
 * diff; applied only on explicit confirmation" means a human applies it,
 * not that DeliveryOS generates and silently commits one).
 */
export function resolveWiringActions(
  wiringActions: WiringAction[],
  cwd: string,
): ResolvedWiringAction[] {
  return wiringActions.map((action) => {
    // Adapts a `src/`-assuming targetFile to whichever convention this
    // REAL project actually uses (adaptSrcDirPath's own doc comment) --
    // `undefined` means neither convention is detectable yet, a real
    // judgment call this function refuses to guess at.
    const effectiveTargetFile = adaptSrcDirPath(cwd, action.targetFile);
    if (effectiveTargetFile === undefined) {
      return {
        description: action.description,
        targetFile: action.targetFile,
        targetFileExists: false,
        placementAmbiguous: true,
        snippet: action.whenAbsent.snippet,
        instructions: `"${action.targetFile}" assumes a project layout (src/ vs. not) this project doesn't clearly have yet -- neither a root app/pages directory nor a src/app or src/pages one exists to check against. Use "Ask Claude where this goes" to resolve it, or place it yourself.`,
      };
    }

    const containedPath = resolveContainedTargetFile(cwd, effectiveTargetFile);

    if (!containedPath) {
      // A target_file that resolves outside cwd is never safe to touch,
      // read or write -- refused outright rather than even probing
      // whether it exists. Reported as "exists" so every downstream
      // consumer (applyDeterministicWiring included) treats it exactly
      // like a real existing file it must never overwrite, without
      // needing its own separate "unsafe path" case to remember.
      return {
        description: action.description,
        targetFile: effectiveTargetFile,
        targetFileExists: true,
        instructions: `"${effectiveTargetFile}" resolves outside this project and was refused for safety -- this artifact's manifest is misconfigured or untrustworthy; review it manually before doing anything with it.`,
      };
    }

    if (isSensitiveTargetPath(path.resolve(cwd), containedPath)) {
      // Same "report as existing, so nothing ever auto-writes it" refusal
      // as the out-of-bounds case above -- a git hook, CI workflow, or
      // editor auto-run task is a real place code can execute with zero
      // review, regardless of whether one happens to exist there yet.
      return {
        description: action.description,
        targetFile: effectiveTargetFile,
        targetFileExists: true,
        instructions: `"${effectiveTargetFile}" is inside a location that can run on its own (a git hook, CI workflow, or editor auto-run task) and was refused for safety -- review it manually before doing anything with it.`,
      };
    }

    const targetFileExists = fs.existsSync(containedPath);

    // Checked BEFORE picking whenPresent/whenAbsent below (and before the
    // "no whenPresent declared at all" case right after it) -- an action
    // with no `whenPresent.snippet` at all (like the real nextauth-credentials
    // auth.ts action) would otherwise always fall into "review before
    // touching it," even on a file that's already exactly correct.
    if (targetFileExists) {
      let currentContent: string | undefined;
      try {
        currentContent = fs.readFileSync(containedPath, 'utf-8');
      } catch {
        // Unreadable (permissions, a directory at that path, etc.) -- fall
        // through to the normal existing-file handling below rather than
        // silently treating an unreadable path as "already correct."
      }
      if (currentContent !== undefined && currentContent.trim() === action.whenAbsent.snippet.trim()) {
        return {
          description: action.description,
          targetFile: effectiveTargetFile,
          targetFileExists: true,
          alreadyWired: true,
          instructions: `"${effectiveTargetFile}" already matches exactly what this artifact would have written -- nothing to do here.`,
        };
      }
    }

    const variant = targetFileExists ? action.whenPresent : action.whenAbsent;

    if (!variant) {
      // Only reachable when targetFileExists is true and whenPresent was
      // never declared -- "this already exists, review before touching
      // it," with no snippet to offer at all.
      return {
        description: action.description,
        targetFile: effectiveTargetFile,
        targetFileExists,
        instructions: `"${effectiveTargetFile}" already exists -- review it before making any changes; this artifact expects to own this file.`,
      };
    }

    return {
      description: action.description,
      targetFile: effectiveTargetFile,
      targetFileExists,
      instructions: variant.instructions,
      snippet: variant.snippet,
    };
  });
}
