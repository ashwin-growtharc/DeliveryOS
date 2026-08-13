import * as fs from 'fs';
import * as path from 'path';
import { resolveArtifact } from '../pull/pull';
import { resolvePayloadDir } from '../payload/payloadDir';
import { getOrCompilePreview, compilePreviewHtml, CompiledPreview } from './compile';

/** Conventional preview entry filenames, checked in this priority order
 * inside an artifact's own payload folder (React/TS before the zero-build
 * HTML fast path, matching compilePreviewHtml's own dispatch order). */
const PREVIEW_FILENAMES = ['preview.tsx', 'preview.jsx', 'preview.html'];

/** Locates a pushed artifact's preview entry file by convention. Throws a
 * clear error if none of the conventional filenames exist -- e.g. this
 * was called against a non-`ui-component` artifact, or one whose author
 * forgot the preview file entirely (Scan auto-scaffolds one for
 * Scan-discovered candidates -- see docs/ui-components-feature-design.md
 * §6 -- but a manually-proposed artifact has no such safety net). */
export function findPreviewEntryFile(payloadDir: string): string {
  for (const filename of PREVIEW_FILENAMES) {
    const candidate = path.join(payloadDir, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `No preview entry file found in ${payloadDir} (expected one of: ${PREVIEW_FILENAMES.join(', ')}).`,
  );
}

/**
 * Resolves and compiles (with caching) the live preview for a pushed
 * artifact, given just its `(remote, id)` -- reads directly from the
 * remote's own cloned cache (the same source `buildCatalog()` reads),
 * no pull required. This is what lets someone see a UI component's live
 * preview while just browsing the catalog, before ever deciding to pull
 * it -- the whole point of this feature per
 * docs/ui-components-feature-design.md §1.
 */
export async function compileArtifactPreview(remoteName: string, id: string): Promise<CompiledPreview> {
  const { manifest } = resolveArtifact(id, remoteName);
  const payloadDir = resolvePayloadDir(remoteName, id);
  const previewEntryPath = findPreviewEntryFile(payloadDir);
  return getOrCompilePreview(remoteName, id, manifest.version, previewEntryPath);
}

/**
 * Compiles the live preview for a UI-component candidate that has NOT been
 * pushed yet -- a Scan-discovered candidate sitting in a local
 * `payloadPath` (a real project folder, or a synthetic staged directory
 * for a flat-convention component; see `detectUiComponentCandidates`),
 * shown in Add New's Review step before the user has decided to propose
 * it at all.
 *
 * Deliberately calls `compilePreviewHtml` directly, NOT `getOrCompilePreview`
 * (the function `compileArtifactPreview` above uses): that cache is keyed
 * on `(remoteName, id, version)`, none of which exist yet for something
 * that's never been pushed -- there is no remote entry, no manifest, and
 * therefore no version to key a cache on, or to invalidate later once one
 * finally exists. Recompiling on every call is the right tradeoff here:
 * this is a one-off, on-demand preview for a single Review step, not a
 * catalog entry someone might view repeatedly across many sessions the
 * way `compileArtifactPreview`'s result is.
 */
export async function compileLocalPreview(payloadDir: string): Promise<CompiledPreview> {
  const previewEntryPath = findPreviewEntryFile(payloadDir);
  return compilePreviewHtml(previewEntryPath);
}
