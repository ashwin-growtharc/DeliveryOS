import * as fs from 'fs';
import * as path from 'path';
import { WiringAction } from '../manifest/schema';

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
    const containedPath = resolveContainedTargetFile(cwd, action.targetFile);

    if (!containedPath) {
      // A target_file that resolves outside cwd is never safe to touch,
      // read or write -- refused outright rather than even probing
      // whether it exists. Reported as "exists" so every downstream
      // consumer (applyDeterministicWiring included) treats it exactly
      // like a real existing file it must never overwrite, without
      // needing its own separate "unsafe path" case to remember.
      return {
        description: action.description,
        targetFile: action.targetFile,
        targetFileExists: true,
        instructions: `"${action.targetFile}" resolves outside this project and was refused for safety -- this artifact's manifest is misconfigured or untrustworthy; review it manually before doing anything with it.`,
      };
    }

    const targetFileExists = fs.existsSync(containedPath);
    const variant = targetFileExists ? action.whenPresent : action.whenAbsent;

    if (!variant) {
      // Only reachable when targetFileExists is true and whenPresent was
      // never declared -- "this already exists, review before touching
      // it," with no snippet to offer at all.
      return {
        description: action.description,
        targetFile: action.targetFile,
        targetFileExists,
        instructions: `"${action.targetFile}" already exists -- review it before making any changes; this artifact expects to own this file.`,
      };
    }

    return {
      description: action.description,
      targetFile: action.targetFile,
      targetFileExists,
      instructions: variant.instructions,
      snippet: variant.snippet,
    };
  });
}
