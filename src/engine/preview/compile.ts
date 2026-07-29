import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

export interface CompiledPreview {
  html: string;
}

/**
 * Names of every top-level named export in a preview.tsx file (`export
 * const Primary = ...`, `export function Secondary() {...}`), in source
 * declaration order. Deliberately a source-text regex, not a runtime
 * `Object.keys()` on the bundled module: esbuild's bundler does not
 * preserve source order in the namespace object it generates for `import *
 * as x` -- confirmed empirically during the Phase A spike, where
 * `Object.keys()` came back alphabetized (`Disabled` before `Primary`)
 * instead of in file order, silently rendering the wrong variant as
 * "first." Reused as-is by Phase C's variant tab/dropdown ordering, not
 * just this file's own "pick the first one" need.
 */
export function listVariantNames(previewSourcePath: string): string[] {
  const source = fs.readFileSync(previewSourcePath, 'utf-8');
  const names: string[] = [];
  // Known limitation, not a real parse: matches `export const`/`export
  // function`/`export async function` only (no `export default`, no
  // `export { A, B }` re-export lists), and could false-positive on the
  // same text appearing inside a comment or string literal. A false
  // positive fails loudly at esbuild's own "no matching export" build
  // error rather than silently mis-rendering, so the specific bug class
  // this function exists to prevent stays guarded either way -- worth a
  // real parse once Phase C's variant UI depends on this more heavily.
  const pattern = /export\s+(?:const|(?:async\s+)?function)\s+([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    names.push(match[1]);
  }
  return names;
}

/**
 * Compiles a component's preview.tsx (a CSF-style demo file exporting one or
 * more named variants -- see docs/ui-components-feature-design.md §5) into a
 * single self-contained HTML document: an inlined JS bundle (the component,
 * the preview file, a small mount harness, and the vendored React/ReactDOM
 * runtime, all bundled together) plus a minimal CSS reset. No external
 * module resolution happens once this HTML is handed to the sandboxed
 * iframe it eventually renders into -- everything it needs is already
 * inlined. Renders whichever variant is exported first; switching between
 * variants is Phase C's controls-panel concern, not this function's.
 *
 * Uses native `esbuild` (not `esbuild-wasm`): the WASM build's only Node
 * code path hardcodes spawning a separate `node` binary on PATH, which
 * cannot survive the sidecar's Node SEA packaging (no Node install or
 * node_modules exists on an end user's machine for that spawn to find).
 * Native esbuild's `ESBUILD_BINARY_PATH` env var is the documented escape
 * hatch for exactly that packaged-unusually scenario -- see
 * docs/phase-A-preview-packaging-spike.md.
 *
 * KNOWN LIMITATIONS, deliberately out of scope for this Phase A spike (not
 * silently forgotten -- see docs/phase-A-preview-packaging-spike.md for the
 * full list and why each is deferred, not fixed here):
 * - React/ReactDOM are resolved via ordinary node_modules lookup (`import
 *   'react'` from the generated harness, resolved by walking up from
 *   `resolveDir`), NOT actually vendored/bundled with the app the way
 *   docs/ui-components-feature-design.md §4.2 calls for. Works today only
 *   because the test fixture happens to sit inside this monorepo, where
 *   node_modules/react genuinely exists -- will NOT work for a real pulled
 *   artifact in an arbitrary project folder, nor in the packaged app (no
 *   node_modules next to the SEA-packaged sidecar). Real fix is Phase B's.
 * - No sandboxing on relative-import resolution -- a component or its
 *   preview.tsx can `import` anything reachable via relative path traversal
 *   (`../../../whatever`) and esbuild will inline it. Fine while this only
 *   ever compiles a hardcoded fixture; must be constrained to the
 *   artifact's own directory before any genuinely untrusted pushed content
 *   reaches this function (Phase D onward).
 */
export async function compilePreviewHtml(previewEntryPath: string): Promise<CompiledPreview> {
  const resolveDir = path.dirname(previewEntryPath);
  const entryBasename = path.basename(previewEntryPath).replace(/\.tsx?$/, '');
  // Both names get spliced directly into generated source below (the
  // harness's import specifier and its named-import binding) -- constrained
  // to a safe identifier/filename shape first so a maliciously- or
  // accidentally-named file/export can't break out of that generated
  // source and inject arbitrary code into the harness. Harmless today
  // (Phase A only feeds this a hardcoded fixture path), but this function
  // accepts an arbitrary caller-supplied path and will eventually see
  // pushed, less-trusted artifact content.
  if (!/^[\w.-]+$/.test(entryBasename)) {
    throw new Error(`Unsafe preview entry filename: "${entryBasename}"`);
  }

  const variantNames = listVariantNames(previewEntryPath);
  if (variantNames.length === 0) {
    throw new Error(`No exported variants found in ${previewEntryPath} (expected at least one "export const X = () => <.../>").`);
  }
  const firstVariantName = variantNames[0];

  // A synthetic entry point, not a file on disk -- esbuild's `stdin` input
  // lets this import the real preview file by a normal relative specifier,
  // resolved against `resolveDir` exactly as if this were a real sibling
  // file. Keeps the actual pushed preview.tsx untouched; DeliveryOS never
  // needs to rewrite an artifact's own source to make it previewable.
  //
  // Imports the first variant BY ITS ACTUAL NAME (a named import), not via
  // `import * as preview` + object-key indexing -- see listVariantNames's
  // own doc comment for why that alternative silently picks the wrong
  // variant.
  const harness = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { ${firstVariantName} as FirstVariant } from './${entryBasename}';

    const container = document.getElementById('root')!;
    createRoot(container).render(React.createElement(FirstVariant));
  `;

  const result = await esbuild.build({
    stdin: {
      contents: harness,
      resolveDir,
      loader: 'tsx',
      sourcefile: 'harness.tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    minify: true,
  });

  // Native esbuild's `build()` starts a long-lived native service process on
  // first call and keeps it running for reuse across calls -- appropriate
  // for a long-lived process making many builds, but this sidecar is
  // spawned fresh and killed per call (see src-tauri/src/lib.rs's own doc
  // comment), so there's no "next call" to reuse it for. Without this, the
  // native esbuild.exe child would be left to whatever implicit cleanup
  // happens when the sidecar's own stdio pipes close, rather than being
  // told to exit explicitly.
  await esbuild.stop();

  const bundledJs = result.outputFiles[0].text;
  // Escapes the one substring that can prematurely close the <script>
  // element it's about to be inlined into -- any component/preview whose
  // rendered or literal string content contains "</script" would otherwise
  // spill arbitrary content into the surrounding document once parsed.
  const safeBundledJs = bundledJs.replace(/<\/script/gi, '<\\/script');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  #root { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
</style>
</head>
<body>
<div id="root"></div>
<script>${safeBundledJs}</script>
</body>
</html>`;

  return { html };
}
