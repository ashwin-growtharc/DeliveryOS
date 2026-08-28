import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractLeadingComment } from '../../src/engine/scan/extractLeadingComment';

describe('extractLeadingComment (Phase 10 item 3, extended)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-extract-comment-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('extracts a real leading JSDoc block comment from index.ts', () => {
    fs.writeFileSync(
      path.join(dir, 'index.ts'),
      '/**\n * A small rate limiter for API routes.\n */\nexport function limit() {}\n',
      'utf-8',
    );
    expect(extractLeadingComment(dir)).toBe('A small rate limiter for API routes.');
  });

  it('extracts a real leading // comment block from main.js', () => {
    fs.writeFileSync(
      path.join(dir, 'main.js'),
      '// Boots the worker queue.\n// Retries failed jobs up to 3 times.\nmodule.exports = {};\n',
      'utf-8',
    );
    expect(extractLeadingComment(dir)).toBe('Boots the worker queue. Retries failed jobs up to 3 times.');
  });

  it('returns undefined when the entry file has no leading comment -- never fabricates one', () => {
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export const x = 1;\n', 'utf-8');
    expect(extractLeadingComment(dir)).toBeUndefined();
  });

  it('returns undefined when no conventional entry file exists at all', () => {
    fs.writeFileSync(path.join(dir, 'helper.ts'), '/** Not an entry file. */\nexport const x = 1;\n', 'utf-8');
    expect(extractLeadingComment(dir)).toBeUndefined();
  });

  it('handles a single-file payload directly, real leading comment', () => {
    const filePath = path.join(dir, 'standalone.ts');
    fs.writeFileSync(filePath, '/** A standalone utility. */\nexport const y = 2;\n', 'utf-8');
    expect(extractLeadingComment(filePath)).toBe('A standalone utility.');
  });

  it('strips a UTF-8 BOM before looking for a leading comment', () => {
    fs.writeFileSync(path.join(dir, 'index.ts'), '﻿/** BOM-prefixed comment. */\nexport const x = 1;\n', 'utf-8');
    expect(extractLeadingComment(dir)).toBe('BOM-prefixed comment.');
  });

  it('a comment that only appears after real code (not leading) is not extracted', () => {
    fs.writeFileSync(
      path.join(dir, 'index.ts'),
      'export const x = 1;\n// This comes after code, not before it.\n',
      'utf-8',
    );
    expect(extractLeadingComment(dir)).toBeUndefined();
  });
});
