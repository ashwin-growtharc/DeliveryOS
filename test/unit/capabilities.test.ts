import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CAPABILITIES, paidCapabilities, mutatingCapabilities } from '../../src/capabilities';

/**
 * The guard that makes `src/capabilities.ts` worth having.
 *
 * A manifest nobody checks is a comment. This asserts the declaration and the
 * three real surfaces agree in both directions: every command, RPC key and
 * tool that exists is declared exactly once, and nothing is declared that does
 * not exist. Adding an operation to one surface without declaring it fails the
 * build, which is the whole point -- the surfaces already disagree in ways
 * nobody noticed for months (`check-updates --apply` scope, `applyBuildFix`
 * attribution), and both would have been caught here.
 *
 * Guard hygiene, learned from a sibling repo where the boundary written as a
 * mechanical test held and the one written as a doc leaked: every extractor
 * below carries an ANTI-VACUITY assertion. A guard that silently scans nothing
 * reports success, which is worse than no guard because it reads as one.
 */

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI_COMMANDS_DIR = path.join(REPO_ROOT, 'src', 'cli', 'commands');

/** Every `.command('...')` string across the CLI command modules.
 *
 * `remote`'s three subcommands are qualified, because "add" and "remove" are
 * meaningless on their own and `remove <id>` is a different, top-level
 * operation that deletes an installed artifact. */
function actualCliCommands(): string[] {
  const found: string[] = [];
  for (const file of fs.readdirSync(CLI_COMMANDS_DIR).filter((f) => f.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(CLI_COMMANDS_DIR, file), 'utf-8');
    const names = [...source.matchAll(/\.command\('([^']+)'\)/g)].map((m) => m[1]);
    // remoteAdd.ts declares the parent `remote` plus three children.
    if (names.includes('remote')) {
      for (const n of names) {
        if (n !== 'remote') found.push(`remote ${n}`);
      }
    } else {
      found.push(...names);
    }
  }
  expect(found.length, 'parsed zero CLI commands -- this guard is checking nothing').toBeGreaterThan(0);
  return found;
}

/** Every key in the sidecar's dispatch table. */
function actualSidecarKeys(): string[] {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'sidecar.ts'), 'utf-8');
  const keys = [...source.matchAll(/^ {2}'([a-zA-Z]+\.[a-zA-Z]+)':/gm)].map((m) => m[1]);
  expect(keys.length, 'parsed zero sidecar keys -- this guard is checking nothing').toBeGreaterThan(0);
  return keys;
}

/** Every tool name passed to `registerTool`. */
function actualMcpTools(): string[] {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'mcp', 'server.ts'), 'utf-8');
  const names = [...source.matchAll(/registerTool\(\s*\n\s*'([a-z_]+)'/g)].map((m) => m[1]);
  expect(names.length, 'parsed zero MCP tools -- this guard is checking nothing').toBeGreaterThan(0);
  return names;
}

/** Every sidecar command name the DESKTOP APP actually calls.
 *
 * app.js is the one surface with no compiler and no linter behind it:
 * `eslint --print-config` reports `rules: 0` for it (its only rule-bearing
 * block is scoped to TypeScript files), and tsconfig's `include` never reaches
 * `src-tauri/`. So a renamed sidecar command passes every gate in CI and
 * surfaces as a runtime toast in front of a user.
 *
 * A comment that quotes a real call (`app.js:1330` mentions
 * `call('preview.compile', ...)`) is deliberately not filtered out: it names a
 * command that must exist anyway, so matching it costs nothing and a filter
 * would just be another thing to get wrong. */
function actualAppRpcNames(): string[] {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src-tauri', 'spike-ui', 'app.js'),
    'utf-8',
  );
  const names = [...source.matchAll(/\bcall\(\s*'([a-zA-Z]+\.[a-zA-Z]+)'/g)].map((m) => m[1]);
  expect(names.length, 'parsed zero app.js RPC calls -- this guard is checking nothing').toBeGreaterThan(30);
  return names;
}

/** `pull` legitimately backs two capabilities (`artifact.pull` and
 * `artifact.pullAndAutoWire`), chosen by the `hasWiring` gate. That gate is
 * itself the duplication PLAN.md Phase 4 removes; until then this is a real
 * one-command-two-operations case rather than a declaration error. */
const CLI_COMMANDS_BACKING_TWO_CAPABILITIES = new Set([
  // Gated on `hasWiring` -- `artifact.pull` vs `artifact.pullAndAutoWire`.
  'pull <id>',
  // `check-updates` is a safe read; `check-updates --apply` is a destructive
  // write. One command, two operations, distinguished only by a flag.
  'check-updates',
]);

/** Not an operation: the composition root that boots the MCP server. */
const CLI_NON_OPERATIONS = new Set(['mcp']);

describe('capability manifest', () => {
  it('declares every CLI command exactly once, and invents none', () => {
    const actual = actualCliCommands().filter((c) => !CLI_NON_OPERATIONS.has(c));
    const declared = CAPABILITIES.map((c) => c.cli).filter((c): c is string => c !== undefined);

    for (const command of new Set(actual)) {
      const times = declared.filter((d) => d === command).length;
      const expected = CLI_COMMANDS_BACKING_TWO_CAPABILITIES.has(command) ? 2 : 1;
      expect(times, `CLI command "${command}" is declared ${times}x, expected ${expected}x`).toBe(expected);
    }

    for (const command of new Set(declared)) {
      expect(
        actual,
        `capabilities.ts declares CLI command "${command}", which no command module registers`,
      ).toContain(command);
    }
  });

  it('declares every sidecar RPC key exactly once, and invents none', () => {
    const actual = actualSidecarKeys();
    const declared = CAPABILITIES.map((c) => c.sidecar).filter((s): s is string => s !== undefined);

    expect(new Set(declared).size, 'a sidecar key is declared twice').toBe(declared.length);
    expect(declared.sort()).toEqual([...actual].sort());
  });

  // The desktop app is the FOURTH surface, and the only unguarded one. This
  // direction is deliberately one-way: plenty of sidecar commands exist that
  // the app never calls (CLI- and MCP-only operations), so requiring the
  // reverse would be wrong. What must hold is that everything the app asks
  // for actually exists.
  //
  // Names only. Argument and result SHAPES stay uncovered -- the existing
  // browser tests stub the sidecar with hand-written fixtures, so a changed
  // result shape still passes everything. Catching that needs a real-sidecar
  // browser harness, which this is not.
  it('every sidecar command app.js calls exists in the dispatch table and is declared', () => {
    const called = new Set(actualAppRpcNames());
    const dispatch = new Set(actualSidecarKeys());
    const declared = new Set(
      CAPABILITIES.map((c) => c.sidecar).filter((s): s is string => s !== undefined),
    );

    for (const name of called) {
      expect(
        dispatch.has(name),
        `app.js calls "${name}", which src/sidecar.ts does not dispatch -- `
        + 'the app would show a runtime error for this button',
      ).toBe(true);
      expect(
        declared.has(name),
        `app.js calls "${name}", which src/capabilities.ts does not declare`,
      ).toBe(true);
    }
  });

  it('declares every MCP tool exactly once, and invents none', () => {
    const actual = actualMcpTools();
    const declared = CAPABILITIES.flatMap((c) => c.mcp ?? []);

    expect(new Set(declared).size, 'an MCP tool is declared twice').toBe(declared.length);
    expect(declared.sort()).toEqual([...actual].sort());
  });

  it('gives every capability a unique canonical name', () => {
    const names = CAPABILITIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('exposes every capability on at least one surface', () => {
    // A declaration nothing implements is dead weight that will rot.
    const orphans = CAPABILITIES.filter((c) => !c.cli && !c.sidecar && !c.mcp?.length);
    expect(orphans.map((c) => c.name)).toEqual([]);
  });

  it('pins the operations that spend real money', () => {
    // Pinned by NAME, not by count, so adding a paid operation forces an
    // explicit edit here rather than silently moving a number. Two of these
    // are CLI-only -- an audit of the sidecar alone reports six and misses
    // `wireWithClaude` and `scaffoldBackendPlugin`.
    expect(paidCapabilities().map((c) => c.name).sort()).toEqual([
      'artifact.requestAntiPatternFix',
      'artifact.requestBuildFix',
      'artifact.requestWiringMerge',
      'artifact.requestWiringPlacement',
      'artifact.scaffoldBackendPlugin',
      'artifact.suggestAntiPatterns',
      'artifact.suggestMetadata',
      'artifact.wireWithClaude',
    ]);
  });

  it('pins the operations that can destroy unrecoverable work', () => {
    // The set an approval dialog actually needs. `destructive` is deliberately
    // narrower than `mutates`: writing `.env.local` is a mutation; deleting an
    // edited install target is not recoverable from inside DeliveryOS.
    expect(CAPABILITIES.filter((c) => c.destructive).map((c) => c.name).sort()).toEqual([
      'artifact.applyUpdate',
      'artifact.pull',
      'artifact.pullAndAutoWire',
      'artifact.remove',
      'remote.remove',
    ]);
  });

  it('pins the operations that run shell commands from a manifest', () => {
    expect(CAPABILITIES.filter((c) => c.executesShell).map((c) => c.name).sort()).toEqual([
      'artifact.applyUpdate',
      'artifact.pull',
      'artifact.pullAndAutoWire',
      'artifact.remove',
      'artifact.verifyBuild',
      'artifact.wireWithClaude',
      'preview.compile',
      'preview.compileLocal',
      'preview.compilePayloadComponent',
    ]);
  });

  it('never marks a capability destructive without also marking it mutating', () => {
    // Destructive is a strict subset. A surface that gates only on `mutates`
    // must not be able to miss a destructive operation.
    const inconsistent = CAPABILITIES.filter((c) => c.destructive && !c.mutates);
    expect(inconsistent.map((c) => c.name)).toEqual([]);
  });

  it('keeps every mutating capability off the read-only MCP surface', () => {
    // The MCP server is read-only by construction (`src/mcp/ports.ts`). This
    // asserts the same property from the manifest's side, so the two
    // declarations cannot drift apart -- if a mutating operation ever gains an
    // `mcp` entry, this fails even if the port test was edited to allow it.
    const leaked = mutatingCapabilities().filter((c) => (c.mcp?.length ?? 0) > 0);
    expect(
      leaked.map((c) => c.name).sort(),
      'a mutating capability is exposed over MCP -- see PLAN.md Phase 2 before allowing this',
    ).toEqual(['artifact.push', 'catalog.refresh', 'remote.add']);

    // Exactly two deliberate exceptions, and the property they share is what
    // they do NOT write: both touch only the caches under ~/.deliveryos, never
    // a file in the user's project.
    //
    //  - `catalog.refresh` fetches remotes and re-reads. It DOES take a `cwd`,
    //    because it reports install status for a project -- so it is not an
    //    example of "needs no project directory". It writes nothing there.
    //  - `remote.add` clones a URL into the cache and refuses a duplicate name
    //    before cloning. It needs no project at all, which is precisely why it
    //    could ship while every install tool waits: the project-root authority
    //    problem does not apply to an operation that never touches a project.
    //
    // Asserted as a list rather than a count, so adding a third requires
    // editing this line -- which is where the consent question belongs.
    for (const name of ['artifact.push', 'catalog.refresh', 'remote.add']) {
      const capability = CAPABILITIES.find((c) => c.name === name);
      expect(capability?.destructive, `${name} must not be destructive`).toBe(false);
      expect(capability?.costsRealMoney, `${name} must not spend money`).toBe(false);
      expect(capability?.executesShell, `${name} must not run shell`).toBe(false);
    }

    // `artifact.push` is the third exception and the only one whose mistakes
    // land on OTHER PEOPLE. It is here on a different footing from the other
    // two: they are safe because of what they do not touch, this one is safe
    // only because of what wraps it -- a preview that shows the exact file
    // list, and a single-use token binding the push to it. If either of the
    // two tools below disappears, that argument is gone and this entry should
    // go with it.
    const push = CAPABILITIES.find((c) => c.name === 'artifact.push');
    expect(push?.mcp).toEqual(['preview_contribution', 'contribute_artifact']);
    // And the one that genuinely needs no project directory is the new one.
    expect(CAPABILITIES.find((c) => c.name === 'remote.add')?.needsProjectDir).toBe(false);
  });
});
