#!/usr/bin/env node
// Generates src/engine/preview/vendoredLibraries.generated.ts -- one
// browser-safe IIFE per allow-listed third-party UI-kit library, each
// embedded as a plain string constant, mirroring
// generate-vendored-react-runtime.mjs's own pattern exactly (same
// packaged-sidecar-has-no-node_modules problem, same "bundle it once,
// ship the string" fix).
//
// Why this exists: a real-world pasted component (from v0, 21st.dev,
// shadcn, Aceternity, etc.) very often imports one of a small handful of
// near-ubiquitous UI-kit dependencies -- framer-motion for animation,
// clsx/tailwind-merge/class-variance-authority for conditional class
// names. compile.ts's preview compiler deliberately leaves these imports
// untouched in a component's own source (see
// .claude/skills/ui-component-extractor/SKILL.md) rather than asking
// every ingested component to route around them -- so the compiler has
// to actually be able to resolve them instead.
//
// Each library here is bundled with react/react-dom/react's jsx-runtime
// marked `external` -- they must NOT bring in their own copy of React;
// they need to share the exact same instance already vendored via
// generate-vendored-react-runtime.mjs, or hooks/context would silently
// break (two separate React module instances never share internal
// dispatcher state). `external` on an IIFE build compiles an external
// import to a `__require("react")` call (esbuild's own documented
// fallback for this shape); compile.ts's `VENDORED_LIBRARY_REQUIRE_SHIM`
// defines the actual global `require` function that satisfies it at
// preview-render time, resolving 'react' to the already-vendored
// instance and any of THESE libraries' own names to whatever this script
// assigns into `window.__DeliveryOSVendoredLibs`.
//
// Run this whenever a pinned vendored-library version changes
// (package.json). Wired as an npm "pregenerate" step alongside the React
// runtime generator; see package.json's "build" script.

import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const outFile = path.join(repoRoot, 'src', 'engine', 'preview', 'vendoredLibraries.generated.ts');

// The allow-list itself -- deliberately short (see SKILL.md's own "start
// small, extend the same mechanism later" reasoning). Adding a library
// here is the ONLY place that needs to change to support a new one; see
// this same list's twin in compile.ts's `VENDORED_LIBRARY_NAMES`
// (kept as a separate, explicit const there rather than imported from
// here, since this script's output is a generated data file, not a
// module compile.ts should take on a real import dependency on).
// `lucide-react` is the one real size outlier here (~716 KB minified,
// bundling all of its icon components -- vs. ~185 KB for framer-motion,
// the next largest) -- found while ingesting a real pasted component that
// used exactly one icon out of it. Bundled whole anyway, matching this
// list's existing "embed unconditionally, whether or not THIS component
// uses it" simplicity (see compile.ts's own doc comment on that
// tradeoff): a real per-component tree-shaken bundle (only the icons an
// individual component actually imports) would need a SEPARATE esbuild
// pass at PREVIEW-COMPILE time, not a one-time build-time generation step
// like every other entry here -- a real, larger architecture change,
// worth doing if this list's total size ever becomes a genuine problem,
// not attempted here.
//
// The `@radix-ui/react-*` entries are a starter set of the primitives
// shadcn/ui-derived pasted components reach for most often (Dialog,
// Dropdown Menu, Popover, Select, Tooltip, Tabs, Checkbox, Switch,
// Label, Accordion, Avatar, Radio Group, Separator, Alert Dialog, Toast,
// plus Slot -- which underlies almost every shadcn component's `asChild`
// prop). Each is its own separate npm package (Radix doesn't ship one
// combined bundle), so each gets its own entry/IIFE here, each bundled
// under its own real package name -- a component importing any one of
// them needs no workaround, exactly like the rest of this list. Unlike
// lucide-react, these are individually small (Radix's own modular
// design), so adding this whole set is a modest, not a size-outlier,
// addition. Any Radix primitive NOT on this list (Menubar, Navigation
// Menu, Scroll Area, Slider, Toggle, Toggle Group, Context Menu, Hover
// Card, Progress, ...) is left unvendored on purpose -- add it here if a
// real ingested component needs it repeatedly, matching this list's
// established "start small, extend reactively" pattern.
const LIBRARIES = [
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

async function bundleLibrary(name) {
  // `Object.assign({ __esModule: true }, Lib)` -- not just `= Lib` --
  // because the CONSUMING component bundle (compileReactPreview, a
  // SEPARATE esbuild invocation) marks this same library `external` too,
  // which compiles its `import clsx from 'clsx'` into
  // `__toESM(__require('clsx'))`. esbuild's `__toESM` helper only skips
  // re-wrapping a `.default` around the whole module object when the
  // object already carries `__esModule: true` -- without this marker,
  // confirmed by hand to produce `c.default` being the ENTIRE namespace
  // object (not the real function), so `(0, c.default)(...)` throws
  // "is not a function" for any library with a default export (clsx,
  // tailwind-merge). `Object.assign` (not a plain property set) also
  // flattens Lib's own getter-backed export properties into concrete
  // values on a fresh, ordinarily-extensible object, so adding this one
  // extra marker key can't collide with esbuild's own non-configurable
  // per-export property descriptors.
  const shim = `
    import * as Lib from ${JSON.stringify(name)};
    window.__DeliveryOSVendoredLibs = window.__DeliveryOSVendoredLibs || {};
    window.__DeliveryOSVendoredLibs[${JSON.stringify(name)}] = Object.assign({ __esModule: true }, Lib);
  `;
  const result = await esbuild.build({
    stdin: {
      contents: shim,
      resolveDir: repoRoot,
      loader: 'js',
      sourcefile: `vendored-${name}-shim.js`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    // Confirmed empirically (see the commit introducing this file): a
    // real framer-motion bundle references both of these externally --
    // 'react' directly, and 'react/jsx-runtime' from an internal
    // component of its own that itself uses JSX. clsx/tailwind-merge/
    // class-variance-authority don't need either today, but marking them
    // external for every library uniformly is harmless (a no-op if the
    // specifier never appears) and keeps this loop simple.
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    minify: true,
  });
  await esbuild.stop();
  return result.outputFiles[0].text;
}

async function main() {
  const entries = [];
  for (const name of LIBRARIES) {
    console.log(`Bundling ${name}...`);
    const js = await bundleLibrary(name);
    console.log(`  ${(js.length / 1024).toFixed(1)} KB`);
    entries.push({ name, js });
  }

  const constants = entries
    .map(({ name, js }) => {
      const constName = `VENDORED_LIBRARY_${toConstantCase(name)}_JS`;
      return `export const ${constName} = ${JSON.stringify(js)};`;
    })
    .join('\n\n');

  const recordEntries = entries
    .map(({ name }) => `  ${JSON.stringify(name)}: VENDORED_LIBRARY_${toConstantCase(name)}_JS,`)
    .join('\n');

  const fileContents = `// AUTO-GENERATED by scripts/generate-vendored-libraries.mjs -- do not
// edit by hand. Regenerate with: node scripts/generate-vendored-libraries.mjs
// (whenever a pinned vendored-library version in package.json changes).
//
// One browser-safe IIFE per allow-listed UI-kit library (see that
// script's own header for the full rationale), each assigning its real
// module namespace into window.__DeliveryOSVendoredLibs[name] when run.
// Embedded, in this same order, after VENDORED_REACT_RUNTIME_JS and the
// require() shim but before the component's own bundle -- see
// src/engine/preview/compile.ts.
${constants}

/** Every generated library's JS, keyed by its real package name -- lets
 * compile.ts embed "all of them, in a stable order" with one loop
 * instead of hand-listing each constant a second time. */
export const VENDORED_LIBRARIES_JS: Record<string, string> = {
${recordEntries}
};
`;

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, fileContents, 'utf-8');
  console.log(`Wrote ${outFile}`);
}

function toConstantCase(name) {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
