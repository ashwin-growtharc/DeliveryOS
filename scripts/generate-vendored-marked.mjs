#!/usr/bin/env node
// Copies marked's own real UMD browser build into
// src-tauri/spike-ui/vendor/marked.min.js -- spike-ui has no build step
// at all (frontendDist points straight at this folder; sidecar.js/app.js
// are loaded as plain classic <script> tags), so this is a vendored
// STATIC ASSET, not a TS string constant like
// generate-vendored-react-runtime.mjs/generate-vendored-libraries.mjs
// (those feed the SIDECAR's own preview compiler, a completely different
// consumer). No esbuild rebuild needed here either -- marked ships its
// own dependency-free UMD build already (sets `window.marked` when
// loaded as a plain script), so this is a straight copy, not a bundle.
//
// Run this whenever the pinned `marked` version in package.json changes.
// Wired as an npm "prebuild"/"pretypecheck"/"pretest" step alongside the
// other three generate-vendored-*.mjs scripts; see package.json.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const srcFile = path.join(repoRoot, 'node_modules', 'marked', 'lib', 'marked.umd.js');
const outFile = path.join(repoRoot, 'src-tauri', 'spike-ui', 'vendor', 'marked.min.js');

function main() {
  const contents = fs.readFileSync(srcFile, 'utf-8');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, contents, 'utf-8');
  console.log(`Wrote ${outFile} (${(contents.length / 1024).toFixed(1)} KB)`);
}

main();
