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

  it('has the files the shape requires, and no others', () => {
    // Pinned as a list rather than a count, so a new file is a deliberate
    // addition rather than a silent one. `contributionToken.ts` is the fourth:
    // it holds the single-use grant that binds a push to a preview, and it is
    // here rather than in the engine because the nonce that makes it fail
    // CLOSED across a restart is a property of this server process, not of
    // DeliveryOS. It imports `PushPlan` as a type only, so the boundary rules
    // below still cover it.
    expect(files.sort()).toEqual([
      'contributionToken.ts',
      'engineAdapter.ts',
      'ports.ts',
      'server.ts',
    ]);
  });

  it.each(['server.ts', 'ports.ts', 'contributionToken.ts'])(
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

  /** Every method name declared on `DeliveryOsReadPort`, in source order.
   *
   * Read from the interface body rather than the whole file, so a method on
   * some other type cannot satisfy or trip the assertion below. */
  function declaredPortMethods(): string[] {
    const source = fs.readFileSync(path.join(MCP_DIR, 'ports.ts'), 'utf-8');
    const start = source.indexOf('export interface DeliveryOsReadPort {');
    // Anti-vacuity: if the interface is renamed or removed, this test must
    // FAIL rather than quietly find zero methods and report success. The guard
    // that checks nothing is worse than no guard, because it reads as one.
    expect(start, 'DeliveryOsReadPort not found in ports.ts -- this guard is checking nothing').toBeGreaterThan(-1);

    const body = source.slice(start, source.indexOf('\n}', start));
    const names = [...body.matchAll(/^ {2}(\w+)\s*\(/gm)].map((m) => m[1]);
    expect(names.length, 'parsed zero methods off DeliveryOsReadPort -- the parser is broken, not the port').toBeGreaterThan(0);
    return names;
  }

  it('exposes exactly the three read operations on the port, and nothing else', () => {
    // An ALLOWLIST, not a denylist of suspicious-looking names.
    //
    // The previous version of this test matched seven substrings
    // (pull|push|remove|install|write|delete|apply). It would have waved
    // through `readInstallParamValues` -- which returns raw `.env.local`
    // values including secrets -- and equally `configure`, `set`, `run` and
    // `exec`. It asserted a naming convention while claiming to assert a
    // property, which is the failure mode where a guard reads as protection
    // and is not.
    //
    // Naming the permitted set instead means ANY new method fails this test,
    // including one nobody thought to forbid. Widening the port then requires
    // editing this list, which is exactly where the consent question belongs.
    expect(declaredPortMethods().sort()).toEqual(['listCatalog', 'readArtifact', 'refreshCatalog']);
  });

  it('keeps the port free of anything that returns secrets', () => {
    // Separate from the allowlist above because it survives a deliberate
    // widening: if someone adds a legitimate method later, they must still not
    // add this one. `artifact.readInstallParamValues` (sidecar.ts) returns the
    // project's real `.env.local` values -- the whole point of `secret: true`
    // in the manifest schema is that those never reach a model.
    for (const banned of ['readInstallParamValues', 'installParamValues', 'readEnv', 'secrets']) {
      expect(
        declaredPortMethods(),
        `"${banned}" would put real secret values into model context.`,
      ).not.toContain(banned);
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
