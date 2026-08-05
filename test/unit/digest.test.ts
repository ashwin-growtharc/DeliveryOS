import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computePayloadDigest } from '../../src/engine/provenance/digest';

describe('computePayloadDigest', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-digest-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is a sha256:<hex> string', () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
    const digest = computePayloadDigest(dir);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is stable across repeated calls on the same content', () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), 'world');

    expect(computePayloadDigest(dir)).toBe(computePayloadDigest(dir));
  });

  it('is independent of file system traversal order (readdir order doesn\'t matter)', () => {
    // Write in one order...
    fs.writeFileSync(path.join(dir, 'z.txt'), 'z-content');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a-content');
    const digestA = computePayloadDigest(dir);
    fs.rmSync(dir, { recursive: true, force: true });

    // ...and the reverse order in a fresh directory.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-digest-test-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a-content');
    fs.writeFileSync(path.join(dir, 'z.txt'), 'z-content');
    const digestB = computePayloadDigest(dir);

    expect(digestA).toBe(digestB);
  });

  it('changes when a file\'s content changes', () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
    const before = computePayloadDigest(dir);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello!');
    const after = computePayloadDigest(dir);
    expect(before).not.toBe(after);
  });

  it('changes when a file is added or removed', () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
    const before = computePayloadDigest(dir);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'extra');
    const after = computePayloadDigest(dir);
    expect(before).not.toBe(after);
  });

  it('distinguishes a file being renamed from its content alone (path is part of the digest)', () => {
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'a.txt'), 'same-content');
    const nested = computePayloadDigest(dir);
    fs.rmSync(dir, { recursive: true, force: true });

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-digest-test-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'same-content');
    const flat = computePayloadDigest(dir);

    expect(nested).not.toBe(flat);
  });

  it('handles a single-file payload (not a directory), matching a real supported payload shape', () => {
    const filePath = path.join(dir, 'single.txt');
    fs.writeFileSync(filePath, 'single file content');
    const digest = computePayloadDigest(filePath);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Stable on repeated calls, same as the directory case.
    expect(computePayloadDigest(filePath)).toBe(digest);
  });

  it('an empty directory still produces a valid (well-defined) digest', () => {
    const digest = computePayloadDigest(dir);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
