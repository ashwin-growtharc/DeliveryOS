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
});
