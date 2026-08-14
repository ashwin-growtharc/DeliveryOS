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
 * findPreviewEntryFile's PREVIEW_FILENAMES already establishes).
 */
const EXCLUDED_FILENAMES = new Set(['preview.tsx', 'preview.jsx', 'preview.html']);

export interface PullPayloadComponentResult {
  destDir: string;
  copiedFiles: string[];
}

export function pullPayloadComponent(
  remoteName: string,
  id: string,
  relativeDir: string,
  destDir: string,
): PullPayloadComponentResult {
  const payloadDir = resolvePayloadDir(remoteName, id);
  const componentDir = resolveWithinPayloadDir(payloadDir, relativeDir);

  const entries = fs.readdirSync(componentDir, { withFileTypes: true });
  const copiedFiles: string[] = [];

  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of entries) {
    if (!entry.isFile() || EXCLUDED_FILENAMES.has(entry.name)) continue;
    fs.copyFileSync(path.join(componentDir, entry.name), path.join(destDir, entry.name));
    copiedFiles.push(entry.name);
  }

  return { destDir, copiedFiles };
}
