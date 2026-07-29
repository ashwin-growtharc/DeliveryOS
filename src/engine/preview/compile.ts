import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { previewCachePath } from '../paths';
import { VENDORED_REACT_RUNTIME_JS } from './vendoredReactRuntime.generated';

export interface CompiledPreview {
  html: string;
}

/**
 * An esbuild plugin rejecting any resolved file outside `rootDir` --
 * Phase A shipped with no sandboxing on relative-import resolution at all
 * (a component or its preview.tsx could `import '../../../whatever'` and
 * esbuild would happily inline it); this closes that gap now that Phase B
 * actually routes real, less-trusted pushed content through this
 * function. Checked in `onLoad` (which fires with the fully-resolved
 * absolute path already known), not `onResolve` (which would require
 * reimplementing esbuild's own specifier resolution just to inspect it) --
 * scoped to the `file` namespace only, so it never touches the synthetic
 * `stdin` entry point or `external` specifiers (react/react-dom never
 * reach `onLoad` at all once marked external). Returning a non-empty
 * `errors` array here fails the whole `esbuild.build()` call, matching
 * this codebase's "artifact/manifest problems fail hard and loud" rule
 * (see docs/ui-components-feature-design.md §11's recurring principle).
 */
function createDirectorySandboxPlugin(rootDir: string): esbuild.Plugin {
  const root = path.resolve(rootDir);
  return {
    name: 'artifact-directory-sandbox',
    setup(build) {
      build.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
        const resolved = path.resolve(args.path);
        if (resolved !== root && !resolved.startsWith(root + path.sep)) {
          return {
            errors: [
              {
                text: `Import resolves outside this component's own directory (${root}): ${resolved}`,
              },
            ],
          };
        }
        return null;
      });
    },
  };
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
 * Phase A shipped with two documented gaps, both fixed here in Phase B:
 * - **React/ReactDOM are now genuinely vendored, not resolved from
 *   node_modules.** The component's own build below uses a classic JSX
 *   transform with a custom `jsxFactory`/`jsxFragment` pointing at
 *   `window.__DeliveryOSReactRuntime` (never `jsx: 'automatic'`, which
 *   would generate a real `import ... from 'react/jsx-runtime'` --
 *   something an IIFE build has no module system to satisfy at all, not
 *   just something to route around with `external`). The generated HTML
 *   embeds `VENDORED_REACT_RUNTIME_JS` (a browser-safe IIFE bundled once,
 *   ahead of time, by `scripts/generate-vendored-react-runtime.mjs` --
 *   see that script's own header for why React 19 needs this rather than
 *   a prebuilt UMD file) as a separate inline `<script>` before the
 *   component's own bundle, assigning that global. Works identically for
 *   a real pulled artifact in an arbitrary project folder and inside the
 *   packaged, no-`node_modules` sidecar, since the runtime is embedded as
 *   a plain string constant compiled directly into the sidecar bundle --
 *   no runtime file resolution needed at all, same lesson Phase A already
 *   learned for the esbuild binary itself.
 * - **Import resolution is now sandboxed** to the artifact's own
 *   directory -- see `createDirectorySandboxPlugin` above.
 *
 * This is the React/TypeScript compiler adapter -- see `compilePreviewHtml`
 * for the dispatcher that picks between this and the zero-build plain-HTML
 * adapter based on the preview entry file's extension.
 */
async function compileReactPreview(previewEntryPath: string): Promise<CompiledPreview> {
  const resolveDir = path.dirname(previewEntryPath);
  const entryBasename = path.basename(previewEntryPath).replace(/\.[jt]sx?$/, '');
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
  // variant. React/createRoot come from the vendored runtime's global
  // (assigned by VENDORED_REACT_RUNTIME_JS, embedded ahead of this script
  // in the generated HTML below), not an ES import -- IIFE output has no
  // module system at runtime, so a real `import React from 'react'` (or
  // marking 'react' `external`, which for a non-esm output format just
  // becomes a `require(...)` call with nothing to satisfy it) can't work
  // at all in a browser context. `jsx: 'transform'` + a custom
  // jsxFactory/jsxFragment below makes every JSX call site in the
  // COMPONENT's own source (Button.tsx/preview.tsx) compile directly to
  // `window.__DeliveryOSReactRuntime.React.createElement(...)` calls --
  // pure textual substitution, no react-family import generated anywhere
  // in the output at all, avoiding this problem entirely rather than
  // working around it.
  const harness = `
    import { ${firstVariantName} as FirstVariant } from './${entryBasename}';

    const { React, createRoot } = window.__DeliveryOSReactRuntime;
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
    jsx: 'transform',
    jsxFactory: 'window.__DeliveryOSReactRuntime.React.createElement',
    jsxFragment: 'window.__DeliveryOSReactRuntime.React.Fragment',
    minify: true,
    plugins: [createDirectorySandboxPlugin(resolveDir)],
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
  // Applied to the vendored runtime too, for the same reason, even though
  // it's DeliveryOS's own trusted code, not pushed content -- consistent
  // practice is cheap here.
  const escapeForScriptTag = (js: string) => js.replace(/<\/script/gi, '<\\/script');
  const safeBundledJs = escapeForScriptTag(bundledJs);
  const safeVendoredRuntimeJs = escapeForScriptTag(VENDORED_REACT_RUNTIME_JS);

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
<script>${safeVendoredRuntimeJs}</script>
<script>${safeBundledJs}</script>
</body>
</html>`;

  return { html };
}

/**
 * The zero-build adapter for plain HTML/CSS/JS (or pre-compiled Web
 * Component) artifacts -- no esbuild call at all, matching
 * docs/ui-components-feature-design.md §4's "cast a wide net
 * structurally, filter semantically" design: the preview file for one of
 * these IS the complete, already-self-contained document, exactly as the
 * artifact author wrote it. This is the "free" fast path the design doc
 * calls out; it exists specifically so a non-React, non-Vue submission
 * doesn't pay for a compile step it has no use for.
 */
function compileHtmlPreview(previewEntryPath: string): CompiledPreview {
  return { html: fs.readFileSync(previewEntryPath, 'utf-8') };
}

/**
 * Compiler-adapter dispatcher: picks between the React/TypeScript adapter
 * and the zero-build plain-HTML adapter based on the preview entry file's
 * own extension -- the one thing every future adapter (Vue, Svelte, ...)
 * will plug into the same way, per docs/ui-components-feature-design.md
 * §4.2's "pluggable compiler-adapter interface" design. This is the
 * function every other module should import; `compileReactPreview` and
 * `compileHtmlPreview` are adapter internals, not part of the public
 * surface.
 */
export async function compilePreviewHtml(previewEntryPath: string): Promise<CompiledPreview> {
  const { html } = previewEntryPath.endsWith('.html')
    ? compileHtmlPreview(previewEntryPath)
    : await compileReactPreview(previewEntryPath);
  return { html: injectPreviewCsp(html) };
}

/**
 * A strict inline CSP, injected into every adapter's output uniformly
 * (here, not duplicated per-adapter) -- docs/ui-components-feature-design.md
 * §8 calls this out as a non-negotiable requirement alongside the sandbox
 * attribute itself: `sandbox="allow-scripts"` (no `allow-same-origin`)
 * gives the frame an opaque origin, which blocks it from reading the
 * parent's cookies/localStorage/DOM, but does NOT block outbound network
 * calls on its own -- a pushed component's own script could otherwise
 * still `fetch()`/`<img src>`/open a WebSocket to any third-party origin.
 * `default-src 'none'` closes that; `'unsafe-inline'` script/style is
 * still needed since the whole point is running the inlined bundle this
 * function just produced. Injected as a `<meta>` tag (response headers
 * aren't available for a `srcdoc` document) right after the first
 * `<head>` tag found; if none exists (a minimal/malformed HTML preview),
 * prepended before the whole document instead.
 */
function injectPreviewCsp(html: string): string {
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;";
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const insertAt = headMatch.index + headMatch[0].length;
    return html.slice(0, insertAt) + metaTag + html.slice(insertAt);
  }
  return metaTag + html;
}

/**
 * Cache-aware wrapper around `compilePreviewHtml`, keyed by
 * `(remoteName, id, version)` via `previewCachePath` -- a cache hit never
 * touches esbuild at all. Deliberately a thin wrapper around the pure
 * `compilePreviewHtml` rather than folding caching into it directly, so
 * that function stays simply testable ("given a file, produce HTML") and
 * this one owns exactly one additional concern (read-through caching).
 * The compiled cache entry is a derived build artifact, never pushed or
 * pulled (see `previewCachePath`'s own doc comment) -- a version bump
 * naturally invalidates it by changing the cache key, nothing is ever
 * explicitly deleted.
 */
export async function getOrCompilePreview(
  remoteName: string,
  id: string,
  version: string,
  previewEntryPath: string,
): Promise<CompiledPreview> {
  const cachePath = previewCachePath(remoteName, id, version);
  if (fs.existsSync(cachePath)) {
    return { html: fs.readFileSync(cachePath, 'utf-8') };
  }

  const compiled = await compilePreviewHtml(previewEntryPath);
  const cacheDir = path.dirname(cachePath);
  fs.mkdirSync(cacheDir, { recursive: true });
  // Write-then-rename, not a direct writeFileSync onto cachePath: a
  // concurrent reader (fs.existsSync + readFileSync above, possibly from a
  // second sidecar call racing this one) could otherwise observe a
  // partially-written file. A same-directory rename is atomic on both
  // POSIX and Windows, so a reader always sees either nothing or the
  // complete file, never a torn write.
  const tmpPath = path.join(cacheDir, `.${path.basename(cachePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, compiled.html, 'utf-8');
    fs.renameSync(tmpPath, cachePath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
  return compiled;
}
