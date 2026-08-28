import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveContainedPath,
  remoteCachePath,
  remotesCacheRoot,
  adaptSrcDirPath,
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
