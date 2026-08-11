#!/usr/bin/env node
// Build script for packaging the `deliveryos` CLI (src/index.ts) as a
// standalone Node SEA (Single Executable Application) .exe that does not
// require a Node install on the target machine -- the same property
// scripts/build-sidecar.mjs already gives the sidecar, extended to the
// CLI so the desktop installer can drop it on PATH without also needing
// to ship/require Node separately. Mirrors build-sidecar.mjs's own
// pipeline almost verbatim; see that file's own comments for the
// reasoning behind each step (esbuild's own bundling exception,
// chromium-bidi being left external, the npx.cmd shell:true requirement
// on Windows) -- not repeated here.
//
// Deliberately does NOT share build-sidecar.mjs's sea-config.json (uses
// its own sea-config.cli.json instead) -- two build scripts writing the
// same top-level config file would leave ambiguous state if either build
// is interrupted mid-run. Also does not stage the native esbuild.exe
// resource the sidecar needs: the CLI never reaches the preview-compile
// path, so it has no use for it.
//
// Assumes `npm run build` (tsc) has ALREADY been run, so `dist/index.js`
// exists -- same "don't re-run tsc here" reasoning as build-sidecar.mjs.
//
// NOTE (Windows-only for now): matches build-sidecar.mjs's own current
// scope -- no cross-platform output naming yet, since no Mac/Linux
// installer target exists.

import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const distCli = path.join(repoRoot, 'dist', 'index.js');
const buildDir = path.join(repoRoot, 'build');
const bundlePath = path.join(buildDir, 'cli.cjs');
const blobPath = path.join(buildDir, 'cli.blob');
const seaConfigPath = path.join(repoRoot, 'sea-config.cli.json');
const exePath = path.join(buildDir, 'deliveryos-cli.exe');

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit', cwd: repoRoot, ...options });
}

async function main() {
  if (!fs.existsSync(distCli)) {
    throw new Error(
      `${distCli} not found -- run "npm run build" first ` +
        '(this script assumes tsc has already compiled src/**/*.ts to dist/).',
    );
  }

  fs.mkdirSync(buildDir, { recursive: true });

  console.log('Bundling dist/index.js -> build/cli.cjs with esbuild...');
  await esbuild.build({
    entryPoints: [distCli],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // Same external as build-sidecar.mjs, for the same reason
    // (playwright-core's chromium-bidi require is real but never reached
    // at runtime) -- the CLI doesn't currently import anything that pulls
    // this in, but keeping the two build scripts' esbuild options
    // trivially diffable is worth more than the few bytes this costs.
    external: ['chromium-bidi', 'chromium-bidi/*'],
    outfile: bundlePath,
  });

  const seaConfig = {
    main: 'build/cli.cjs',
    output: 'build/cli.blob',
    disableExperimentalSEAWarning: true,
  };
  fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2) + '\n', 'utf-8');

  console.log('Generating SEA blob (node --experimental-sea-config)...');
  run(process.execPath, ['--experimental-sea-config', 'sea-config.cli.json']);

  console.log(`Copying node executable (${process.execPath}) -> ${exePath}`);
  fs.copyFileSync(process.execPath, exePath);
  fs.chmodSync(exePath, 0o755);

  console.log('Injecting SEA blob into the copied executable with postject...');
  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  run(
    npxCommand,
    [
      'postject',
      path.relative(repoRoot, exePath),
      'NODE_SEA_BLOB',
      path.relative(repoRoot, blobPath),
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      '--overwrite',
    ],
    { shell: process.platform === 'win32' },
  );

  console.log(`Done: ${exePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
