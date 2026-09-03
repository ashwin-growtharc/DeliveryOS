import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The hexagonal claim, checked rather than asserted in a comment.
 *
 * `src/mcp/` is a driving adapter over the DeliveryOS core, in the same role
 * the CLI and the Tauri sidecar already play. What makes it an adapter rather
 * than just another folder is that the tool layer talks to a declared port
 * (`ports.ts`) and one file (`engineAdapter.ts`) binds that port to
 * `src/engine/**`. If `server.ts` starts importing engine functions directly,
 * the seam is gone, the fake port in `mcp.server.test.ts` stops resembling
 * production, and those tests quietly stop meaning anything -- while still
 * passing. That is the failure this file exists to make loud.
 *
 * Type-only imports are allowed everywhere: the port deliberately speaks in
 * the core's own domain types, and a type cannot carry behaviour.
 */

const MCP_DIR = path.join(__dirname, '..', '..', 'src', 'mcp');

/** The single file permitted to reach the core at runtime. */
const COMPOSITION_FILES = new Set(['engineAdapter.ts']);

function engineValueImports(source: string): string[] {
  const found: string[] = [];
  // `import ... from '../engine/...'` where the statement is NOT `import type`.
  //
  // `[^;]*?` rather than `[\s\S]*?`: an import statement may wrap over several
  // lines but can never contain a semicolon, so this cannot run past the end
  // of one statement into the next. The permissive version matched `import {
  // McpServer } from '@modelcontextprotocol/...'` on line 1 all the way to the
  // `from '../engine/...'` four lines below it, and reported a clean file as a
  // violation.
  const pattern = /^import\s+(?!type\s)([^;]*?)from\s+'(\.\.\/engine\/[^']+)';/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    found.push(match[2]);
  }
  return found;
}

describe('MCP adapter boundary', () => {
  const files = fs.readdirSync(MCP_DIR).filter((f) => f.endsWith('.ts'));

  it('has the three files the shape requires', () => {
    expect(files.sort()).toEqual(['engineAdapter.ts', 'ports.ts', 'server.ts']);
  });

  it.each(['server.ts', 'ports.ts'])(
    '%s reaches the core only for types, never for behaviour',
    (file) => {
      const source = fs.readFileSync(path.join(MCP_DIR, file), 'utf-8');
      expect(
        engineValueImports(source),
        `${file} imports engine behaviour directly -- route it through DeliveryOsReadPort instead, `
          + 'or the fake port in mcp.server.test.ts no longer resembles production.',
      ).toEqual([]);
    },
  );

  it('keeps every runtime dependency on the core in exactly one file', () => {
    const reaching = files.filter((f) => engineValueImports(fs.readFileSync(path.join(MCP_DIR, f), 'utf-8')).length > 0);
    expect(reaching).toEqual([...COMPOSITION_FILES]);
  });

  it('exposes no mutating operation on the port', () => {
    // Read-only is a property of the INTERFACE, not just of today's tool list.
    // Adding `pull` here would let a future tool write to a person's project
    // without anyone revisiting the consent question that decision deserves.
    const source = fs.readFileSync(path.join(MCP_DIR, 'ports.ts'), 'utf-8');
    for (const forbidden of ['pull', 'push', 'remove', 'install', 'write', 'delete', 'apply']) {
      expect(
        new RegExp(`^\\s{2}${forbidden}\\w*\\s*\\(`, 'im').test(source),
        `DeliveryOsReadPort declares a "${forbidden}"-shaped method. Mutation through an agent is a `
          + 'separate decision with its own consent model, not a widening of this interface.',
      ).toBe(false);
    }
  });

  it('is stdio-only, because the cwd-as-tool-argument decision depends on it', () => {
    // This is the fourth structural gate, and it exists to stop a safety
    // argument from being silently inherited.
    //
    // `docs/agent-surface-plan.md` Stage 2 required session-configured project
    // scope. This surface takes `cwd` as a tool argument instead, and the
    // justification is written in `engineAdapter.ts`: the residual exposure is
    // "an existence oracle over paths the calling agent can almost always
    // already stat itself."
    //
    // That sentence is only true because the transport is stdio and the client
    // is a local process with its own filesystem access. Add a streamable-HTTP
    // or SSE transport and the caller is remote: an agent-supplied `cwd` then
    // probes the SERVER's filesystem, which it could not otherwise reach, and
    // the argument quietly stops holding while the code still reads as safe.
    //
    // This is the same failure shape as the `needsApproval` bug recorded in
    // PLAN.md's Phase 16 -- a gate that holds on one surface and is assumed to
    // hold on all of them. Whoever adds a second transport has to delete this
    // test, and deleting it is where the cwd decision gets re-examined.
    const sources = files.map((f) => fs.readFileSync(path.join(MCP_DIR, f), 'utf-8'));

    for (const transport of ['streamableHttp', 'sse']) {
      const importers = files.filter((f, i) => sources[i].includes(`/${transport}.js`));
      expect(
        importers,
        `src/mcp/ imports the ${transport} transport. The cwd-as-tool-argument decision was made `
          + 'for a LOCAL stdio client and does not carry over to a remote one -- re-read the '
          + 'rationale in engineAdapter.ts before allowing this.',
      ).toEqual([]);
    }

    // And the stdio transport IS what it connects with, so the rule above is
    // about a real property rather than an absence.
    expect(sources.some((s) => s.includes('server/stdio.js'))).toBe(true);
  });

  it('never writes to stdout from the MCP or engine layers', () => {
    // Belt to the ESLint rule's braces. stdout is the JSON-RPC wire; a stray
    // `console.log` corrupts the stream and surfaces to the user as a parse
    // error far from its cause. `src/sidecar.ts:5-8` asserted this in a
    // comment for months with nothing enforcing it.
    const roots = [MCP_DIR, path.join(__dirname, '..', '..', 'src', 'engine')];
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        // `*.generated.ts` is codegen output that embeds vendored library
        // source (the React runtime, xterm) as string literals -- that code
        // contains `console.*` of its own and is never executed by the engine
        // in a process that speaks JSON-RPC. The rule is about what people
        // write here, which is also exactly what the ESLint rule can reach.
        else if (name.endsWith('.ts') && !name.endsWith('.generated.ts')) {
          const source = fs.readFileSync(full, 'utf-8');
          // Strip comments first -- several engine files legitimately discuss
          // console.log in prose explaining why they don't call it.
          const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
          if (/\bconsole\.\w+\(|\bprocess\.stdout\.write\(/.test(code)) offenders.push(full);
        }
      }
    };
    for (const root of roots) walk(root);

    expect(offenders).toEqual([]);
  });
});
