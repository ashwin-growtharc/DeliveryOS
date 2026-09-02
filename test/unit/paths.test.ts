import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveContainedPath,
  remoteCachePath,
  remotesCacheRoot,
  adaptSrcDirPath,
  ensureProjectDeliveryOsDir,
  pristinePath,
  pristineDir,
} from '../../src/engine/paths';

describe('resolveContainedPath', () => {
  it('resolves an ordinary relative path inside root', () => {
    const root = path.join('a', 'b', 'c');
    expect(resolveContainedPath(root, 'sub/file.txt')).toBe(path.resolve(root, 'sub/file.txt'));
  });

  it('resolves root itself (candidate ".")', () => {
    const root = path.join('a', 'b', 'c');
    expect(resolveContainedPath(root, '.')).toBe(path.resolve(root));
  });

  it('returns undefined for a relative candidate that escapes root via ../..', () => {
    // Nested deeply so the escape can't accidentally land back inside a
    // short root -- same reasoning as payloadDir.test.ts's own traversal
    // trap test.
    const root = path.join('tmp-root', 'a', 'b', 'c', 'd');
    expect(resolveContainedPath(root, '../../../../../../etc/passwd')).toBeUndefined();
  });

  it('returns undefined for an absolute candidate outside root, even with no ../ at all', () => {
    const root = path.resolve('some', 'project', 'root');
    const outsideAbsolute = path.resolve('some', 'totally', 'different', 'place');
    expect(resolveContainedPath(root, outsideAbsolute)).toBeUndefined();
  });

  it('resolves an absolute candidate that genuinely is inside root', () => {
    const root = path.resolve('some', 'project', 'root');
    const insideAbsolute = path.join(root, 'nested', 'file.txt');
    expect(resolveContainedPath(root, insideAbsolute)).toBe(insideAbsolute);
  });

  // Regression guard for the whole-project-delete bug: `removeArtifact`
  // feeds this function's result straight into a recursive delete, so a
  // candidate resolving to `root` ITSELF used to mean "delete the user's
  // entire project". Root stays contained by default (payload_path
  // legitimately points at a remote clone's own root); install_target's
  // call sites opt out with allowRoot: false.
  describe('allowRoot: false', () => {
    const root = path.resolve('some', 'project', 'root');

    it('rejects every spelling of root itself', () => {
      // `dotBackslash` is built rather than written literally so the test source stays free of escape ambiguity.
      const dotBackslash = '.' + String.fromCharCode(92);
      for (const candidate of ['.', './', dotBackslash, 'sub/..', './sub/../.', root]) {
        expect(resolveContainedPath(root, candidate, { allowRoot: false })).toBeUndefined();
      }
    });

    it('still resolves a genuine subdirectory', () => {
      expect(resolveContainedPath(root, 'design-kit', { allowRoot: false }))
        .toBe(path.resolve(root, 'design-kit'));
      expect(resolveContainedPath(root, './src/lib/auth', { allowRoot: false }))
        .toBe(path.resolve(root, 'src/lib/auth'));
    });

    it('still rejects an escape, same as with allowRoot left on', () => {
      expect(resolveContainedPath(root, '../../elsewhere', { allowRoot: false })).toBeUndefined();
    });

    it('leaves the default behaviour unchanged (root is contained)', () => {
      expect(resolveContainedPath(root, '.')).toBe(path.resolve(root));
    });
  });
});

describe('remoteCachePath', () => {
  it('joins an ordinary remote name under remotesCacheRoot() as before', () => {
    expect(remoteCachePath('my-remote')).toBe(path.join(remotesCacheRoot(), 'my-remote'));
  });

  it('rejects a name containing a path separator, refusing to resolve outside remotesCacheRoot()', () => {
    expect(() => remoteCachePath('../../../SomeFolder')).toThrow(/Invalid remote name/);
    expect(() => remoteCachePath('a/b')).toThrow(/Invalid remote name/);
    expect(() => remoteCachePath('a\\b')).toThrow(/Invalid remote name/);
  });

  it('rejects "." and ".." outright, and an empty name', () => {
    expect(() => remoteCachePath('.')).toThrow(/Invalid remote name/);
    expect(() => remoteCachePath('..')).toThrow(/Invalid remote name/);
    expect(() => remoteCachePath('')).toThrow(/Invalid remote name/);
  });
});

describe('pristinePath', () => {
  it('joins an ordinary id under pristineDir as before', () => {
    const cwd = path.join(os.tmpdir(), 'deliveryos-pristine-path-test');
    expect(pristinePath(cwd, 'my-artifact')).toBe(path.join(pristineDir(cwd), 'my-artifact'));
  });

  // `id` here originates from a lockfile entry -- a plain project-local JSON
  // file anyone can hand-edit -- and removeArtifact feeds the result straight
  // into fs.rmSync(recursive, force). Sanitized the same way remoteCachePath,
  // wireContextPath and previewCachePath already sanitize their own segments;
  // this function was the one sibling that did not.
  it('rejects a traversing or separator-bearing id, refusing to resolve outside pristineDir', () => {
    const cwd = path.join(os.tmpdir(), 'deliveryos-pristine-path-test');
    expect(() => pristinePath(cwd, '../../../SomeFolder')).toThrow(/Invalid artifact id/);
    expect(() => pristinePath(cwd, 'a/b')).toThrow(/Invalid artifact id/);
    expect(() => pristinePath(cwd, 'a\\b')).toThrow(/Invalid artifact id/);
  });

  it('rejects "." and ".." outright, and an empty id', () => {
    const cwd = path.join(os.tmpdir(), 'deliveryos-pristine-path-test');
    expect(() => pristinePath(cwd, '.')).toThrow(/Invalid artifact id/);
    expect(() => pristinePath(cwd, '..')).toThrow(/Invalid artifact id/);
    expect(() => pristinePath(cwd, '')).toThrow(/Invalid artifact id/);
  });
});

describe('adaptSrcDirPath', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-adapt-src-dir-test-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('leaves a path with no src/ prefix untouched, regardless of project layout', () => {
    expect(adaptSrcDirPath(cwd, 'auth.ts')).toBe('auth.ts');
    expect(adaptSrcDirPath(cwd, 'middleware.ts')).toBe('middleware.ts');
  });

  it('strips the src/ prefix when the project has a root app/ directory', () => {
    fs.mkdirSync(path.join(cwd, 'app'), { recursive: true });
    expect(adaptSrcDirPath(cwd, 'src/app/api/auth/[...nextauth]/route.ts')).toBe(
      'app/api/auth/[...nextauth]/route.ts',
    );
    expect(adaptSrcDirPath(cwd, 'src/lib/auth')).toBe('lib/auth');
  });

  it('strips the src/ prefix when the project has a root pages/ directory', () => {
    fs.mkdirSync(path.join(cwd, 'pages'), { recursive: true });
    expect(adaptSrcDirPath(cwd, 'src/app/api/auth/[...nextauth]/route.ts')).toBe(
      'app/api/auth/[...nextauth]/route.ts',
    );
  });

  it('keeps the src/ prefix as-is when the project has a src/app directory', () => {
    fs.mkdirSync(path.join(cwd, 'src', 'app'), { recursive: true });
    expect(adaptSrcDirPath(cwd, 'src/app/api/auth/[...nextauth]/route.ts')).toBe(
      'src/app/api/auth/[...nextauth]/route.ts',
    );
  });

  it('keeps the src/ prefix as-is when the project has a src/pages directory', () => {
    fs.mkdirSync(path.join(cwd, 'src', 'pages'), { recursive: true });
    expect(adaptSrcDirPath(cwd, 'src/lib/auth')).toBe('src/lib/auth');
  });

  it('prefers root app/ over src/app when a project genuinely has both', () => {
    fs.mkdirSync(path.join(cwd, 'app'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'src', 'app'), { recursive: true });
    expect(adaptSrcDirPath(cwd, 'src/lib/auth')).toBe('lib/auth');
  });

  it('returns undefined when neither convention is detectable yet', () => {
    expect(adaptSrcDirPath(cwd, 'src/lib/auth')).toBeUndefined();
    expect(adaptSrcDirPath(cwd, 'src/app/api/auth/[...nextauth]/route.ts')).toBeUndefined();
  });
});

describe('ensureProjectDeliveryOsDir', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-ensure-dir-test-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  // `.deliveryos/` holds lock.json (which records ABSOLUTE installTarget and
  // wiredFiles paths), a second full copy of every pulled payload under
  // pristine/, and audit logs containing the full text of real project files.
  // None of it is portable and none of it should be committed -- acting on a
  // lockfile from another clone is what made `push` diff a directory that does
  // not exist and propose deleting an artifact's payload upstream.
  it('creates the directory with a .gitignore that ignores the whole directory', () => {
    const dir = ensureProjectDeliveryOsDir(cwd);

    expect(dir).toBe(path.join(cwd, '.deliveryos'));
    expect(fs.existsSync(dir)).toBe(true);
    const ignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8');
    expect(ignore.split('\n').filter((l) => l.trim() && !l.startsWith('#'))).toEqual(['*']);
  });

  it('is idempotent, and never overwrites a .gitignore someone deliberately changed', () => {
    ensureProjectDeliveryOsDir(cwd);
    const ignorePath = path.join(cwd, '.deliveryos', '.gitignore');
    fs.writeFileSync(ignorePath, '# I know what I am doing\n', 'utf-8');

    ensureProjectDeliveryOsDir(cwd);

    // Re-imposing it on every write would be the tool arguing with a choice
    // the user already made.
    expect(fs.readFileSync(ignorePath, 'utf-8')).toBe('# I know what I am doing\n');
  });

  it('works when the project has no .gitignore of its own at all', () => {
    expect(fs.existsSync(path.join(cwd, '.gitignore'))).toBe(false);

    ensureProjectDeliveryOsDir(cwd);

    // Deliberately does NOT create or edit the project's own .gitignore --
    // that file belongs to whoever owns the repo.
    expect(fs.existsSync(path.join(cwd, '.gitignore'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.deliveryos', '.gitignore'))).toBe(true);
  });
});
