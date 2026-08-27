#!/usr/bin/env node
// Generates src-tauri/spike-ui/vendor/xterm.js and vendor/xterm.css for
// the embedded-terminal feature (pty.rs / the "Wire with Claude" panel
// in app.js).
//
// Unlike generate-vendored-marked.mjs (a straight file copy -- `marked`
// ships an already-browser-ready UMD build), xterm.js ships ES/CJS
// modules with no plain-`<script>`-ready bundle, so this follows
// generate-vendored-libraries.mjs's REAL esbuild-IIFE-bundle pattern
// instead -- just writing a real static file for the webview's own
// `<script src="vendor/xterm.js">` tag (this app has no bundler/CDN
// access at runtime, see that script's own header comment), not a
// `.generated.ts` string constant (that variant feeds the SIDECAR's own
// preview compiler, a different consumer with a different embedding
// need).
//
// Run this whenever the pinned @xterm/xterm or @xterm/addon-fit version
// in package.json changes. Wired as an npm "prebuild"/"pretypecheck"/
// "pretest" step alongside the other three generators.

import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const vendorDir = path.join(repoRoot, 'src-tauri', 'spike-ui', 'vendor');
const jsOutFile = path.join(vendorDir, 'xterm.js');
const cssOutFile = path.join(vendorDir, 'xterm.css');
const cssSrcFile = path.join(repoRoot, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css');

async function bundle() {
  // Both libraries' real exports assigned onto `window` -- `Terminal`
  // bare (the one class app.js actually constructs) and `FitAddon`
  // namespaced under itself (matching `@xterm/addon-fit`'s own single
  // named export, `FitAddon`) so app.js's `new FitAddon.FitAddon()`
  // reads the same as every other real xterm.js integration's own docs.
  const shim = `
    import { Terminal } from '@xterm/xterm';
    import { FitAddon } from '@xterm/addon-fit';
    window.Terminal = Terminal;
    window.FitAddon = { FitAddon };
  `;
  const result = await esbuild.build({
    stdin: {
      contents: shim,
      resolveDir: repoRoot,
      loader: 'js',
      sourcefile: 'vendored-xterm-shim.js',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
  });
  await esbuild.stop();
  return result.outputFiles[0].text;
}

async function main() {
  console.log('Bundling @xterm/xterm + @xterm/addon-fit...');
  const js = await bundle();
  console.log(`  ${(js.length / 1024).toFixed(1)} KB`);

  fs.mkdirSync(vendorDir, { recursive: true });
  fs.writeFileSync(jsOutFile, js, 'utf-8');
  console.log(`Wrote ${jsOutFile}`);

  const css = fs.readFileSync(cssSrcFile, 'utf-8');
  fs.writeFileSync(cssOutFile, css, 'utf-8');
  console.log(`Wrote ${cssOutFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
