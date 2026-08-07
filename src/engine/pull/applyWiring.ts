import * as fs from 'fs';
import * as path from 'path';
import { ResolvedWiringAction } from './wiring';

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
 * fragment would destroy the rest of it. This is a NEW, separate,
 * explicitly-opt-in mechanism (Phase 10 item 1) -- it does not change
 * `pullArtifact`'s own default behavior, which stays exactly as Phase 7
 * left it (Tier 2 never auto-applied unless a caller explicitly asks for
 * this).
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

    const fullPath = path.resolve(cwd, action.targetFile);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, action.snippet, 'utf-8');
    applied.push(action.targetFile);
  }

  return { applied, needsReview };
}
