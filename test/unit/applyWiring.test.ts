import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyDeterministicWiring } from '../../src/engine/pull/applyWiring';
import { ResolvedWiringAction } from '../../src/engine/pull/wiring';

describe('applyDeterministicWiring (Phase 10 item 1)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-apply-wiring-test-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('writes a fresh (whenAbsent-shaped) action verbatim to its target file', () => {
    const resolved: ResolvedWiringAction[] = [
      {
        description: 'Wire up auth.ts',
        targetFile: 'src/auth.ts',
        targetFileExists: false,
        instructions: 'Create it.',
        snippet: 'export const auth = 1;\n',
      },
    ];

    const result = applyDeterministicWiring(resolved, cwd);

    expect(result.applied).toEqual(['src/auth.ts']);
    expect(result.needsReview).toEqual([]);
    expect(fs.readFileSync(path.join(cwd, 'src/auth.ts'), 'utf-8')).toBe('export const auth = 1;\n');
  });

  it('creates parent directories that do not exist yet', () => {
    const resolved: ResolvedWiringAction[] = [
      {
        description: 'Wire up the API route',
        targetFile: 'src/app/api/auth/[...nextauth]/route.ts',
        targetFileExists: false,
        instructions: 'Create it.',
        snippet: 'export const GET = 1;\n',
      },
    ];

    applyDeterministicWiring(resolved, cwd);

    expect(fs.existsSync(path.join(cwd, 'src/app/api/auth/[...nextauth]/route.ts'))).toBe(true);
  });

  it('never touches a file that already exists, even when a whenPresent snippet is offered', () => {
    fs.mkdirSync(path.join(cwd, 'src/app'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src/app/layout.tsx'), 'export default function Layout() {}\n', 'utf-8');

    const resolved: ResolvedWiringAction[] = [
      {
        description: 'Wrap layout in SessionProvider',
        targetFile: 'src/app/layout.tsx',
        targetFileExists: true,
        instructions: 'Wrap children in <SessionProvider>.',
        snippet: "import { SessionProvider } from 'next-auth/react';\n",
      },
    ];

    const result = applyDeterministicWiring(resolved, cwd);

    expect(result.applied).toEqual([]);
    expect(result.needsReview).toEqual(['src/app/layout.tsx']);
    // Untouched -- still the original content, not overwritten with just the snippet.
    expect(fs.readFileSync(path.join(cwd, 'src/app/layout.tsx'), 'utf-8')).toBe('export default function Layout() {}\n');
  });

  it('reports an existing file with no snippet as needing review too', () => {
    fs.writeFileSync(path.join(cwd, 'middleware.ts'), 'export default function middleware() {}', 'utf-8');

    const resolved: ResolvedWiringAction[] = [
      {
        description: 'Wire up middleware',
        targetFile: 'middleware.ts',
        targetFileExists: true,
        instructions: 'Already exists -- review before replacing it.',
        // no snippet
      },
    ];

    const result = applyDeterministicWiring(resolved, cwd);

    expect(result.applied).toEqual([]);
    expect(result.needsReview).toEqual(['middleware.ts']);
  });

  it('handles a mix of applied and needs-review actions independently, in order', () => {
    fs.writeFileSync(path.join(cwd, 'middleware.ts'), 'export default function middleware() {}', 'utf-8');

    const resolved: ResolvedWiringAction[] = [
      {
        description: 'Wire up auth.ts',
        targetFile: 'auth.ts',
        targetFileExists: false,
        instructions: 'Create it.',
        snippet: 'export const auth = 1;\n',
      },
      {
        description: 'Wire up middleware',
        targetFile: 'middleware.ts',
        targetFileExists: true,
        instructions: 'Already exists.',
      },
      {
        description: 'Wire up the route',
        targetFile: 'route.ts',
        targetFileExists: false,
        instructions: 'Create it.',
        snippet: 'export const GET = 1;\n',
      },
    ];

    const result = applyDeterministicWiring(resolved, cwd);

    expect(result.applied).toEqual(['auth.ts', 'route.ts']);
    expect(result.needsReview).toEqual(['middleware.ts']);
  });

  it('an empty wiring_actions list applies nothing, needs nothing', () => {
    const result = applyDeterministicWiring([], cwd);
    expect(result).toEqual({ applied: [], needsReview: [] });
  });

  it('refuses to write a target_file that escapes cwd via ../ segments, even if targetFileExists were (incorrectly) reported false', () => {
    // A deeply-nested cwd, several real directories under its own unique
    // tmp root -- so "../../../../evil.txt" resolves to somewhere still
    // safely inside that unique, fully-cleaned-up root, never up into the
    // shared OS temp directory or (as a shallower cwd would) the real
    // user home directory. Confirmed the hard way: an earlier version of
    // this test used the shallow per-file `cwd` directly, and
    // `../../../../evil.txt` from a short tmp path resolves only 4 levels
    // up to a FIXED, non-randomized ancestor (e.g. `C:\Users\<name>`) --
    // a real write there, if the fix under test ever regresses, would
    // leak a real file into the developer's home directory and silently
    // pollute every later run of this same test.
    const trapRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-traversal-trap-'));
    const nestedCwd = path.join(trapRoot, 'a', 'b', 'c', 'd', 'project');
    fs.mkdirSync(nestedCwd, { recursive: true });

    try {
      // Simulates a caller handing applyDeterministicWiring a resolved
      // action that somehow bypassed resolveWiringActions' own upstream
      // refusal -- the write site re-validates containment itself
      // (defense in depth), it does not just trust targetFileExists.
      const resolved: ResolvedWiringAction[] = [
        {
          description: 'Malicious action',
          targetFile: '../../../../evil.txt',
          targetFileExists: false,
          instructions: 'Create it.',
          snippet: 'malicious content -- must never be written outside cwd',
        },
      ];

      const result = applyDeterministicWiring(resolved, nestedCwd);

      expect(result.applied).toEqual([]);
      expect(result.needsReview).toEqual(['../../../../evil.txt']);
      // The real proof: nothing was written anywhere outside nestedCwd,
      // including at the exact path a naive path.resolve would have used.
      const outsidePath = path.resolve(nestedCwd, '..', '..', '..', '..', 'evil.txt');
      expect(outsidePath).toBe(path.join(trapRoot, 'a', 'evil.txt'));
      expect(fs.existsSync(outsidePath)).toBe(false);
      expect(fs.readdirSync(nestedCwd)).toEqual([]);
    } finally {
      fs.rmSync(trapRoot, { recursive: true, force: true });
    }
  });

  it('refuses to write an absolute target_file path outright', () => {
    // A fresh, uniquely-named path per run (not a fixed filename) --
    // if this test ever regresses and the write actually happens, a
    // fixed shared tmp filename would leak a stale "it exists" false
    // pass into every subsequent run, masking the regression.
    const outsideFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-applywiring-outside-')),
      'evil.txt',
    );
    try {
      const resolved: ResolvedWiringAction[] = [
        {
          description: 'Malicious absolute-path action',
          targetFile: outsideFile,
          targetFileExists: false,
          instructions: 'Create it.',
          snippet: 'malicious content',
        },
      ];

      const result = applyDeterministicWiring(resolved, cwd);

      expect(result.applied).toEqual([]);
      expect(result.needsReview).toEqual([outsideFile]);
      expect(fs.existsSync(outsideFile)).toBe(false);
    } finally {
      fs.rmSync(path.dirname(outsideFile), { recursive: true, force: true });
    }
  });
});
