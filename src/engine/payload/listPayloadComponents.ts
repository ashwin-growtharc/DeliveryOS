import * as fs from 'fs';
import * as path from 'path';
import { resolvePayloadDir, resolveWithinPayloadDir } from './payloadDir';
import { findPreviewEntryFile } from '../preview/resolveArtifactPreview';

export interface PayloadComponent {
  name: string;
  /** Payload-relative dir (forward-slash, e.g. "components/Button" or
   * "components/forms/Input") -- fed straight back into
   * `resolveWithinPayloadDir`/`preview.compilePayloadComponent`. */
  relativeDir: string;
}

const COMPONENTS_DIRNAME = 'components';

/**
 * Lists every real, preview-having component in an already-materialized
 * (pushed) design-kit-shaped payload's `components/` directory -- distinct
 * from `detectUiComponents.ts`'s flat-vs-folder logic, which discovers NEW
 * candidates in a live project rather than listing what's already there in
 * a finished payload. Returns `[]`, never throws, if the artifact has no
 * `components/` directory at all (most artifacts aren't design-kit-shaped).
 */
export function listArtifactPayloadComponents(remoteName: string, id: string): PayloadComponent[] {
  const payloadDir = resolvePayloadDir(remoteName, id);
  const componentsDir = resolveWithinPayloadDir(payloadDir, COMPONENTS_DIRNAME);
  if (!fs.existsSync(componentsDir) || !fs.statSync(componentsDir).isDirectory()) {
    return [];
  }

  const results: PayloadComponent[] = [];
  walkComponentsDir(payloadDir, componentsDir, 0, results);
  return results;
}

/**
 * Recurses exactly one bounded extra level: `GUIDELINES.md`'s own
 * documented rule allows a category folder (e.g. `components/forms/Input`)
 * once 3+ related components exist, so a directory with no preview file of
 * its own is checked one level deeper before being skipped entirely --
 * never unbounded, so this can't wander into an unrelated deeply-nested
 * payload.
 */
function walkComponentsDir(
  payloadDir: string,
  dir: string,
  depth: number,
  results: PayloadComponent[],
): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const entry of entries) {
    const entryDir = path.join(dir, entry.name);
    try {
      findPreviewEntryFile(entryDir);
      results.push({
        name: entry.name,
        relativeDir: path.relative(payloadDir, entryDir).split(path.sep).join('/'),
      });
    } catch {
      // No preview file directly in this directory -- per GUIDELINES.md's
      // own category-folder rule, check one level deeper before giving up
      // on it (fails soft either way, matching this feature's convention
      // everywhere else: a malformed/unrelated subfolder is skipped, never
      // thrown).
      if (depth === 0) {
        walkComponentsDir(payloadDir, entryDir, depth + 1, results);
      }
    }
  }
}
