import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { resolveContainedPath, remoteCachePath, remotesCacheRoot } from '../../src/engine/paths';

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
