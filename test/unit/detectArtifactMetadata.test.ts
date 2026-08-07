import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectArtifactMetadata } from '../../src/engine/scan/detectArtifactMetadata';

describe('detectArtifactMetadata (Phase 10 item 3, extended)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-detect-metadata-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ui-component: pulls description from a real JSDoc comment, plus install_params and stacks together', () => {
    fs.writeFileSync(
      path.join(dir, 'Widget.tsx'),
      [
        "import { useState } from 'react';",
        'export interface WidgetProps { label: string }',
        '',
        '/** A small counter widget. */',
        'export function Widget({ label }: WidgetProps) {',
        '  const [n, setN] = useState(process.env.NEXT_PUBLIC_MAX_COUNT);',
        '  return <button onClick={() => setN(n + 1)}>{label}: {n}</button>;',
        '}',
      ].join('\n'),
      'utf-8',
    );

    const result = detectArtifactMetadata(dir, 'ui-component');
    expect(result.description).toBe('A small counter widget.');
    expect(result.stacks).toEqual(['react', 'typescript']);
    expect(result.installParams.map((p) => p.key)).toEqual(['NEXT_PUBLIC_MAX_COUNT']);
  });

  it('ui-component with no JSDoc comment: description is undefined, never fabricated', () => {
    fs.writeFileSync(
      path.join(dir, 'Widget.tsx'),
      "export interface WidgetProps { label: string }\nexport function Widget({ label }: WidgetProps) { return <span>{label}</span>; }\n",
      'utf-8',
    );
    expect(detectArtifactMetadata(dir, 'ui-component').description).toBeUndefined();
  });

  it('agent (a single markdown file): description comes from real frontmatter', () => {
    const filePath = path.join(dir, 'reviewer.md');
    fs.writeFileSync(filePath, '---\ndescription: Reviews pull requests for style issues.\n---\nBody text.\n', 'utf-8');
    const result = detectArtifactMetadata(filePath, 'agent');
    expect(result.description).toBe('Reviews pull requests for style issues.');
  });

  it('skill (a directory with SKILL.md): description comes from the real SKILL.md frontmatter', () => {
    fs.mkdirSync(path.join(dir, 'my-skill'));
    fs.writeFileSync(
      path.join(dir, 'my-skill', 'SKILL.md'),
      '---\ndescription: Runs the project\'s status checks.\n---\nBody text.\n',
      'utf-8',
    );
    const result = detectArtifactMetadata(path.join(dir, 'my-skill'), 'skill');
    expect(result.description).toBe("Runs the project's status checks.");
  });

  it('skill directory with no SKILL.md: description is undefined, not an error', () => {
    fs.mkdirSync(path.join(dir, 'empty-skill'));
    const result = detectArtifactMetadata(path.join(dir, 'empty-skill'), 'skill');
    expect(result.description).toBeUndefined();
  });

  it('backend-plugin (freeform payload): description falls back to a real leading comment, plus real stacks/install_params', () => {
    fs.writeFileSync(
      path.join(dir, 'index.ts'),
      [
        '/** Email/password auth via a Prisma adapter. */',
        "import { PrismaClient } from '@prisma/client';",
        'const secret = process.env.AUTH_SECRET;',
        'export const auth = { secret };',
      ].join('\n'),
      'utf-8',
    );

    const result = detectArtifactMetadata(dir, 'backend-plugin');
    expect(result.description).toBe('Email/password auth via a Prisma adapter.');
    expect(result.stacks).toEqual(['prisma', 'typescript']);
    expect(result.installParams.map((p) => p.key)).toEqual(['AUTH_SECRET']);
  });

  it('backend-plugin with no leading comment and no env vars: description undefined, install_params empty -- an honest, non-fabricated result', () => {
    fs.writeFileSync(path.join(dir, 'index.ts'), "import { PrismaClient } from '@prisma/client';\nexport const db = new PrismaClient();\n", 'utf-8');
    const result = detectArtifactMetadata(dir, 'backend-plugin');
    expect(result.description).toBeUndefined();
    expect(result.installParams).toEqual([]);
    expect(result.stacks).toEqual(['prisma', 'typescript']);
  });
});
