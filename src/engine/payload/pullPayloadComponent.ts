import * as fs from 'fs';
import * as path from 'path';
import { resolvePayloadDir, resolveWithinPayloadDir } from './payloadDir';

/**
 * A component in a design-kit-shaped bundle isn't tracked as its own
 * artifact -- there's no manifest/install_target/lockfile entry for
 * "just Header." Pulling one is a lighter, standalone copy: the
 * component's own source file(s) land wherever the person picks (a real
 * native folder dialog, driven from the app), with no lockfile write and
 * no pristine snapshot -- those exist to let a WHOLE artifact's future
 * pull/push diff against what was last pulled, which doesn't apply here.
 *
 * `preview.tsx`/`preview.jsx`/`preview.html` are deliberately excluded --
 * dev/preview-only scaffolding for this app's own live-preview compiler,
 * never meant to ship into a consuming project (same convention
 * findPreviewEntryFile's PREVIEW_FILENAMES already establishes). Excluded
 * by basename at ANY depth, not just the component's own top-level dir --
 * a component with a nested assets subdirectory could in principle carry
 * its own preview fixture alongside real assets.
 */
const EXCLUDED_FILENAMES = new Set(['preview.tsx', 'preview.jsx', 'preview.html']);

export class PullPayloadComponentConflictError extends Error {
  constructor(public readonly conflictingFiles: string[]) {
    super(
      `Refusing to overwrite existing file(s) in the chosen folder: ${conflictingFiles.join(', ')}. `
        + 'Choose an empty or different folder, or remove those files first.',
    );
    this.name = 'PullPayloadComponentConflictError';
  }
}

export interface PullPayloadComponentResult {
  destDir: string;
  copiedFiles: string[];
}

/** Recursively lists every real (non-excluded) file inside `dir`, as
 * paths relative to `dir` -- includes nested subdirectories (found by
 * review: the previous non-recursive version silently dropped anything
 * inside a component's own subdirectory with no error/warning at all). */
function listRealFiles(dir: string, relativeTo: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listRealFiles(absolute, relativeTo));
    } else if (entry.isFile() && !EXCLUDED_FILENAMES.has(entry.name)) {
      results.push(path.relative(relativeTo, absolute));
    }
  }
  return results;
}

export function pullPayloadComponent(
  remoteName: string,
  id: string,
  relativeDir: string,
  destDir: string,
): PullPayloadComponentResult {
  const payloadDir = resolvePayloadDir(remoteName, id);
  const componentDir = resolveWithinPayloadDir(payloadDir, relativeDir);

  const relativeFiles = listRealFiles(componentDir, componentDir);

  // Checked BEFORE any file is written -- a re-pull into a folder that
  // already has same-named file(s) used to silently clobber them with no
  // warning (found by review). Fails loud and clear instead, matching
  // this codebase's existing "artifact/manifest problems fail hard and
  // loud" rule (compile.ts's directory-sandboxing errors are the same
  // posture) rather than a partial, half-overwritten copy.
  const conflicts = relativeFiles.filter((relativeFile) => fs.existsSync(path.join(destDir, relativeFile)));
  if (conflicts.length > 0) {
    throw new PullPayloadComponentConflictError(conflicts);
  }

  for (const relativeFile of relativeFiles) {
    const destFile = path.join(destDir, relativeFile);
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.copyFileSync(path.join(componentDir, relativeFile), destFile);
  }

  return { destDir, copiedFiles: relativeFiles };
}
