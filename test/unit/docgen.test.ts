import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractPropsSchemas } from '../../src/engine/preview/docgen';

const buttonDir = path.join(__dirname, '..', 'fixtures', 'preview-spike', 'Button');
const htmlButtonDir = path.join(__dirname, '..', 'fixtures', 'preview-spike', 'HtmlButton');

describe('extractPropsSchemas', () => {
  it('derives a real props schema from the Button fixture via the actual TypeScript compiler', () => {
    const schemas = extractPropsSchemas(buttonDir, path.join(buttonDir, 'preview.tsx'));

    expect(Object.keys(schemas)).toEqual(['Button']);
    const props = schemas.Button;

    const variant = props.find((p) => p.name === 'variant');
    expect(variant).toMatchObject({
      type: '"primary" | "secondary"',
      required: false,
      defaultValue: 'primary',
      enumValues: ['primary', 'secondary'],
    });

    const disabled = props.find((p) => p.name === 'disabled');
    expect(disabled).toMatchObject({
      type: 'boolean',
      required: false,
      defaultValue: 'false',
    });
    expect(disabled?.enumValues).toBeUndefined();

    // react-docgen-typescript excludes `children` by default (no custom
    // JSDoc on it) -- confirms this codebase relies on that built-in
    // behavior rather than needing to filter it out itself.
    expect(props.find((p) => p.name === 'children')).toBeUndefined();
  });

  it('returns {} when no sibling component file exists next to the preview entry', () => {
    // HtmlButton's fixture dir has only preview.html -- no .tsx/.jsx
    // sibling for docgen to run against at all.
    const schemas = extractPropsSchemas(htmlButtonDir, path.join(htmlButtonDir, 'preview.html'));
    expect(schemas).toEqual({});
  });

  it('degrades to {} instead of throwing when the directory does not exist', () => {
    // Proves the "preview fails soft" principle for real: a docgen
    // failure must never take down the whole compile pipeline.
    const schemas = extractPropsSchemas(
      path.join(__dirname, 'nonexistent-directory-for-test'),
      'preview.tsx',
    );
    expect(schemas).toEqual({});
  });

  it('finds a component file nested one level down, not just flat siblings', () => {
    // esbuild's own import sandboxing scopes to the whole directory TREE
    // (a preview.tsx importing './components/Button' compiles fine
    // today), so docgen's own discovery convention has to match that same
    // assumption -- a flat readdirSync would silently find nothing here.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-docgen-nested-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'preview.tsx'), "export const Primary = () => null;\n");
      fs.mkdirSync(path.join(tmpDir, 'components'));
      fs.writeFileSync(
        path.join(tmpDir, 'components', 'Widget.tsx'),
        "export interface WidgetProps { label: string; }\nexport function Widget({ label }: WidgetProps) { return null; }\n",
      );

      const schemas = extractPropsSchemas(tmpDir, path.join(tmpDir, 'preview.tsx'));
      expect(Object.keys(schemas)).toEqual(['Widget']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('one broken sibling file does not blank out another, valid sibling\'s schema', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-docgen-partial-failure-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'preview.tsx'), "export const Primary = () => null;\n");
      fs.writeFileSync(
        path.join(tmpDir, 'Good.tsx'),
        "export interface GoodProps { label: string; }\nexport function Good({ label }: GoodProps) { return null; }\n",
      );
      // Deliberately invalid TypeScript -- unbalanced braces.
      fs.writeFileSync(path.join(tmpDir, 'Broken.tsx'), 'export function Broken( {{{ syntax error');

      const schemas = extractPropsSchemas(tmpDir, path.join(tmpDir, 'preview.tsx'));
      expect(Object.keys(schemas)).toContain('Good');
      expect(schemas.Good.find((p) => p.name === 'label')).toBeTruthy();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
