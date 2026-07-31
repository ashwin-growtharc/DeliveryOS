import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { previewCachePath } from '../paths';
import { VENDORED_REACT_RUNTIME_JS } from './vendoredReactRuntime.generated';
import { extractPropsSchemas, PropSchemaEntry } from './docgen';

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
  html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  #root { display: flex; align-items: center; justify-content: center; }
</style>
</head>
<body>
<div id="root"></div>
<script>${safeVendoredRuntimeJs}</script>
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
      if (width === 0 || height === 0) {
        return;
      }
      window.parent.postMessage({ type: 'contentHeight', width: width, height: height }, '*');
    }
    if (observer) {
      observer.observe(document.body);
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
  const cachePath = previewCachePath(remoteName, id, version);
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
