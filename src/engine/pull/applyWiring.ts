import * as fs from 'fs';
import * as path from 'path';
import { ResolvedWiringAction, resolveContainedTargetFile } from './wiring';

/** What `applyDeterministicWiring` actually did against a real project.
 * `applied` are target files it safely wrote for real; `needsReview` are
 * ones it deliberately left untouched. */
export interface AppliedWiringResult {
  applied: string[];
  needsReview: string[];
}

/**
 * Applies exactly the Tier-2 `wiring_actions` that are genuinely safe to
 * write automatically -- a fresh file (`targetFileExists === false`),
 * where the manifest-declared `whenAbsent.snippet` IS the complete,
 * verbatim new file content (the schema itself requires `whenAbsent` to
 * declare a snippet, precisely because a nonexistent file has nothing to
 * conflict with). Everything else (`targetFileExists === true`) is left
 * completely alone, even when a `whenPresent.snippet` exists -- that
 * snippet is merge GUIDANCE for a person to apply by hand (e.g. "wrap
 * {children} in <SessionProvider>"), not the file's own full content;
 * blindly overwriting a real, already-existing file with just that
 * fragment would destroy the rest of it. A separate mechanism from
 * `pullArtifact` itself (Phase 10 item 1) -- that function's own behavior
 * (Tier 2 never auto-applied) is unchanged; this is what both the app's
 * Pull button and, as of Phase 18, the CLI's default `deliveryos pull`
 * call on top of it (see `pullAndAutoWire.ts`).
 */
export function applyDeterministicWiring(
  resolved: ResolvedWiringAction[],
  cwd: string,
): AppliedWiringResult {
  const applied: string[] = [];
  const needsReview: string[] = [];

  for (const action of resolved) {
    if (action.targetFileExists) {
      needsReview.push(action.targetFile);
      continue;
    }

    // targetFileExists === false implies this resolved from whenAbsent,
    // which the schema requires to declare a snippet -- but guard anyway
    // rather than assume, since a missing snippet here has nothing safe
    // to write.
    if (!action.snippet) {
      needsReview.push(action.targetFile);
      continue;
    }

    // Defense in depth, not the only guard: `resolveWiringActions` already
    // refuses a target_file that escapes `cwd` by reporting it as
    // "exists" (routing it to needsReview above before this line is ever
    // reached), but this is the actual filesystem-write call -- it
    // re-validates containment itself rather than trusting that every
    // `ResolvedWiringAction` it's ever handed necessarily went through
    // that upstream check. A manifest's target_file is untrusted input
    // (see resolveContainedTargetFile's own doc comment); a real test
    // confirmed `../../../../evil.txt` genuinely resolves outside a
    // project root.
    const fullPath = resolveContainedTargetFile(cwd, action.targetFile);
    if (!fullPath) {
      needsReview.push(action.targetFile);
      continue;
    }

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, action.snippet, 'utf-8');
    applied.push(action.targetFile);
  }

  return { applied, needsReview };
}
