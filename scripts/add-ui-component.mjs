#!/usr/bin/env node
// Scaffolds a new "ui-component" artifact from an arbitrary, real-world
// React component file -- the one recurring mechanical step every
// component pushed through this preview pipeline needs, done once here
// instead of by hand every time.
//
// Why this exists: the preview pipeline (src/engine/preview/compile.ts)
// vendors React itself as a global (window.__DeliveryOSReactRuntime),
// because the packaged sidecar has no real node_modules to resolve a
// normal `import React from 'react'` against (see compile.ts's own doc
// comment). Every real-world component, though, is written with exactly
// that normal import -- confirmed by hand against two real pasted
// components this session, both of which failed to compile for this
// reason alone, before Tailwind or any other missing dependency ever
// entered into it. This script does ONLY that one swap, mechanically,
// so the same by-hand edit doesn't have to be repeated for every future
// component.
//
// What this script deliberately does NOT do: fix anything else. Tailwind
// utility classes (no build step exists in this pipeline -- they render
// with zero effect) and any other non-vendored npm import (framer-motion,
// etc.) are left exactly as-is in the source. The component either renders
// correctly-structured-but-unstyled, or fails to compile with a real,
// specific esbuild error naming the exact unresolved import -- both are
// useful, honest signal about what this pipeline can and can't handle yet,
// not something to silently paper over.
//
// Usage:
//   node scripts/add-ui-component.mjs \
//     --file path/to/Component.tsx \
//     --id some-artifact-id \
//     --description "..." \
//     --component-types form,button \
//     [--owner ashwin-growtharc] [--remote ai-helpers] [--push]
//
// Without --push: stages the adapted component + a generated preview.tsx
// under .deliveryos-staging/<id>/, and prints the exact `deliveryos push
// --new` command for you to review (and try `npm run dev -- push ...`
// locally against the compiler, if you want) before running it yourself.
//
// With --push: runs that same command directly, which opens a REAL pull
// request against whichever --remote's GitHub repo, using your own
// already-logged-in `gh` session (see src/engine/github/githubAuth.ts).
// This script never merges anything -- pushing here only ever proposes.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

function parseArgs(argv) {
  const args = { componentTypes: [], owner: 'ashwin-growtharc', remote: 'ai-helpers', push: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--push') {
      args.push = true;
      continue;
    }
    const value = argv[i + 1];
    if (arg === '--file') args.file = value;
    else if (arg === '--id') args.id = value;
    else if (arg === '--description') args.description = value;
    else if (arg === '--owner') args.owner = value;
    else if (arg === '--remote') args.remote = value;
    else if (arg === '--component-types') {
      args.componentTypes = value.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      continue; // unrecognized flag's value would otherwise get skipped below
    }
    i += 1;
  }
  return args;
}

/**
 * Swaps a normal `import React, {hooks} from 'react'` (or a bare
 * `import React from 'react'`, or a hooks-only `import {hooks} from
 * 'react'`) for the vendored-runtime global this pipeline actually
 * provides, plus a type-only `import type React from 'react'` so any
 * `React.FC`/`React.CSSProperties`-style TYPE annotations elsewhere in
 * the file keep working -- `import type` is erased entirely by esbuild's
 * TypeScript transform without ever attempting to resolve the module, so
 * it costs nothing at runtime and needs no real 'react' package to exist.
 *
 * Known limitation, not a full parse: matches the single-line `import
 * React[, {hooks}] from 'react'` / `import {hooks} from 'react'` shapes
 * only (confirmed to cover both real components tested this session) --
 * a `import * as React from 'react'` or a multi-line import would need a
 * manual fix same as before this script existed.
 */
function rewriteReactImport(source) {
  const pattern = /^import\s+(?:React\s*,?\s*)?(?:\{([^}]*)\}\s*)?from\s*['"]react['"];?\s*$/m;
  const match = source.match(pattern);
  if (!match) {
    return { rewritten: source, matched: false };
  }
  const hooks = (match[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const replacement = [
    `declare const window: any;`,
    hooks.length > 0 ? `const { ${hooks.join(', ')} } = window.__DeliveryOSReactRuntime.React;` : null,
    `import type React from 'react';`,
  ]
    .filter(Boolean)
    .join('\n');
  return { rewritten: source.replace(pattern, replacement), matched: true };
}

/** Finds the file's `export default` identifier, to import into the
 * generated preview.tsx -- matches both `export default function X` and
 * `export default X;` (X already declared earlier in the file). Known
 * limitation: no default export at all (a component exported only by
 * name) needs a hand-written preview.tsx instead. */
function findDefaultExportName(source) {
  const match = source.match(/export\s+default\s+(?:function\s+)?(\w+)/);
  return match ? match[1] : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['file', 'id', 'description']) {
    if (!args[required]) {
      console.error(`Missing required --${required}`);
      process.exit(1);
    }
  }

  const sourcePath = path.resolve(args.file);
  const source = fs.readFileSync(sourcePath, 'utf-8');
  const basename = path.basename(sourcePath);

  const { rewritten, matched } = rewriteReactImport(source);
  if (!matched) {
    console.warn(
      `Warning: no "import ... from 'react'" line matched in ${basename} -- staged verbatim. `
      + `If it still fails to compile with a "react" resolution error, this file's import shape `
      + `isn't one of the ones this script recognizes; fix it by hand (see DecryptingText.tsx in `
      + `an existing artifact for the target pattern).`,
    );
  }

  const componentName = findDefaultExportName(source);
  if (!componentName) {
    console.error(
      `Could not find an "export default" in ${basename} -- can't auto-generate preview.tsx. `
      + `Stage this component by hand instead (see any existing artifact's payload/ directory).`,
    );
    process.exit(1);
  }

  const stagingDir = path.join(repoRoot, '.deliveryos-staging', args.id);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  fs.writeFileSync(path.join(stagingDir, basename), rewritten);

  const importPath = `./${basename.replace(/\.[jt]sx?$/, '')}`;
  const previewContents = `import ${componentName} from '${importPath}';\n\nexport const Default = () => <${componentName} />;\n`;
  fs.writeFileSync(path.join(stagingDir, 'preview.tsx'), previewContents);

  console.log(`Staged ${args.id} -> ${stagingDir}`);
  console.log(`  ${basename}${matched ? ' (react import rewritten)' : ' (staged verbatim, see warning above)'}`);
  console.log(`  preview.tsx (generated, exports Default -> <${componentName} />)`);

  const pushArgs = [
    path.join(repoRoot, 'dist', 'index.js'),
    'push',
    args.id,
    '--new',
    '--remote', args.remote,
    '--path', stagingDir,
    '--kind', 'ui-component',
    '--owner', args.owner,
    '--description', args.description,
  ];
  if (args.componentTypes.length > 0) {
    pushArgs.push('--component-types', args.componentTypes.join(','));
  }

  const printableCommand = ['node', ...pushArgs.map((a) => (a.includes(' ') ? `"${a}"` : a))].join(' ');

  if (args.push) {
    console.log(`\nRunning: ${printableCommand}\n`);
    const result = spawnSync('node', pushArgs, { stdio: 'inherit', cwd: repoRoot });
    process.exit(result.status ?? 1);
  } else {
    console.log(`\nReview, then run yourself:\n\n  ${printableCommand}\n`);
    console.log(`(This opens a real pull request against ${args.remote}'s GitHub repo -- nothing is pushed yet.)`);
  }
}

main();
