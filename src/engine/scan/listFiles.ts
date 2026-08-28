import * as fs from 'fs';
import * as path from 'path';

/**
 * Recursively walks `dir`, skipping `node_modules` and any dotfile/dot-
 * directory (`.git`, `.env`, etc.) at any depth, returning the full path
 * of every file whose basename matches `pattern`. Shared by every scan
 * detector that needs "every real source file in this payload" --
 * previously copy-pasted near-verbatim (with only the pattern differing)
 * across `detectInstallParams.ts`, `detectStacks.ts`,
 * `detectArtifactMetadata.ts`, and `suggestMetadata.ts`; consolidated
 * here so the node_modules/dotfile-skip logic only needs to be right in
 * one place.
 */
export function listFilesRecursively(dir: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listFilesRecursively(fullPath, pattern));
    } else if (pattern.test(entry.name)) {
      found.push(fullPath);
    }
  }
  return found;
}
