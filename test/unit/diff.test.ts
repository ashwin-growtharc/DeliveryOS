import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeChangedFiles, listFilesRecursive } from '../../src/engine/push/diff';
import { PristineSnapshotMissingError } from '../../src/engine/errors';

let installTarget: string;
let pristineDir: string;

function write(root: string, relPath: string, content: string): void {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

beforeEach(() => {
  installTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-diff-live-'));
  pristineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-diff-pristine-'));
});

afterEach(() => {
  fs.rmSync(installTarget, { recursive: true, force: true });
  fs.rmSync(pristineDir, { recursive: true, force: true });
});

describe('computeChangedFiles', () => {
  it('reports no changes when live is byte-for-byte identical to pristine', () => {
    write(pristineDir, 'README.md', 'hello\n');
    write(installTarget, 'README.md', 'hello\n');

    expect(computeChangedFiles(installTarget, pristineDir)).toEqual([]);
  });

  it('detects an added file', () => {
    write(pristineDir, 'README.md', 'hello\n');
    write(installTarget, 'README.md', 'hello\n');
    write(installTarget, 'new.txt', 'new content\n');

    expect(computeChangedFiles(installTarget, pristineDir)).toEqual([
      { relPath: 'new.txt', status: 'added' },
    ]);
  });

  it('detects a modified file (content differs, same path)', () => {
    write(pristineDir, 'README.md', 'hello\n');
    write(installTarget, 'README.md', 'hello world\n');

    expect(computeChangedFiles(installTarget, pristineDir)).toEqual([
      { relPath: 'README.md', status: 'modified' },
    ]);
  });

  it('detects a deleted file', () => {
    write(pristineDir, 'README.md', 'hello\n');
    write(pristineDir, 'keep.txt', 'keep\n');
    write(installTarget, 'keep.txt', 'keep\n');

    expect(computeChangedFiles(installTarget, pristineDir)).toEqual([
      { relPath: 'README.md', status: 'deleted' },
    ]);
  });

  it('detects a mix of added/modified/deleted, sorted by relative path', () => {
    write(pristineDir, 'a.txt', 'a\n');
    write(pristineDir, 'b.txt', 'b\n');
    write(installTarget, 'a.txt', 'a changed\n');
    write(installTarget, 'c.txt', 'c\n');
    // b.txt is absent from installTarget -> deleted

    expect(computeChangedFiles(installTarget, pristineDir)).toEqual([
      { relPath: 'a.txt', status: 'modified' },
      { relPath: 'b.txt', status: 'deleted' },
      { relPath: 'c.txt', status: 'added' },
    ]);
  });

  it('detects changes in nested directories', () => {
    write(pristineDir, 'nested/keep.txt', 'keep\n');
    write(installTarget, 'nested/keep.txt', 'keep\n');
    write(installTarget, 'nested/deeper/new.txt', 'new\n');

    expect(computeChangedFiles(installTarget, pristineDir)).toEqual([
      { relPath: 'nested/deeper/new.txt', status: 'added' },
    ]);
  });

  it('throws PristineSnapshotMissingError when the pristine dir does not exist at all', () => {
    fs.rmSync(pristineDir, { recursive: true, force: true });
    write(installTarget, 'a.txt', 'a\n');

    expect(() => computeChangedFiles(installTarget, pristineDir)).toThrow(
      PristineSnapshotMissingError,
    );
  });
});

describe('listFilesRecursive', () => {
  it('lists nested files as forward-slash relative paths', () => {
    write(installTarget, 'a.txt', 'a');
    write(installTarget, 'nested/b.txt', 'b');
    write(installTarget, 'nested/deeper/c.txt', 'c');

    expect(listFilesRecursive(installTarget).sort()).toEqual([
      'a.txt',
      'nested/b.txt',
      'nested/deeper/c.txt',
    ]);
  });

  it('returns an empty array for a nonexistent root', () => {
    expect(listFilesRecursive(path.join(installTarget, 'does-not-exist'))).toEqual([]);
  });
});
