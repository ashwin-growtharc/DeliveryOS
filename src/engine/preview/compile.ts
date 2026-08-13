import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { previewCachePath } from '../paths';
import { VENDORED_REACT_RUNTIME_JS } from './vendoredReactRuntime.generated';
import { VENDORED_LIBRARIES_JS } from './vendoredLibraries.generated';
import { VENDORED_TAILWIND_PREFLIGHT_CSS } from './vendoredTailwindPreflight.generated';
import { extractPropsSchemas, findComponentFiles, PropSchemaEntry } from './docgen';

/**
 * Bump this string whenever a change anywhere in this file changes what
 * `compilePreviewHtml` actually PRODUCES for the same input source (a new
 * CSS/JS injection, a fixed measurement race, a new vendored library,
 * anything that changes the compiled HTML's behavior or content) --
 * `getOrCompilePreview`'s cache is keyed on this alongside
 * `(remoteName, id, version)` (see `previewCachePath`'s own doc comment
 * for the real, confirmed bug this exists to prevent: an already-pushed
 * artifact whose OWN version never changes stayed cached indefinitely,
 * invisible to every subsequent fix made here). No particular numbering
 * scheme required -- any distinct value invalidates every previously
 * cached preview across every remote/artifact/version in one move; a
 * short incrementing string is just the simplest thing that works.
 */
const PREVIEW_COMPILER_VERSION = '5';

/**
 * Real Tailwind CSS, generated at compile time from whatever utility
 * class names a component's own source actually uses -- found while
 * hand-testing Scan against a real project: a Tailwind-authored
 * component (left completely untouched, per
 * .claude/skills/ui-component-extractor/SKILL.md) rendered with correct
 * DOM structure but ZERO visual styling, since nothing in this pipeline
 * had ever generated CSS for those classes at all (confirmed: no
 * tailwind.config/postcss.config existed anywhere in this repo before
 * this function).
 *
 * Runs entirely server-side, in the sidecar process itself -- unlike
 * `VENDORED_LIBRARIES_JS` (a browser-side concern, since those libraries'
 * OWN code has to run inside the compiled preview's iframe),
 * `tailwindcss`/`postcss` never execute in the browser at all; they just
 * produce a plain CSS string here, which gets embedded as a `<style>`
 * tag like any other static content. This is also why no separate
 * "vendoring" generation script is needed the way React/framer-motion
 * needed one: `build-sidecar.mjs`'s own esbuild bundle already inlines
 * every real dependency of `sidecar.ts`'s import graph (nothing is
 * marked `external` there except esbuild itself, for its own unrelated
 * reason) -- `tailwindcss`/`postcss` are genuinely Node-side code, so
 * that same bundle step packages them in automatically.
 *
 * Uses Tailwind's own documented `content: [{ raw, extension }]` shape
 * (v3's JIT scanner) rather than a real file-glob `content` pattern --
 * this function already has every sibling file's text in hand (via
 * `findComponentFiles`, the same "every .tsx/.jsx file in this payload
 * directory" discovery `extractPropsSchemas` already uses) and there is
 * no on-disk config to point a glob at anyway for a component that was
 * never authored with Tailwind's own build tooling in mind. Deliberately
 * pinned to Tailwind v3 (not v4): v4's default content-detection scans
 * real files on disk (via `@source`), which doesn't fit "generate CSS for
 * this exact in-memory source text, no matter where it ends up living."
 *
 * `preflight` (Tailwind's own global reset -- `border: 0`, `margin: 0`,
 * removing default `<button>`/`<input>` chrome, etc.) is applied via
 * `VENDORED_TAILWIND_PREFLIGHT_CSS`, NOT Tailwind's own `preflight` core
 * plugin (explicitly disabled below): that plugin reads its own
 * package's `lib/css/preflight.css` off disk with a plain
 * `fs.readFileSync` at RUNTIME (confirmed by hand: this throws `ENOENT`
 * inside the packaged Node SEA sidecar, which has no node_modules/
 * tailwindcss directory anywhere near it -- the exact same class of
 * packaging problem this project already hit for esbuild's native binary
 * and React's own runtime). `VENDORED_TAILWIND_PREFLIGHT_CSS` is that
 * exact same file's content, embedded once at build time by
 * `scripts/generate-vendored-tailwind-preflight.mjs` -- same fix, same
 * reason. A real Tailwind-authored component's own classes assume this
 * reset already happened in its host app (e.g. a `<button>` with no
 * explicit `border` utility expects the browser's own default button
 * border to already be gone), so it's still applied, just not via
 * Tailwind's own runtime-file-reading mechanism.
 *
 * Never throws on a source file it can't read/parse in a way that would
 * fail the whole preview -- same "preview fails soft" principle as
 * `extractPropsSchemas`'s own degrade-to-`{}` on a bad sibling file,
 * applied here to "degrade to no extra CSS," never "degrade to no
 * preview at all."
 */
async function generateTailwindCss(resolveDir: string, previewEntryPath: string): Promise<string> {
  const files = [previewEntryPath, ...findComponentFiles(resolveDir, '')];
  const sourceTexts: string[] = [];
  for (const file of files) {
    try {
      sourceTexts.push(fs.readFileSync(file, 'utf-8'));
    } catch {
      // Same "one bad sibling file shouldn't erase everyone else's
      // styling" reasoning as extractPropsSchemas's own per-file catch.
    }
  }
  if (sourceTexts.length === 0) {
    return '';
  }

  try {
    const result = await postcss([
      tailwindcss({
        content: sourceTexts.map((raw) => ({ raw, extension: 'tsx' as const })),
        corePlugins: { preflight: false },
        // Real bug, found via a real screenshot: with no `darkMode` set,
        // Tailwind defaults to the `media` strategy -- every `dark:`
        // class a component writes (many do; it's a normal, correct
        // thing for a component to support) compiles to
        // `@media (prefers-color-scheme: dark) {...}`, which resolves
        // against the VIEWER's own OS/browser setting, not anything
        // DeliveryOS controls. Two real, observed symptoms from this:
        // (1) broken contrast -- a component's own `dark:bg-black/30`
        // translucent modal renders correctly-for-dark-mode, but the
        // preview frame around it (`.ui-component-preview-frame`,
        // `--surface-inset`) is a fixed light color that never itself
        // goes dark to match, so the composited result is neither this
        // project's real light UI nor a real dark one -- just broken.
        // (2) the background visibly changing while a preview is open,
        // with no user action -- `prefers-color-scheme` is a LIVE media
        // query; if the OS scheme changes (a scheduled light/dark
        // switch, for instance) while the iframe stays mounted, Tailwind
        // re-evaluates it automatically. `'class'` makes dark: variants
        // require an ancestor `.dark` element that this pipeline never
        // adds anywhere -- so every `dark:` class in every component
        // simply never activates, deterministically, matching this
        // project's own real design system (DESIGN_SYSTEM.md), which is
        // light-only with no dark variant at all. A real, later reason
        // to revisit this: if DeliveryOS's own app ever ships a dark
        // theme, previews should follow that explicit choice, not the
        // viewer's ambient OS setting either way.
        darkMode: 'class',
      }),
    ]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined });
    return VENDORED_TAILWIND_PREFLIGHT_CSS + '\n' + result.css;
  } catch {
    // A real Tailwind/PostCSS internal failure shouldn't take down an
    // otherwise-working preview -- same "styling is best-effort, the
    // component itself is not" principle as the per-file read above.
    return '';
  }
}

/**
 * Lets a component's own source use a real, portable `import { useState }
 * from 'react'` (or `'react-dom'`) for hooks, instead of reaching into
 * `window.__DeliveryOSReactRuntime.React` directly -- a real bug found via
 * DeliveryOS's own Phase 8 adoption test: several real, already-pushed
 * `ui-component` artifacts (`magic-container`, `decrypting-text`,
 * `orbiting-skills`, `search`) used the runtime-global form because a
 * normal `import` of 'react' wasn't resolvable here before this fix --
 * esbuild would try to resolve it from a real `node_modules` that doesn't
 * exist in this build context and fail the whole compile. That made those
 * components' payload source fundamentally non-portable: dropped into a
 * real consuming project, `window.__DeliveryOSReactRuntime` doesn't exist
 * and the component crashes immediately on import.
 *
 * The require shim (`VENDORED_LIBRARY_REQUIRE_SHIM_JS`, below) already
 * handles both specifiers (`if (specifier === 'react') return React;`) --
 * it was only ever unreachable for a component's OWN source because
 * neither name was in the `external` list passed to `esbuild.build()`.
 * Marking them external here, same mechanism as `VENDORED_LIBRARY_NAMES`,
 * makes a real `import { useState } from 'react'` in a component's own
 * source resolve to the exact same vendored runtime instance JSX itself
 * already uses (via `jsxFactory`, unaffected by this -- orthogonal
 * mechanisms, JSX syntax vs. an explicit hook import) -- so the preview
 * keeps working AND the component is genuinely portable outside DeliveryOS.
 */
const REACT_EXTERNAL_NAMES = ['react', 'react-dom'];

/**
 * The allow-listed third-party UI-kit libraries a component's own source
 * may import directly (left completely untouched, per
 * .claude/skills/ui-component-extractor/SKILL.md) and still compile --
 * everything else falls through to `createDirectorySandboxPlugin`'s
 * existing "resolves outside this component's own directory" rejection,
 * same as before this list existed. Marking exactly these specifiers
 * `external` (below) means esbuild never tries to resolve them from a
 * real node_modules at all (which wouldn't exist in the packaged
 * sidecar anyway) -- it instead compiles each into a `__require(name)`
 * call, satisfied at actual preview-render time by
 * `VENDORED_LIBRARY_REQUIRE_SHIM_JS`'s global `require` function, which
 * resolves it to whatever `VENDORED_LIBRARIES_JS[name]` assigned into
 * `window.__DeliveryOSVendoredLibs`. Kept as an explicit list here
 * (rather than `Object.keys(VENDORED_LIBRARIES_JS)`) so adding a new
 * library is a deliberate two-place change (here + the generation
 * script's own `LIBRARIES` array), not something that silently expands
 * just because the generated file happens to contain more entries.
 */
const VENDORED_LIBRARY_NAMES = [
  'framer-motion',
  'clsx',
  'tailwind-merge',
  'class-variance-authority',
  'lucide-react',
  '@radix-ui/react-slot',
  '@radix-ui/react-dialog',
  '@radix-ui/react-dropdown-menu',
  '@radix-ui/react-popover',
  '@radix-ui/react-select',
  '@radix-ui/react-tooltip',
  '@radix-ui/react-tabs',
  '@radix-ui/react-checkbox',
  '@radix-ui/react-switch',
  '@radix-ui/react-label',
  '@radix-ui/react-accordion',
  '@radix-ui/react-avatar',
  '@radix-ui/react-radio-group',
  '@radix-ui/react-separator',
  '@radix-ui/react-alert-dialog',
  '@radix-ui/react-toast',
];

/**
 * Defines the global `require` function that satisfies esbuild's
 * `__require(name)` fallback (its own documented behavior for an
 * `external`-marked specifier in an IIFE build -- there is no real
 * module system at runtime to satisfy it any other way). Embedded as its
 * own inline `<script>`, after `VENDORED_REACT_RUNTIME_JS` (so
 * `window.__DeliveryOSReactRuntime.React` already exists) but before
 * every vendored library's own script (each of which calls `require`
 * for 'react'/'react/jsx-runtime' at its own top-level module-eval time)
 * and the component bundle itself.
 *
 * `'react/jsx-runtime'` needs its own constructed shim, not just a
 * pass-through to React: confirmed empirically that framer-motion's own
 * real bundle references it directly (one of its internal helper
 * components is itself authored in JSX, compiled with the automatic
 * runtime) even though nothing in DeliveryOS's OWN compiler ever
 * generates that import -- `jsx`/`jsxs` here are the standard,
 * well-documented shim shape (a plain `React.createElement` call,
 * folding an explicit `key` argument back into `props` since
 * `createElement`'s own signature doesn't take one positionally the way
 * the automatic runtime's `jsx()` does).
 */
const VENDORED_LIBRARY_REQUIRE_SHIM_JS = `(function () {
  var React = window.__DeliveryOSReactRuntime.React;
  function jsx(type, props, key) {
    if (key !== undefined) {
      props = Object.assign({}, props, { key: key });
    }
    return React.createElement(type, props);
  }
  var jsxRuntime = { jsx: jsx, jsxs: jsx, Fragment: React.Fragment };
  window.__DeliveryOSVendoredLibs = window.__DeliveryOSVendoredLibs || {};
  window.require = function (specifier) {
    if (specifier === 'react') return React;
    if (specifier === 'react-dom') return window.__DeliveryOSReactRuntime.ReactDOM;
    if (specifier === 'react/jsx-runtime' || specifier === 'react/jsx-dev-runtime') return jsxRuntime;
    if (Object.prototype.hasOwnProperty.call(window.__DeliveryOSVendoredLibs, specifier)) {
      return window.__DeliveryOSVendoredLibs[specifier];
    }
    throw new Error('Cannot resolve "' + specifier + '" in a DeliveryOS preview');
  };
})();`;

export interface CompiledPreview {
  html: string;
  /** Every CSF-style named variant exported by preview.tsx, in source
   * declaration order (see `listVariantNames`) -- Phase C's variant tabs
   * are built directly from this list, driving the embedded harness's
   * `selectVariant` message (see `compileReactPreview`). Always `[]` for
   * the zero-build HTML adapter -- there's no variant concept for a
   * plain, already-complete HTML document. */
  variantNames: string[];
  /** Props-controls schema per component `displayName`, derived once at
   * compile time by `extractPropsSchemas` -- never re-derived on the
   * client. Always `{}` for the zero-build HTML adapter. */
  propsSchemas: Record<string, PropSchemaEntry[]>;
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
 * inlined. Renders the first variant by default, then hands control to
 * the parent DeliveryOS UI via `postMessage` (see the embedded harness
 * below) -- switching variants and editing props both happen against
 * this same already-loaded bundle, with no recompile and no further
 * sidecar round-trip (Phase C).
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
  // Imports the WHOLE preview module (`import * as PreviewModule`), not
  // just the first variant by name -- Phase C's harness needs to be able
  // to look up ANY variant by name at postMessage time, not only the one
  // rendered by default. This does NOT reintroduce the enumeration-order
  // bug `listVariantNames`'s own doc comment warns about: that bug is
  // specifically about `Object.keys()` iteration order on the bundled
  // namespace object, not indexed property access by an already-known
  // string key (`PreviewModule[variantName]`, below) -- don't "fix" this
  // back into a named import out of misplaced caution.
  //
  // React/createRoot come from the vendored runtime's global (assigned by
  // VENDORED_REACT_RUNTIME_JS, embedded ahead of this script in the
  // generated HTML below), not an ES import -- IIFE output has no module
  // system at runtime, so a real `import React from 'react'` (or marking
  // 'react' `external`, which for a non-esm output format just becomes a
  // `require(...)` call with nothing to satisfy it) can't work at all in
  // a browser context. `jsx: 'transform'` + a custom jsxFactory/
  // jsxFragment below makes every JSX call site in the COMPONENT's own
  // source (Button.tsx/preview.tsx) compile directly to
  // `window.__DeliveryOSReactRuntime.React.createElement(...)` calls --
  // pure textual substitution, no react-family import generated anywhere
  // in the output at all, avoiding this problem entirely rather than
  // working around it.
  //
  // Each CSF variant (`export const Primary = () => <Button .../>`) is a
  // zero-arg function that returns a React element wrapping a SPECIFIC,
  // already-instantiated set of props -- it does not itself accept props,
  // so re-rendering `React.createElement(Primary, editedProps)` would
  // silently ignore whatever props were edited. The harness below instead
  // CALLS the variant function directly (a plain JS call, not through
  // React) to get its real element, then reads `.type` (the actual
  // component, e.g. Button) and `.props` (that variant's literal starting
  // values) straight off it -- documented, stable React object shape, not
  // an implementation detail. This is the mechanism that makes prop
  // editing possible at all under the existing CSF authoring convention,
  // not an optional embellishment. It relies on variant functions staying
  // simple, synchronous, side-effect-free JSX factories with no hooks --
  // the same shape every existing variant already has.
  //
  // Origin validation: a `srcdoc` iframe's `event.origin` is the opaque
  // literal string `"null"` for every such iframe on the page (every grid
  // card AND the Detail view's interactive one), so it cannot discriminate
  // between them -- only `event.source` (a reference check) is sound.
  // Inside the harness, `event.source === window.parent` is always safe
  // regardless of how many other `srcdoc` iframes exist elsewhere in the
  // parent document.
  const harness = `
    import * as PreviewModule from './${entryBasename}';

    const { React, createRoot } = window.__DeliveryOSReactRuntime;
    const container = document.getElementById('root')!;
    const root = createRoot(container);

    let currentType: any = null;

    // A pushed component's own bug (throwing during render, or during the
    // variant function call below) must not leave the iframe silently
    // blank forever with no signal at all -- every failure path here
    // reports {type:'error'} back to the parent, same "preview fails
    // soft, but never SILENTLY" principle the rest of this feature
    // follows for a preview.compile RPC failure.
    function renderElement(type: any, props: any) {
      try {
        currentType = type;
        root.render(React.createElement(type, props));
      } catch (err: any) {
        window.parent.postMessage({ type: 'error', message: String(err?.message ?? err) }, '*');
      }
    }

    function selectVariant(variantName: string) {
      const variantFn = PreviewModule[variantName];
      if (typeof variantFn !== 'function') return;
      let element: any;
      try {
        // Called directly, NOT rendered via React -- see this function's
        // own doc comment above for why a zero-arg CSF variant has to be
        // called to read its real component + starting props off the
        // returned element, rather than wrapped as a component. A
        // pushed/less-trusted variant function could throw here.
        element = variantFn();
      } catch (err: any) {
        window.parent.postMessage(
          { type: 'error', variant: variantName, message: String(err?.message ?? err) },
          '*',
        );
        return;
      }
      if (!element || !element.type) {
        // A variant is legally allowed to return null (a real React
        // pattern) -- there's just nothing controllable to show for it.
        window.parent.postMessage(
          { type: 'error', variant: variantName, message: 'Variant returned no element' },
          '*',
        );
        return;
      }
      const componentName = element.type.displayName || element.type.name || variantName;
      renderElement(element.type, element.props);
      window.parent.postMessage(
        { type: 'variantChanged', variant: variantName, componentName, initialProps: element.props },
        '*',
      );
    }

    window.addEventListener('message', (event) => {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'selectVariant') {
        selectVariant(data.variant);
      } else if (data.type === 'setProps' && currentType) {
        renderElement(currentType, data.props);
      } else if (data.type === 'setTheme') {
        // Real toggle mechanism (Phase 11 Detail-view task), currently
        // inert for every design-kit component: darkMode:'class' already
        // compiles real dark: utilities against a .dark ancestor, but no
        // current component uses dark: classes at all (DESIGN_SYSTEM.md is
        // light-only by design). Sets colorScheme on BOTH html and body --
        // the hardcoded "color-scheme: light" rule below targets them
        // together with no !important, so an override on html alone
        // wouldn't beat body's own explicit rule.
        document.documentElement.classList.toggle('dark', data.theme === 'dark');
        document.documentElement.style.colorScheme = data.theme;
        document.body.style.colorScheme = data.theme;
      }
    });

    window.parent.postMessage({ type: 'ready' }, '*');
    selectVariant('${firstVariantName}');
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
    // Lets a component's own untouched `import { motion } from
    // 'framer-motion'` (etc.) compile at all -- see VENDORED_LIBRARY_NAMES
    // and VENDORED_LIBRARY_REQUIRE_SHIM_JS's own doc comments for the full
    // mechanism. `REACT_EXTERNAL_NAMES` (own doc comment above) does the
    // same for a real `import { useState } from 'react'`. Anything NOT in
    // this list still hits createDirectorySandboxPlugin's existing
    // rejection exactly as before.
    external: [...REACT_EXTERNAL_NAMES, ...VENDORED_LIBRARY_NAMES],
    minify: true,
    // esbuild's minifier renames top-level identifiers, which changes a
    // function's own runtime `.name` -- since the harness above reports
    // `element.type.name` back to the parent to look up that component's
    // docgen-derived props schema, a minified name (e.g. "e" instead of
    // "Button") would silently break that lookup. `keepNames` is
    // esbuild's own documented escape hatch for exactly this class of
    // problem; cheap, and doesn't touch the jsxFactory/jsxFragment config.
    keepNames: true,
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
  const safeRequireShimJs = escapeForScriptTag(VENDORED_LIBRARY_REQUIRE_SHIM_JS);
  // Every vendored library is embedded unconditionally, whether or not
  // THIS particular component actually imports it -- detecting real
  // per-component usage would mean re-parsing import specifiers just to
  // decide which scripts to include, for a modest (tens of KB, all local
  // to this one srcdoc iframe, never sent over a real network) size
  // saving. Simple and correct beats a premature optimization here.
  const safeVendoredLibrariesJs = Object.values(VENDORED_LIBRARIES_JS)
    .map((js) => escapeForScriptTag(js))
    .join('\n');

  // Real Tailwind CSS, generated from this component's own actual class
  // usage -- see generateTailwindCss's own doc comment for the full
  // rationale. Escaped the same way (and for the same reason) as the
  // inlined JS above -- cheap defensive consistency, not because
  // Tailwind's own generated output would ever plausibly contain this
  // sequence.
  const tailwindCss = await generateTailwindCss(resolveDir, previewEntryPath);
  const safeTailwindCss = tailwindCss.replace(/<\/style/gi, '<\\/style');

  // Deliberately NO "min-height: 100vh" on #root below (Phase B's
  // original rule, removed in Phase C) -- this whole HTML string is
  // embedded verbatim into the shipped preview, so any explanation lived
  // here as a CSS comment would ship to every compiled artifact for no
  // reason; the real explanation belongs here, in a TS comment, instead.
  // The parent measures document.body.scrollHeight to size
  // the iframe to this content's REAL height (see
  // injectContentHeightReporter below) -- 100vh is 100% of the iframe's
  // OWN current height, a circular reference that anchors the
  // measurement to whatever height the iframe already happens to have,
  // not the content's actual natural size. display:flex + centering
  // still helps a single small element (e.g. one Button variant) sit
  // centered rather than pinned top-left, without inflating height.
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  /* overflow: hidden here is deliberate, not a default -- see
     injectContentHeightReporter's own doc comment for the full research
     behind this. The parent applies the iframe's box size ASYNCHRONOUSLY
     (postMessage -> rAF-coalesced resize), so there is always a brief
     window -- mid-animation, or a hover state that grows the content --
     where the real content genuinely exceeds whatever box the parent has
     applied SO FAR. Without this rule, html/body (the iframe's own root
     scrolling element) shows a real native scrollbar the instant that
     happens, which then disappears again once the parent catches up --
     exactly the flashing scroller this rule exists to prevent. This does
     NOT affect measurement accuracy: document.body.scrollWidth/scrollHeight
     (read by injectContentHeightReporter below) report the content's real,
     full size regardless of whether overflow is hidden or visible -- only
     whether a scrollbar/clip is shown changes, never what gets measured.

     body padding was tried and reverted here (real bug, found via a real
     screenshot, then a WORSE real bug found reverting it): a Button
     variant's onMouseEnter lift (translateY(-1px), an ordinary hover
     micro-interaction) clipped its own border against body's edge with
     zero padding, so 4px of real body padding was added to absorb it --
     included in document.body.scrollHeight on purpose, so the measured
     size the parent applies back stayed honest (see
     injectContentHeightReporter). That was the bug. Any component whose
     own layout is anchored to the iframe's OWN current viewport size
     (min-h-screen / min-height: 100vh -- an entirely ordinary Tailwind
     pattern for a full-page mockup, confirmed against a real pushed
     component) re-reads that viewport size again on the VERY NEXT
     resize round, once the parent applies whatever height got measured.
     Padding that's included in the measurement adds a fixed amount ON
     TOP of that self-reference EVERY round, not once -- confirmed by
     hand, instrumenting the real reporter: reported height climbed
     472 -> 480 -> 488 -> 496..., +8 (the padding, both sides) every
     single round, ratcheting all the way to clampPreviewHeight's MAX
     ceiling for a component whose real card content is under 350px
     tall. Without the padding, the exact same component's height
     converges immediately and stays put, confirmed by hand the same
     way. There is no padding amount, however small, that's genuinely
     safe here: ANY constant included in the measurement compounds for
     ANY component using this ordinary, common pattern -- which is a
     structural property of the async measure-then-apply protocol
     itself (see injectContentHeightReporter's own doc comment on why
     100vh can't be pinned inside DeliveryOS's OWN #root either, for the
     identical reason), not something a bigger or smaller padding value
     fixes. Reverted to zero. The Button hover-lift clip this padding
     fixed is real but narrow (cosmetic, one variant, one micro-
     interaction) against a regression that broke every full-page-style
     pushed component -- the correct trade to make until a fix exists
     that doesn't feed anything back into the measurement loop at all. */
  html, body { margin: 0; padding: 0; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color-scheme: light; }
  #root { display: flex; align-items: center; justify-content: center; }
</style>
<style>${safeTailwindCss}</style>
</head>
<body>
<div id="root"></div>
<script>${safeVendoredRuntimeJs}</script>
<script>${safeRequireShimJs}</script>
<script>${safeVendoredLibrariesJs}</script>
<script>${safeBundledJs}</script>
</body>
</html>`;

  // Docgen runs against the ORIGINAL, unbundled `.tsx` source via the real
  // TypeScript compiler (see docgen.ts) -- a completely separate pass from
  // esbuild's own compile above, which never type-checks at all. The
  // schema never enters the bundle/iframe; it's returned here purely for
  // the parent DeliveryOS UI to build control widgets from, matched at
  // runtime against whatever `componentName` the harness's
  // `variantChanged` message reports.
  const propsSchemas = extractPropsSchemas(resolveDir, previewEntryPath);

  return { html, variantNames, propsSchemas };
}

/**
 * The zero-build adapter for plain HTML/CSS/JS (or pre-compiled Web
 * Component) artifacts -- no esbuild call at all, matching
 * docs/ui-components-feature-design.md §4's "cast a wide net
 * structurally, filter semantically" design: the preview file for one of
 * these IS the complete, already-self-contained document, exactly as the
 * artifact author wrote it. This is the "free" fast path the design doc
 * calls out; it exists specifically so a non-React, non-Vue submission
 * doesn't pay for a compile step it has no use for. `variantNames`/
 * `propsSchemas` are always empty -- there's no CSF variant concept or
 * docgen-able component for an already-complete HTML document; the parent
 * UI treats an empty `variantNames` as "no tabs/controls to show."
 */
function compileHtmlPreview(previewEntryPath: string): CompiledPreview {
  return { html: fs.readFileSync(previewEntryPath, 'utf-8'), variantNames: [], propsSchemas: {} };
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
  const compiled = previewEntryPath.endsWith('.html')
    ? compileHtmlPreview(previewEntryPath)
    : await compileReactPreview(previewEntryPath);
  const html = injectContentHeightReporter(injectPreviewCsp(compiled.html));
  return { ...compiled, html };
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
 * Reports the compiled preview's own real content box back to the parent
 * via `postMessage` (`{type:'contentHeight', width, height}`) -- the
 * parent can't just read `iframe.contentDocument.body.scrollHeight`
 * itself, since `sandbox="allow-scripts"` deliberately omits
 * `allow-same-origin` (the frame's opaque origin is the whole point of
 * the sandbox), so cross-origin access to the iframe's DOM throws. This
 * is the same "measure yourself, report over postMessage" pattern
 * embeddable-iframe tools (CodeSandbox, CodePen) use for exactly this
 * reason. (The message `type` stays `'contentHeight'` even though it now
 * also carries `width` -- it's the same "here is my real size" report
 * the parent has always listened for, not a new protocol message.)
 *
 * Deliberately adapter-agnostic (wired into `compilePreviewHtml`'s
 * dispatcher, not duplicated inside `compileReactPreview`'s own harness)
 * -- measuring the content doesn't care whether it came from the React
 * adapter or the zero-build HTML one; both need their real size known by
 * the parent so preview cards can size to their actual content instead
 * of a uniform fixed box.
 *
 * Measures `document.body`, NOT `document.documentElement` -- confirmed
 * by hand (a real, small standalone preview reported 735 for
 * `documentElement.scrollHeight` vs. an actual content height of 24):
 * `<html>` is the document's root scrolling element, and its
 * `scrollHeight`/`scrollWidth` are spec'd to never read smaller than the
 * viewport, even when the real content is far shorter/narrower. That
 * floor silently broke every SMALL component (a lone Badge, a couple of
 * Buttons) -- their frame would inherit whatever the iframe's ambient
 * viewport-ish size happened to be, not their genuine tiny size, leaving
 * exactly the "blank space inside the card" bug this was meant to fix in
 * the first place (first found for height; the same floor applies to
 * `scrollWidth` for the same reason, which is why a component narrower
 * than the frame -- e.g. a fixed-width themed box -- left dead space on
 * both sides once only height was made dynamic). `document.body` has no
 * such floor on either axis.
 *
 * A `ResizeObserver` (not a one-shot measurement) re-reports on every
 * subsequent layout change too -- necessary for anything animated (e.g.
 * an orbiting/hover-expanding layout) whose real size isn't known until
 * well after initial mount. Critically, it has to actually observe the
 * REAL rendered element for this to work -- see `reportSize`'s own
 * `observedWidthTarget` handling below for a real, confirmed bug where it
 * didn't (silently watching `document.body` forever instead, so any
 * later change that didn't also move body's own shrink-wrapped height
 * went unreported).
 *
 * Width is measured differently than height, for a real reason: a block
 * element's default WIDTH fills its containing block (`width: auto`
 * means "as wide as the parent," not "as wide as my content"), while its
 * default HEIGHT shrink-wraps to content -- the two axes are not
 * symmetric in CSS. `document.body` therefore always reports its own
 * (parent-filling) width regardless of how narrow the actual rendered
 * content is, which is exactly correct for height but silently wrong for
 * width: confirmed by hand against a real compiled preview whose visible
 * content (a themed, fixed-width text box) was genuinely narrower than
 * the frame, yet `document.body.scrollWidth` still reported the full
 * frame width, reintroducing the same "dead space either side of the
 * card" bug this measurement exists to prevent -- just on the
 * horizontal axis instead of vertical. The React adapter's harness
 * always mounts into `#root` (see `compileReactPreview`) as its one and
 * only child, and that child -- an ordinary flex ITEM inside #root's
 * `display: flex` row, with no `flex-grow` set -- genuinely shrinks to
 * its own content width rather than stretching, so measuring THAT
 * element (falling back to `document.body` when `#root` isn't present
 * or doesn't have exactly one child -- the zero-build HTML adapter has
 * no such guarantee at all) gives the real width instead of the
 * viewport-filling one.
 *
 * Reading that element's plain `scrollWidth` directly (the first version
 * of this fix) turned out to be a real, confirmed bug of its own: ANY
 * content that can wrap (running text, a flex-wrap row of buttons) only
 * wraps as much as whatever width it's CURRENTLY been given, so its
 * scrollWidth reflects that current width, not an independent "true"
 * one. Since the parent then applies whatever width gets reported as
 * this element's NEXT width, a width even slightly narrower than the
 * content's real unwrapped width causes one extra wrap -- which makes
 * the widest remaining line (and therefore the next scrollWidth
 * reading) narrower still -- which the parent then applies as an even
 * smaller width next time. That is a genuine, unstable feedback loop,
 * not just an occasional rounding error: confirmed by hand against a
 * real compiled preview, where it ran all the way down to one character
 * per line with a scrollbar, not just a slightly-too-narrow box.
 *
 * `measureIntrinsicWidth` breaks that loop structurally rather than
 * damping it: forcing `width: max-content` asks the browser for this
 * element's width if it never had to wrap at all, which by definition
 * does not depend on whatever width it currently happens to have --
 * measuring it 100 times in a row against the same content always
 * returns the same number, however many times the parent has resized
 * the iframe in between. Measured against a detached CLONE of the real
 * element (see `measurementSandbox` below), not the real element itself
 * -- see that variable's own doc comment for why mutating the real
 * element directly (this function's first version) was its own separate,
 * real, confirmed bug. (A component whose own top-level element relies
 * on `width: 100%` to fill its container -- e.g. a full-bleed animated
 * hero with only absolutely-positioned children, which contribute
 * nothing to a max-content calculation -- still measures sanely:
 * max-content on THAT element resolves from its own normal-flow
 * children's intrinsic sizes, same as it would for any other block
 * element.)
 *
 * `reportSize` also refuses to post a (0, 0) measurement at all -- a
 * distinct, confirmed bug from the wrapping one above, and just as
 * serious: this function's own immediate call, and its `load` listener,
 * can both fire before React's initial commit has actually landed
 * (`createRoot().render()` schedules work asynchronously; finishing the
 * bundle's `<script>` does not mean anything has painted yet), so
 * `document.body` can genuinely still be empty. Reporting (0, 0) in
 * that case let the parent apply it as the iframe's own literal CSS
 * size -- and once an iframe's real rendering surface is squeezed to
 * zero, layout inside it comes back corrupted even moments later, once
 * React DOES mount and a real, correct measurement is taken (observed by
 * hand: a real 587x97 reading immediately followed by a nonsensical
 * 79x1015 on the very next report, permanently, not a transient blip).
 * See `reportSize`'s own early-return for the fix and full rationale.
 *
 * **Why the iframe's own html/body get `overflow: hidden`** (see the
 * hardcoded reset `<style>` in `compileReactPreview`, not this function):
 * resizing is inherently asynchronous -- a size change happens inside the
 * iframe first, gets measured and posted here, then the PARENT applies a
 * new box size on its own next animation frame. Any component whose size
 * changes at runtime (a framer-motion transition, a hover state) will
 * therefore always have at least one brief moment where its real content
 * is larger than whatever box the parent has applied so far. Without
 * `overflow: hidden`, that moment shows a real native scrollbar on the
 * iframe's own document (a genuinely separate browsing context, with its
 * own root scrolling element, independent of anything the parent page
 * does) -- confirmed by hand as the exact cause of a real "scrollbar
 * flashes every time something changes size" report. `overflow: hidden`
 * doesn't change what gets measured here (`scrollWidth`/`scrollHeight`
 * report the content's real, full size regardless of whether it's being
 * clipped or scrolled -- only whether a scrollbar/clip is VISIBLE
 * changes), so this is a pure display fix with no measurement impact.
 *
 * **A separate, non-fixable limitation** (found via web research into
 * how iframe-resize libraries and the CSS Working Group treat this): a
 * hover-triggered element that needs to visually extend beyond a
 * component's normal box (a tooltip, a dropdown menu) can never actually
 * paint outside this iframe's own allocated box in the parent page, no
 * matter what CSS is applied on either side of the boundary. Since
 * Chrome 108, the user-agent stylesheet forces `overflow: clip` on
 * `iframe`/`embed`/`object` elements specifically to stop embedded
 * content from visually escaping its box and occluding the embedding
 * page -- see
 * https://developer.chrome.com/blog/overflow-replaced-elements and the
 * CSSWG discussion at https://github.com/w3ctag/design-reviews/issues/750
 * (Firefox has long clipped iframes the same way, for the same
 * isolation reason). There is no CSS trick or resize-timing fix on
 * either side of this boundary that changes that -- it's a deliberate
 * browser security/isolation boundary, not a bug. The only real
 * mitigation (used by comparable tools like Storybook's own preview
 * iframe) is generous, non-tightly-fit sizing for anything with known
 * hover/expansion behavior, not trying to let the expansion escape.
 */
function injectContentHeightReporter(html: string): string {
  const script = `<script>(function () {
    function widthMeasureTarget() {
      var root = document.getElementById('root');
      if (root && root.children.length === 1) {
        return root.children[0];
      }
      return document.body;
    }
    // A dedicated, permanent, never-observed measurement sandbox, attached
    // to <html> rather than <body> -- deliberately NOT a descendant of
    // anything the ResizeObserver below watches (document.body, or
    // widthMeasureTarget()'s real element). measureIntrinsicWidth clones
    // the real element INTO this container to measure it, rather than
    // mutating the real element's own style directly (the previous
    // version of this function) -- mutating an element the observer is
    // actively watching, even synchronously reverted before returning,
    // is a real, confirmed source of corruption: the real running app
    // (WebView2, not the Chromium build used to develop/verify this fix)
    // showed the exact old wrapping-collapse symptom (one character per
    // line) return AFTER this file's own ResizeObserver re-subscription
    // fix -- i.e. wiring the observer to watch the real element directly
    // (correct, and necessary for the "different every refresh" fix) is
    // exactly what put that same element back in the observer's own
    // measurement path, and WebView2 evidently does not handle
    // self-mutation-during-callback as gracefully as the Chromium build
    // this was checked against. A detached clone removes the entire
    // hazard category regardless of any given engine's specific
    // ResizeObserver loop-detection heuristics -- nothing the observer
    // watches is ever touched by measurement.
    var measurementSandbox = document.createElement('div');
    measurementSandbox.style.position = 'fixed';
    measurementSandbox.style.top = '0';
    measurementSandbox.style.left = '0';
    measurementSandbox.style.visibility = 'hidden';
    measurementSandbox.style.pointerEvents = 'none';
    document.documentElement.appendChild(measurementSandbox);

    function measureIntrinsicWidth(el) {
      var clone = el.cloneNode(true);
      clone.style.width = 'max-content';
      clone.style.maxWidth = 'none';
      measurementSandbox.appendChild(clone);
      var width = clone.scrollWidth;
      measurementSandbox.removeChild(clone);
      return width;
    }
    var observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reportSize) : null;
    // The element widthMeasureTarget() resolves to at the moment THIS
    // function last (re)wired the observer -- not the same thing as
    // "whatever it would resolve to right now." Tracked so reportSize can
    // tell when the real element has appeared (or changed) and needs to
    // be subscribed to directly, instead of only ever watching
    // document.body.
    var observedWidthTarget = null;
    function reportSize() {
      var target = widthMeasureTarget();
      // A confirmed real bug, distinct from the (0,0) one below: this
      // function's FIRST call (below, and via 'load') runs before
      // widthMeasureTarget() has anything real to return, so it falls
      // back to document.body -- and until now, the SECOND .observe()
      // call (setup time, once, see below) resolved widthMeasureTarget()
      // at that same too-early moment, meaning it ALSO returned
      // document.body and just re-subscribed to the same element the
      // first .observe() call already covered. The real rendered
      // element was never actually being watched for its OWN future size
      // changes -- only document.body's box re-triggered a re-measure,
      // and document.body's own height can easily stay constant across a
      // real content change (a width-only reflow; text re-rendering at
      // the same line count) that has nothing to do with height at all.
      // Confirmed by hand: reloading the same decrypting-text preview
      // repeatedly reported different widths (587 vs. 572 across two
      // otherwise-identical loads) -- whichever render happened to be
      // live at the single moment document.body's height first changed
      // got measured and then frozen, and that moment's exact timing
      // (React's commit scheduling vs. the observer's own notification
      // timing) varies run to run. Re-observing whichever element THIS
      // call actually measured -- upgrading from document.body to the
      // real element the moment it exists, and idempotent once they're
      // the same element already -- means the real element stays
      // subscribed to its own future changes from then on, not just
      // riding along on document.body's.
      if (observer && target !== observedWidthTarget) {
        if (observedWidthTarget) {
          observer.unobserve(observedWidthTarget);
        }
        observer.observe(target);
        observedWidthTarget = target;
      }
      var width = Math.ceil(measureIntrinsicWidth(target));
      var height = Math.ceil(document.body.scrollHeight);
      // Both this function's own immediate call below AND the 'load'
      // listener can fire before React's initial commit has actually
      // landed (createRoot().render() schedules work asynchronously --
      // it does not paint synchronously just because the bundle's
      // <script> finished executing), which means #root can still be
      // genuinely empty at this point. A confirmed real bug: reporting
      // (0, 0) in that case let the parent apply it as the iframe's own
      // literal CSS width/height (0px) -- and once an iframe's actual
      // rendering surface is squeezed to zero, layout inside it comes
      // back corrupted even moments later once React DOES mount and a
      // real, correct measurement is taken (observed by hand: a real
      // measurement of 587x97 immediately followed by a nonsensical
      // 79x1015 on the very next report, and it stayed wrong from then
      // on). Skipping the report entirely here -- rather than reporting
      // 0 and letting the parent's own clamping floor absorb it -- means
      // the iframe is simply never resized away from its CSS loading-
      // state default until there is real content to size it to; the
      // ResizeObserver below re-fires reportSize() the moment React's
      // commit actually lands, same as it does for any later layout
      // change. Either axis reading exactly 0 (not just both at once) is
      // treated the same way -- a genuinely tiny real component still
      // clamps to clampPreviewWidth/Height's floor downstream, so there's
      // no real case where a legitimate measurement needs to be exactly 0
      // on just one axis.
      // Real bug, found via a real screenshot (a component using
      // min-h-screen ballooning to the MAX clamp instead of its real
      // size): body's own 4px-per-side padding (added for the hover-clip
      // fix above) means an UNMOUNTED #root -- genuinely empty, zero real
      // content -- no longer measures as exactly (0, 0). It measures as
      // (8, 8): the padding alone, with nothing inside it yet. The
      // width === 0 || height === 0 check below exists SPECIFICALLY to
      // catch this pre-mount moment (see its own comment) and was written
      // back when zero really was the only signal -- padding quietly
      // moved the goalposts, and every report from here on now starts
      // from that premature (8, 8) instead of skipping it, which is
      // exactly the "squeeze now, corrupt later" failure mode that
      // comment documents by hand, just arrived at via a small nonzero
      // measurement instead of a zero one. Checking #root's own child
      // count directly -- not a pixel measurement at all -- is the
      // precise version of "has this actually mounted yet," immune to
      // whatever body padding happens to be. Only applies when #root
      // exists at all (the React adapter's own mount target); the
      // zero-build HTML adapter has no #root and no async mount to wait
      // for, so it only ever needed the width/height checks below.
      var root = document.getElementById('root');
      if (root && root.children.length === 0) {
        return;
      }
      if (width === 0 || height === 0) {
        return;
      }
      window.parent.postMessage({ type: 'contentHeight', width: width, height: height }, '*');
    }
    if (observer) {
      observer.observe(document.body);
    }
    // The precise pre-mount check above (root.children.length === 0)
    // correctly skips the two premature calls below (immediate + 'load'
    // -- both real, both still legitimately too early), but nothing
    // ELSE re-triggers reportSize() once React actually commits UNLESS
    // that commit also happens to change document.body's own SIZE --
    // true in every real browser tested by hand, but not guaranteed in
    // general, and not true at all in a test environment with no
    // ResizeObserver (confirmed: the exact reason this needed adding --
    // without it, a correct "skip until mounted" check has nothing left
    // to wake it back up). Observing #root's own childList directly
    // catches the real mount moment itself, immediately, independent of
    // whether it happens to also change any element's size.
    var root = document.getElementById('root');
    if (root && typeof MutationObserver !== 'undefined') {
      new MutationObserver(reportSize).observe(root, { childList: true });
    }
    window.addEventListener('load', reportSize);
    reportSize();
  })();<\/script>`;

  const bodyCloseIndex = html.lastIndexOf('</body>');
  if (bodyCloseIndex !== -1) {
    return html.slice(0, bodyCloseIndex) + script + html.slice(bodyCloseIndex);
  }
  return html + script;
}

/**
 * Cache-aware wrapper around `compilePreviewHtml`, keyed by
 * `(remoteName, id, version)` via `previewCachePath` -- a cache hit never
 * touches esbuild (or docgen) at all. Deliberately a thin wrapper around
 * the pure `compilePreviewHtml` rather than folding caching into it
 * directly, so that function stays simply testable ("given a file,
 * produce a CompiledPreview") and this one owns exactly one additional
 * concern (read-through caching). Caches the ENTIRE `CompiledPreview`
 * object as JSON (html + variantNames + propsSchemas), not just the raw
 * HTML string -- Phase C's variant/props-schema data has to survive a
 * cache hit too, or every request after the first compile would silently
 * lose variant tabs and controls. The compiled cache entry is a derived
 * build artifact, never pushed or pulled (see `previewCachePath`'s own
 * doc comment) -- a version bump naturally invalidates it by changing the
 * cache key, nothing is ever explicitly deleted.
 */
export async function getOrCompilePreview(
  remoteName: string,
  id: string,
  version: string,
  previewEntryPath: string,
): Promise<CompiledPreview> {
  const cachePath = previewCachePath(remoteName, id, version, PREVIEW_COMPILER_VERSION);
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as CompiledPreview;
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
    fs.writeFileSync(tmpPath, JSON.stringify(compiled), 'utf-8');
    fs.renameSync(tmpPath, cachePath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
  return compiled;
}
