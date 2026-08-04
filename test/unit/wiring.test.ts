import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveWiringActions } from '../../src/engine/pull/wiring';
import { WiringAction } from '../../src/engine/manifest/schema';

const AUTH_TS_ACTION: WiringAction = {
  type: 'suggest_snippet',
  description: 'Wire up the root Auth.js entry point',
  targetFile: 'auth.ts',
  whenAbsent: {
    instructions: 'Create auth.ts at your project root with this content.',
    snippet: 'export const { handlers, auth } = NextAuth(authConfig);',
  },
  // no whenPresent -- "already exists, review before touching it"
};

const MIDDLEWARE_ACTION: WiringAction = {
  type: 'suggest_snippet',
  description: 'Wire up the auth middleware',
  targetFile: 'middleware.ts',
  whenAbsent: {
    instructions: 'Create middleware.ts at your project root with this content.',
    snippet: 'export { auth as middleware } from "./auth";',
  },
  whenPresent: {
    instructions: 'Merge the auth re-export and matcher entry into your existing middleware.ts.',
  },
};

describe('resolveWiringActions', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-wiring-test-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('resolves targetFile against cwd (project root), never install_target-relative -- confirmed by a nested subdir NOT matching', () => {
    const nestedDir = path.join(cwd, 'src', 'lib', 'auth');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, 'auth.ts'), 'this is NOT the root auth.ts', 'utf-8');

    const [resolved] = resolveWiringActions([AUTH_TS_ACTION], cwd);
    // The nested file exists, but at src/lib/auth/auth.ts, not <cwd>/auth.ts
    // -- resolution must be against cwd directly, so this must still report
    // "absent."
    expect(resolved.targetFileExists).toBe(false);
  });

  it('returns the whenAbsent variant when the target file genuinely does not exist', () => {
    const [resolved] = resolveWiringActions([AUTH_TS_ACTION], cwd);
    expect(resolved.targetFileExists).toBe(false);
    expect(resolved.snippet).toBe('export const { handlers, auth } = NextAuth(authConfig);');
    expect(resolved.instructions).toContain('Create auth.ts');
  });

  it('returns the whenPresent variant (with its own snippet) when the target file exists and whenPresent was declared', () => {
    fs.writeFileSync(path.join(cwd, 'middleware.ts'), 'export default function middleware() {}', 'utf-8');

    const [resolved] = resolveWiringActions([MIDDLEWARE_ACTION], cwd);
    expect(resolved.targetFileExists).toBe(true);
    expect(resolved.snippet).toBeUndefined();
    expect(resolved.instructions).toContain('Merge the auth re-export');
  });

  it('falls back to a "review before touching it" instruction, no snippet, when the file exists and no whenPresent was declared', () => {
    fs.writeFileSync(path.join(cwd, 'auth.ts'), 'export default function auth() {}', 'utf-8');

    const [resolved] = resolveWiringActions([AUTH_TS_ACTION], cwd);
    expect(resolved.targetFileExists).toBe(true);
    expect(resolved.snippet).toBeUndefined();
    expect(resolved.instructions).toContain('already exists');
    expect(resolved.instructions).toContain('auth.ts');
  });

  it('resolves multiple actions independently -- one absent, one present, in the same call', () => {
    fs.writeFileSync(path.join(cwd, 'middleware.ts'), 'export default function middleware() {}', 'utf-8');

    const resolved = resolveWiringActions([AUTH_TS_ACTION, MIDDLEWARE_ACTION], cwd);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].targetFile).toBe('auth.ts');
    expect(resolved[0].targetFileExists).toBe(false);
    expect(resolved[1].targetFile).toBe('middleware.ts');
    expect(resolved[1].targetFileExists).toBe(true);
  });

  it('an empty wiring_actions array resolves to an empty list, not an error', () => {
    expect(resolveWiringActions([], cwd)).toEqual([]);
  });

  it('never mutates the filesystem -- purely read-only detection', () => {
    resolveWiringActions([AUTH_TS_ACTION, MIDDLEWARE_ACTION], cwd);
    expect(fs.readdirSync(cwd)).toEqual([]);
  });
});
