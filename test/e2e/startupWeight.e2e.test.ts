import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * `deliveryos --help` must not load the TypeScript compiler.
 *
 * WHY THIS IS A TEST AND NOT A NUMBER IN A COMMIT MESSAGE
 *
 * Measured before this guard existed, `--help` took a second and `list` took
 * 1.3 s -- on a machine where the actual work of either is a few
 * milliseconds. The whole second was six modules eagerly importing tools that
 * only `push --preview`, `scan`, signed pulls and `mcp` ever run: Tailwind
 * (247 ms), sigstore (240 ms), react-docgen (181 ms), the MCP SDK (180 ms),
 * the TypeScript compiler (178 ms). Every command paid for all of them.
 *
 * A timing assertion would catch the regression and also fail on a slow CI
 * runner. This instead asserts the CAUSE: after `--help` exits, none of those
 * packages is in `require.cache`. Deterministic, and it names the module that
 * regressed.
 *
 * Two layers, because they fail differently. The static scan below points at
 * the exact `import` line. The spawn is the truth -- it catches an eager load
 * reached through any path the regex did not anticipate.
 */

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(REPO_ROOT, 'src');
const CLI_ENTRY = path.join(SRC, 'index.ts');

/** Packages a `--help` has no business loading. Each is used by exactly one
 * feature, and none of those features is "print the usage text". */
const HEAVY = [
  'typescript',
  'tailwindcss',
  'postcss',
  'react-docgen-typescript',
  'sigstore',
  'playwright-core',
  '@octokit/rest',
  '@modelcontextprotocol/sdk',
] as const;

/** The subset the static scan checks for at the top of source files.
 *
 * `esbuild` is here and not in HEAVY: the test harness (`tsx`) loads it to
 * transpile TypeScript, so its presence in the spawned process's cache proves
 * nothing. The MCP SDK is in HEAVY and not here: `src/mcp/**` is the MCP
 * server and imports the SDK at the top of its files legitimately. What must
 * not happen is a CLI command reaching it, and only the spawn can see that. */
const HEAVY_STATIC = [
  'typescript',
  'tailwindcss',
  'postcss',
  'react-docgen-typescript',
  'sigstore',
  'playwright-core',
  '@octokit/rest',
  'esbuild',
] as const;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.generated.ts')) out.push(full);
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

describe('the cost of `deliveryos --help`', () => {
  it('no engine module imports a heavy dependency at the top level', () => {
    const files = sourceFiles(SRC);
    expect(files.length, 'scanned no source files -- this guard is checking nothing').toBeGreaterThan(50);

    const specifiers = HEAVY_STATIC.map(escapeRegExp).join('|');
    // A value import at the top of a module runs the dependency's whole entry
    // point on import. `import type` is erased by the compiler and costs
    // nothing, which is what these modules should be using for their types.
    //
    // `[^;\n]` rather than `[^;]`: an import statement is one line here, and
    // letting the match run across lines would let it start at an unrelated
    // `import` and end at a heavy one.
    const eager = new RegExp(`^import (?!type\\b)[^;\\n]*?from '(${specifiers})'`, 'm');
    const typeOnly = new RegExp(`^import type [^;\\n]*?from '(${specifiers})'`, 'm');

    const offenders: string[] = [];
    let typeImportsSeen = 0;
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf-8');
      if (typeOnly.test(source)) typeImportsSeen += 1;
      const match = source.match(eager);
      if (match) offenders.push(`${path.relative(REPO_ROOT, file)}: ${match[0]}`);
    }

    // The regex must be able to tell the two apart, or a future rewrite that
    // turns every import into `import type` by accident would pass vacuously.
    expect(typeImportsSeen, 'found no `import type` from any heavy package -- the exclusion is untested').toBeGreaterThan(0);
    expect(offenders, 'eager imports of heavy dependencies; defer them to first use').toEqual([]);
  });

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-startup-'));
  afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

  it('`--help` finishes without loading any of them', () => {
    // A preload that records which packages ended up in `require.cache` by
    // the time the process exits. Package names only: the exact file inside
    // a package is noise, and the top-level name is what a person recognises.
    const hook = path.join(scratch, 'record-loaded.cjs');
    const out = path.join(scratch, 'loaded.json');
    fs.writeFileSync(
      hook,
      [
        "const fs = require('fs');",
        "process.on('exit', () => {",
        '  const names = new Set();',
        '  for (const key of Object.keys(require.cache)) {',
        "    const m = key.replace(/\\\\/g, '/').match(/node_modules\\/((@[^/]+\\/)?[^/]+)/);",
        '    if (m) names.add(m[1]);',
        '  }',
        `  fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify([...names].sort()));`,
        '});',
      ].join('\n'),
      'utf-8',
    );

    // `--import tsx` and not `tsx/cli`: the CLI wrapper re-executes Node in a
    // child process, which leaves the preload recording an empty parent. The
    // loader flag runs TypeScript in THIS process, where `require.cache` is
    // the one the CLI actually filled.
    const result = spawnSync(process.execPath, ['--import', 'tsx', '-r', hook, CLI_ENTRY, '--help'], {
      encoding: 'utf-8',
      timeout: 60_000,
    });
    expect(result.status, `CLI exited ${result.status}\n${result.stderr}`).toBe(0);
    expect(fs.existsSync(out), 'the preload never ran -- nothing was measured').toBe(true);

    const loaded: string[] = JSON.parse(fs.readFileSync(out, 'utf-8'));
    // Anti-vacuity: `commander` is what prints the help, so it must be there.
    // If it is not, the recorder is looking at the wrong process.
    expect(loaded).toContain('commander');

    const heavyLoaded = HEAVY.filter((name) => loaded.includes(name));
    expect(heavyLoaded, 'loaded just to print --help').toEqual([]);
  });
});
