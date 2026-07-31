import { describe, expect, it, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectUiComponentCandidates } from '../../src/engine/scan/detectUiComponents';
import { scanStagingDir } from '../../src/engine/paths';

const alwaysNew = (): boolean => true;

function newTmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-detect-ui-'));
}

function writeFile(cwd: string, relPath: string, content: string): string {
  const fullPath = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

const BUTTON_SOURCE = `export interface ButtonProps {
  label: string;
  variant?: 'primary' | 'secondary';
}

export function Button({ label, variant = 'primary' }: ButtonProps) {
  return <button data-variant={variant}>{label}</button>;
}
`;

describe('detectUiComponentCandidates', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    while (tmpDirs.length > 0) {
      fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
    }
  });

  function project(): string {
    const dir = newTmpProject();
    tmpDirs.push(dir);
    return dir;
  }

  it('returns [] when there is no src/ directory at all', () => {
    const cwd = project();
    expect(detectUiComponentCandidates(cwd, alwaysNew)).toEqual([]);
  });

  it('detects a real component (Props type + JSX) in its own dedicated folder, and scaffolds preview.tsx in place', () => {
    const cwd = project();
    writeFile(cwd, 'src/ui/Button/Button.tsx', BUTTON_SOURCE);

    const candidates = detectUiComponentCandidates(cwd, alwaysNew);

    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    expect(candidate.kind).toBe('ui-component');
    // Folder name ("Button") matches the file's own basename -> id is
    // just the folder name, not doubled up as "button-button".
    expect(candidate.id).toBe('button');
    expect(candidate.description).toBeUndefined();
    expect(candidate.payloadPath).toBe(path.join(cwd, 'src', 'ui', 'Button'));
    expect(candidate.installTarget).toBe('src/ui/Button');

    // preview.tsx didn't exist -- must be auto-scaffolded, in place, next
    // to the real component (not copied anywhere else).
    const previewPath = path.join(cwd, 'src', 'ui', 'Button', 'preview.tsx');
    expect(fs.existsSync(previewPath)).toBe(true);
    const previewSource = fs.readFileSync(previewPath, 'utf-8');
    expect(previewSource).toContain("import { Button } from './Button';");
    // `label` is required (no default in the destructuring) and has no
    // docgen defaultValue -- falls back to the string placeholder.
    expect(previewSource).toContain("label: ''");
    // `variant` is optional -- omitted from the stub entirely.
    expect(previewSource).not.toContain('variant:');
    expect(previewSource).toContain('export const Default = () => <Button {...inferredProps} />;');
  });

  it('does not scaffold a new preview.tsx when one already exists next to the component', () => {
    const cwd = project();
    writeFile(cwd, 'src/ui/Button/Button.tsx', BUTTON_SOURCE);
    const previewPath = writeFile(
      cwd,
      'src/ui/Button/preview.tsx',
      "import { Button } from './Button';\nexport const Custom = () => <Button label=\"hi\" />;\n",
    );

    detectUiComponentCandidates(cwd, alwaysNew);

    // Untouched -- the hand-written preview survives, not overwritten by a
    // generated stub.
    expect(fs.readFileSync(previewPath, 'utf-8')).toContain('Custom');
  });

  it('rejects a plain util function and a JSX-less component-shaped file as non-components', () => {
    const cwd = project();
    writeFile(cwd, 'src/ui/Button/Button.tsx', BUTTON_SOURCE);
    // Same folder as the real component -- a non-component sibling must
    // not be treated as a second detected component in that folder (which
    // would otherwise wrongly flip Button's folder from "dedicated" to
    // "shared").
    writeFile(
      cwd,
      'src/ui/Button/icons.tsx',
      "export function noop(): number {\n  return 1;\n}\n",
    );

    const candidates = detectUiComponentCandidates(cwd, alwaysNew);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('button');
    // The non-component sibling didn't flip Button's folder to "flat" --
    // it's still an in-place dedicated-folder payload.
    expect(candidates[0].payloadPath).toBe(path.join(cwd, 'src', 'ui', 'Button'));
  });

  it('excludes node_modules, dotfiles, pages/app/routes, and *.test.tsx/*.spec.tsx', () => {
    const cwd = project();
    writeFile(cwd, 'src/ui/Button/Button.tsx', BUTTON_SOURCE);
    writeFile(cwd, 'src/node_modules/SomeLib/Widget.tsx', BUTTON_SOURCE.replace(/Button/g, 'Widget'));
    writeFile(cwd, 'src/.hidden/Widget.tsx', BUTTON_SOURCE.replace(/Button/g, 'Widget'));
    writeFile(cwd, 'src/pages/HomePage.tsx', BUTTON_SOURCE.replace(/Button/g, 'HomePage'));
    writeFile(cwd, 'src/app/AppShell.tsx', BUTTON_SOURCE.replace(/Button/g, 'AppShell'));
    writeFile(cwd, 'src/routes/RouteRoot.tsx', BUTTON_SOURCE.replace(/Button/g, 'RouteRoot'));
    writeFile(cwd, 'src/ui/Button/Button.test.tsx', BUTTON_SOURCE.replace(/Button/g, 'ButtonTest'));

    const ids = detectUiComponentCandidates(cwd, alwaysNew).map((c) => c.id);
    expect(ids).toEqual(['button']);
  });

  it('honors the isNew closure, skipping ids already tracked/published', () => {
    const cwd = project();
    writeFile(cwd, 'src/ui/Button/Button.tsx', BUTTON_SOURCE);

    const candidates = detectUiComponentCandidates(cwd, (id) => id !== 'button');
    expect(candidates).toEqual([]);
  });

  describe('flat convention (no dedicated folder)', () => {
    it('stages a copy of the component + a generated preview.tsx, leaving the original untouched', () => {
      const cwd = project();
      // Two independent components sitting flat in one shared folder --
      // neither owns `ui/`, so both go through the staging path.
      const buttonPath = writeFile(cwd, 'src/ui/button.tsx', BUTTON_SOURCE);
      writeFile(
        cwd,
        'src/ui/input.tsx',
        "export interface InputProps {\n  value: string;\n}\n\nexport function Input({ value }: InputProps) {\n  return <input value={value} readOnly />;\n}\n",
      );
      const originalContent = fs.readFileSync(buttonPath, 'utf-8');

      const candidates = detectUiComponentCandidates(cwd, alwaysNew);
      const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));

      // Folder ("ui") doesn't match either basename, so both ids are
      // folder-qualified -- "ui-button"/"ui-input", not bare "button"/
      // "input" (which would risk colliding with a same-named component
      // under a totally different folder elsewhere in the project).
      expect(Object.keys(byId).sort()).toEqual(['ui-button', 'ui-input']);

      const buttonCandidate = byId['ui-button'];
      const expectedStagingDir = path.join(scanStagingDir(cwd), 'ui-button');
      expect(buttonCandidate.payloadPath).toBe(expectedStagingDir);
      expect(buttonCandidate.installTarget).toBe('src/components/ui-button');

      // Original file is byte-for-byte untouched, and no preview.tsx was
      // ever written next to it in the real project folder.
      expect(fs.readFileSync(buttonPath, 'utf-8')).toBe(originalContent);
      expect(fs.existsSync(path.join(cwd, 'src', 'ui', 'preview.tsx'))).toBe(false);

      // The staged copy + generated preview both landed in the synthetic
      // staging directory instead.
      expect(fs.existsSync(path.join(expectedStagingDir, 'button.tsx'))).toBe(true);
      expect(fs.readFileSync(path.join(expectedStagingDir, 'button.tsx'), 'utf-8')).toBe(originalContent);
      const stagedPreview = fs.readFileSync(path.join(expectedStagingDir, 'preview.tsx'), 'utf-8');
      expect(stagedPreview).toContain("import { Button } from './button';");
    });

    it('treats a component sitting directly in src/ (no subfolder at all) as flat too', () => {
      const cwd = project();
      writeFile(cwd, 'src/Button.tsx', BUTTON_SOURCE);

      const candidates = detectUiComponentCandidates(cwd, alwaysNew);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].id).toBe('button');
      expect(candidates[0].payloadPath).toBe(path.join(scanStagingDir(cwd), 'button'));
    });
  });

  describe('same-batch id dedupe', () => {
    it('disambiguates two different files that derive the same id, with a warning on the later one', () => {
      const cwd = project();
      // Both land in a `forms/` folder of their own (dedicated: each is
      // the sole detected component in its folder) -- the id scheme keys
      // off the immediate parent only, so both derive "forms-button".
      writeFile(cwd, 'src/teamA/forms/Button.tsx', BUTTON_SOURCE);
      writeFile(cwd, 'src/teamB/forms/Button.tsx', BUTTON_SOURCE);

      const candidates = detectUiComponentCandidates(cwd, alwaysNew);
      const ids = candidates.map((c) => c.id).sort();

      expect(ids).toEqual(['forms-button', 'forms-button-2']);

      const second = candidates.find((c) => c.id === 'forms-button-2')!;
      expect(second.warnings).toBeDefined();
      expect(second.warnings!.some((w) => w.includes('forms-button') && w.includes('disambiguated'))).toBe(true);

      const first = candidates.find((c) => c.id === 'forms-button')!;
      expect(first.warnings).toBeUndefined();
    });
  });

  describe('import-escape check', () => {
    it('does not warn on a relative import to a sibling within the component\'s own dedicated folder', () => {
      const cwd = project();
      writeFile(
        cwd,
        'src/ui/Card/Card.tsx',
        "import { formatTitle } from './format';\n\nexport interface CardProps {\n  title: string;\n}\n\nexport function Card({ title }: CardProps) {\n  return <div>{formatTitle(title)}</div>;\n}\n",
      );
      writeFile(cwd, 'src/ui/Card/format.ts', "export function formatTitle(t: string): string {\n  return t;\n}\n");

      const candidates = detectUiComponentCandidates(cwd, alwaysNew);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].warnings).toBeUndefined();
    });

    it('flags a relative import that escapes the dedicated folder', () => {
      const cwd = project();
      writeFile(
        cwd,
        'src/ui/Card/Card.tsx',
        "import { formatTitle } from '../../../shared/utils';\n\nexport interface CardProps {\n  title: string;\n}\n\nexport function Card({ title }: CardProps) {\n  return <div>{formatTitle(title)}</div>;\n}\n",
      );

      const candidates = detectUiComponentCandidates(cwd, alwaysNew);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].warnings).toBeDefined();
      expect(candidates[0].warnings!.some((w) => w.includes('../../../shared/utils'))).toBe(true);
    });

    it('flags every relative import for a flat/staged candidate, even one to a same-folder sibling', () => {
      const cwd = project();
      writeFile(
        cwd,
        'src/ui/button.tsx',
        "import { theme } from './theme';\n\nexport interface ButtonProps {\n  label: string;\n}\n\nexport function Button({ label }: ButtonProps) {\n  return <button style={theme}>{label}</button>;\n}\n",
      );
      writeFile(
        cwd,
        'src/ui/input.tsx',
        "export interface InputProps {\n  value: string;\n}\n\nexport function Input({ value }: InputProps) {\n  return <input value={value} readOnly />;\n}\n",
      );

      const candidates = detectUiComponentCandidates(cwd, alwaysNew);
      const button = candidates.find((c) => c.id === 'ui-button')!;
      expect(button.warnings).toBeDefined();
      expect(button.warnings!.some((w) => w.includes('./theme'))).toBe(true);
    });
  });
});
