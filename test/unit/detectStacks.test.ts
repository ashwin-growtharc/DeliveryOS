import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectStacks } from '../../src/engine/scan/detectStacks';

describe('detectStacks (Phase 10 item 3, extended)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-detect-stacks-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('detects nextjs from a real `next` import', () => {
    fs.writeFileSync(path.join(dir, 'page.tsx'), "import Link from 'next/link';\n", 'utf-8');
    expect(detectStacks(dir)).toEqual(['nextjs', 'typescript']);
  });

  it('detects react from a real `react` import', () => {
    fs.writeFileSync(path.join(dir, 'a.jsx'), "import { useState } from 'react';\n", 'utf-8');
    expect(detectStacks(dir)).toEqual(['javascript', 'react']);
  });

  it('detects prisma from a real `.prisma` schema file, matching the real nextauth-credentials shape', () => {
    fs.writeFileSync(
      path.join(dir, 'schema.prisma'),
      'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(dir, 'auth.ts'), "import NextAuth from 'next-auth';\n", 'utf-8');
    const result = detectStacks(dir);
    expect(result).toContain('prisma');
    expect(result).toContain('typescript');
  });

  it('detects prisma from a real `@prisma/client` dependency in package.json', () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { '@prisma/client': '^5.0.0' } }),
      'utf-8',
    );
    expect(detectStacks(dir)).toEqual(['prisma']);
  });

  it('detects express from a real `require(\'express\')` call', () => {
    fs.writeFileSync(path.join(dir, 'server.js'), "const express = require('express');\n", 'utf-8');
    expect(detectStacks(dir)).toEqual(['express', 'javascript']);
  });

  it('infers typescript from .tsx/.ts files present, even with no matching package import', () => {
    fs.writeFileSync(path.join(dir, 'util.ts'), 'export const x = 1;\n', 'utf-8');
    expect(detectStacks(dir)).toEqual(['typescript']);
  });

  it('infers javascript (not typescript) when only .js/.jsx files are present', () => {
    fs.writeFileSync(path.join(dir, 'util.js'), 'module.exports = { x: 1 };\n', 'utf-8');
    expect(detectStacks(dir)).toEqual(['javascript']);
  });

  it('prefers typescript over javascript when both extensions are present in the same payload', () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const x = 1;\n', 'utf-8');
    fs.writeFileSync(path.join(dir, 'b.js'), 'module.exports = { y: 1 };\n', 'utf-8');
    expect(detectStacks(dir)).toEqual(['typescript']);
  });

  it('an unrelated import (not in the known table) is never invented as a stack tag', () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), "import { z } from 'zod';\n", 'utf-8');
    expect(detectStacks(dir)).toEqual(['typescript']);
  });

  it('handles a single-file payload (not a directory)', () => {
    const filePath = path.join(dir, 'component.tsx');
    fs.writeFileSync(filePath, "import { useState } from 'react';\n", 'utf-8');
    expect(detectStacks(filePath)).toEqual(['react', 'typescript']);
  });

  it('skips node_modules and dotfiles, matching detectInstallParams\' own convention', () => {
    fs.mkdirSync(path.join(dir, 'node_modules', 'express'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'express', 'index.js'), "require('express');\n", 'utf-8');
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const x = 1;\n', 'utf-8');
    expect(detectStacks(dir)).toEqual(['typescript']);
  });

  it('a malformed package.json does not stop detection in the rest of the payload', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{ not valid json', 'utf-8');
    fs.writeFileSync(path.join(dir, 'a.ts'), "import 'react';\n", 'utf-8');
    expect(detectStacks(dir)).toEqual(['react', 'typescript']);
  });

  it('an empty payload with no recognizable signal detects nothing', () => {
    fs.writeFileSync(path.join(dir, 'readme.md'), 'Nothing here.\n', 'utf-8');
    expect(detectStacks(dir)).toEqual([]);
  });
});
