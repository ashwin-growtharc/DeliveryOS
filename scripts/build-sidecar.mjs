#!/usr/bin/env node
// Build script for the Phase 3 Node SEA (Single Executable Application)
// spike -- packages the sidecar (src/sidecar.ts) as a standalone .exe that
// does not require a Node install on the target machine. This is meant to
// eventually become a Tauri sidecar binary; this script only covers the
// Node/TypeScript side of that (no cargo/rustc/Tauri involved).
//
// Assumes `npm run build` (tsc) has ALREADY been run, so `dist/sidecar.js`
// exists. This script intentionally does not shell out to tsc itself: the
// tsc compile covers the whole `src/**/*.ts` tree (same as the CLI build)
// and re-running it here on every bundle/SEA iteration would just be
// slower for no benefit while iterating on this script. If dist/sidecar.js
// is missing or stale, run `npm run build` first (documented here and in
// the "build:sidecar" package.json script's neighboring comment).
//
// Steps: esbuild-bundle -> write sea-config.json -> generate SEA blob via
// `node --experimental-sea-config` -> copy the current node.exe -> inject
// the blob into the copy via `postject`.
//
// NOTE (Windows-only for now): this only produces a Windows binary
// (deliveryos-engine-x86_64-pc-windows-msvc.exe), copied from
// `process.execPath` (i.e. whatever Node binary is running this script).
// A real cross-platform build would need per-OS output naming and would
// need to source each OS's own Node binary rather than just copying the
// currently-running one -- out of scope until a Mac/Linux target actually
// exists.

import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const distSidecar = path.join(repoRoot, 'dist', 'sidecar.js');
const buildDir = path.join(repoRoot, 'build');
const bundlePath = path.join(buildDir, 'sidecar.cjs');
const blobPath = path.join(buildDir, 'sidecar.blob');
const seaConfigPath = path.join(repoRoot, 'sea-config.json');
const exePath = path.join(buildDir, 'deliveryos-engine-x86_64-pc-windows-msvc.exe');
// The preview-compile feature (Phase 6) needs native esbuild's binary at
// runtime, but this packaged sidecar has no node_modules for esbuild's
// default resolution to find it in. Staged here into build/ (same place
// the packaged sidecar .exe itself lands) purely so tauri.conf.json's
// `bundle.resources` has one stable path to reference, independent of
// node_modules' own layout -- see docs/phase-A-preview-packaging-spike.md.
const esbuildNativeSrc = path.join(repoRoot, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe');
const esbuildNativeDest = path.join(buildDir, 'esbuild.exe');

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit', cwd: repoRoot, ...options });
}

async function main() {
  if (!fs.existsSync(distSidecar)) {
    throw new Error(
      `${distSidecar} not found -- run "npm run build" first ` +
        '(this script assumes tsc has already compiled src/**/*.ts to dist/).',
    );
  }

  fs.mkdirSync(buildDir, { recursive: true });

  console.log('Bundling dist/sidecar.js -> build/sidecar.cjs with esbuild...');
  await esbuild.build({
    entryPoints: [distSidecar],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // Deliberately NOT marked external: esbuild's own JS API refuses to run
    // bundled into someone else's single file ("The esbuild JavaScript API
    // cannot be bundled") UNLESS `ESBUILD_BINARY_PATH` is already set --
    // read at module-top-level in esbuild's own source (`var
    // ESBUILD_BINARY_PATH = process.env.ESBUILD_BINARY_PATH || ...`), so it
    // must be present in THIS process's environment before this bundled
    // code ever runs. src-tauri/src/lib.rs sets that env var via `.env()`
    // on the Command builder before `.spawn()`, which is exactly "before
    // this process's first instruction runs," not a runtime race. Marking
    // 'esbuild' external instead would leave an unresolvable
    // `require('esbuild')` in the packaged bundle, since the packaged
    // sidecar ships with no node_modules at all -- bundling it IS the
    // point; ESBUILD_BINARY_PATH is what makes that legal.
    outfile: bundlePath,
  });

  const seaConfig = {
    main: 'build/sidecar.cjs',
    output: 'build/sidecar.blob',
    disableExperimentalSEAWarning: true,
  };
  fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2) + '\n', 'utf-8');

  console.log('Generating SEA blob (node --experimental-sea-config)...');
  run(process.execPath, ['--experimental-sea-config', 'sea-config.json']);

  console.log(`Copying node executable (${process.execPath}) -> ${exePath}`);
  fs.copyFileSync(process.execPath, exePath);
  fs.chmodSync(exePath, 0o755);

  console.log(`Staging native esbuild binary (${esbuildNativeSrc}) -> ${esbuildNativeDest}`);
  if (!fs.existsSync(esbuildNativeSrc)) {
    throw new Error(
      `${esbuildNativeSrc} not found -- expected @esbuild/win32-x64 to already be installed ` +
        '(it\'s an optionalDependency of the "esbuild" package in package.json).',
    );
  }
  fs.copyFileSync(esbuildNativeSrc, esbuildNativeDest);

  console.log('Injecting SEA blob into the copied executable with postject...');
  // On Windows, `npx` resolves to `npx.cmd`, a batch-file shim rather than
  // a real .exe. execFileSync's default (shell: false) spawns argv[0]
  // directly via CreateProcess, which cannot run a .cmd file and fails
  // with EINVAL (confirmed on this Node 24 / Windows 11 install) -- it
  // needs `shell: true` so the .cmd gets routed through cmd.exe.
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
