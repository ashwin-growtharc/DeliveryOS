import { describe, expect, it, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectStarterKitCandidates } from '../../src/engine/scan/detectStarterKitCandidates';

const alwaysNew = (): boolean => true;
const neverNew = (): boolean => false;

function newTmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-detect-starter-kit-'));
}

function writeFile(cwd: string, relPath: string, content = ''): string {
  const fullPath = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

function writePackageJson(dir: string, overrides: Record<string, unknown> = {}): void {
  writeFile(
    dir,
    'package.json',
    JSON.stringify({ name: path.basename(dir), scripts: { build: 'vite build' }, ...overrides }, null, 2),
  );
}

describe('detectStarterKitCandidates', () => {
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

  it('returns [] when there is no package.json anywhere', () => {
    const cwd = project();
    writeFile(cwd, 'src/index.ts', 'console.log("hi");');
    expect(detectStarterKitCandidates(cwd, alwaysNew)).toEqual([]);
  });

  it('detects a real project at cwd root with a routes.tsx file, and never proposes "." as its install target', () => {
    const cwd = project();
    writePackageJson(cwd);
    writeFile(cwd, 'src/routes.tsx', 'export const router = createBrowserRouter([]);');

    const candidates = detectStarterKitCandidates(cwd, alwaysNew);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe('template');
    expect(candidates[0].payloadPath).toBe(cwd);
    expect(candidates[0].description).toContain('src/routes.tsx');

    // Regression: this used to emit '.', which scan printed as a
    // ready-to-paste `--install-target "."`. That value resolves to the
    // CONSUMING project's own root, so pull would copy the payload over the
    // whole project and remove would recursively delete it. It is now
    // rejected everywhere (ManifestSchema + resolveContainedPath's
    // allowRoot: false), so emitting it would only hand the user a command
    // guaranteed to fail. A root-level candidate names itself instead.
    expect(candidates[0].installTarget).not.toBe('.');
    expect(candidates[0].installTarget).toBe(candidates[0].id);
  });

  it('detects a real project via a real pages/ directory with 2+ files', () => {
    const cwd = project();
    writePackageJson(cwd);
    writeFile(cwd, 'src/pages/Home.tsx', 'export default function Home() { return null; }');
    writeFile(cwd, 'src/pages/About.tsx', 'export default function About() { return null; }');

    const candidates = detectStarterKitCandidates(cwd, alwaysNew);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].description).toContain('src/pages/');
    expect(candidates[0].description).toContain('2 files');
  });

  it('does NOT flag a single-file pages/ directory (below the real-structure threshold)', () => {
    const cwd = project();
    writePackageJson(cwd);
    writeFile(cwd, 'src/pages/Home.tsx', 'export default function Home() { return null; }');

    expect(detectStarterKitCandidates(cwd, alwaysNew)).toEqual([]);
  });

  it('does NOT flag a project with a build script but no real routing evidence at all', () => {
    const cwd = project();
    writePackageJson(cwd);
    writeFile(cwd, 'src/index.ts', 'console.log("just a library");');

    expect(detectStarterKitCandidates(cwd, alwaysNew)).toEqual([]);
  });

  it('does NOT flag a project with real routing but no build script', () => {
    const cwd = project();
    writeFile(cwd, 'package.json', JSON.stringify({ name: 'lib', scripts: { test: 'vitest' } }));
    writeFile(cwd, 'src/routes.tsx', 'export const router = createBrowserRouter([]);');

    expect(detectStarterKitCandidates(cwd, alwaysNew)).toEqual([]);
  });

  it('excludes an already-tracked candidate via isNew', () => {
    const cwd = project();
    writePackageJson(cwd);
    writeFile(cwd, 'src/routes.tsx', '');

    expect(detectStarterKitCandidates(cwd, neverNew)).toEqual([]);
  });

  it('finds a real nested sub-project in a monorepo, with the correct relative installTarget', () => {
    const cwd = project();
    // cwd itself has no package.json at all -- purely a monorepo root.
    const appDir = path.join(cwd, 'packages', 'web-app');
    writePackageJson(appDir);
    writeFile(cwd, 'packages/web-app/src/routes.tsx', '');

    const candidates = detectStarterKitCandidates(cwd, alwaysNew);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].payloadPath).toBe(appDir);
    expect(candidates[0].installTarget).toBe('packages/web-app');
    expect(candidates[0].id).toBe('web-app');
  });

  it('never descends into node_modules looking for candidates', () => {
    const cwd = project();
    const fakeNested = path.join(cwd, 'node_modules', 'some-dep');
    writePackageJson(fakeNested);
    writeFile(cwd, 'node_modules/some-dep/src/routes.tsx', '');
    // No real project at cwd itself.
    writeFile(cwd, 'README.md', 'just a plain repo');

    expect(detectStarterKitCandidates(cwd, alwaysNew)).toEqual([]);
  });

  it('does not flag a nested sub-project inside an already-flagged real project', () => {
    const cwd = project();
    writePackageJson(cwd);
    writeFile(cwd, 'src/routes.tsx', '');
    // A nested docs-site with its own real package.json + routing --
    // should NOT also be flagged as a separate candidate.
    const nestedDocs = path.join(cwd, 'docs-site');
    writePackageJson(nestedDocs);
    writeFile(cwd, 'docs-site/src/routes.tsx', '');

    const candidates = detectStarterKitCandidates(cwd, alwaysNew);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].payloadPath).toBe(cwd);
  });

  it('names the real framework in the description when a known dependency is present', () => {
    const cwd = project();
    writePackageJson(cwd, { dependencies: { react: '^19.0.0' }, devDependencies: { vite: '^6.0.0' } });
    writeFile(cwd, 'src/routes.tsx', '');

    const candidates = detectStarterKitCandidates(cwd, alwaysNew);
    expect(candidates[0].description).toContain('Vite project');
  });

  it('falls back to a generic description when no known framework dependency is present', () => {
    const cwd = project();
    writePackageJson(cwd);
    writeFile(cwd, 'src/routes.tsx', '');

    const candidates = detectStarterKitCandidates(cwd, alwaysNew);
    expect(candidates[0].description).toContain('Real, buildable project');
  });

  it('warns when there is no README.md yet, and stays silent when there is one', () => {
    const cwd = project();
    writePackageJson(cwd);
    writeFile(cwd, 'src/routes.tsx', '');

    const withoutReadme = detectStarterKitCandidates(cwd, alwaysNew);
    expect(withoutReadme[0].warnings?.some((w) => w.includes('README'))).toBe(true);

    writeFile(cwd, 'README.md', '# Real docs');
    const withReadme = detectStarterKitCandidates(cwd, alwaysNew);
    expect(withReadme[0].warnings).toBeUndefined();
  });

  it('derives the id from the real directory basename, slugified', () => {
    const cwd = project();
    const appDir = path.join(cwd, 'My Cool App');
    writePackageJson(appDir);
    writeFile(cwd, 'My Cool App/src/routes.tsx', '');

    const candidates = detectStarterKitCandidates(cwd, alwaysNew);
    expect(candidates[0].id).toBe('my-cool-app');
  });
});
