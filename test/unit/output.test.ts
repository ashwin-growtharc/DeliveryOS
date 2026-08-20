import { describe, it, expect, vi, afterEach } from 'vitest';
import { printCatalog, printWiringActions } from '../../src/cli/output';
import { CatalogListEntry } from '../../src/engine/catalog/catalog';
import { Manifest } from '../../src/engine/manifest/schema';
import { ResolvedWiringAction } from '../../src/engine/pull/wiring';

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    id: 'my-artifact',
    kind: 'template',
    description: 'A test artifact',
    owner: 'team-x',
    version: '1.0.0',
    source_repo: 'https://example.invalid/repo',
    install_target: 'installed',
    review_required: false,
    tags: { roles: [], teams: [], stacks: [], componentTypes: [] },
    install_params: [],
    ...overrides,
  } as Manifest;
}

function makeEntry(overrides: Partial<CatalogListEntry> = {}): CatalogListEntry {
  return {
    manifest: makeManifest(),
    remoteName: 'test-remote',
    localStatus: 'not_pulled',
    installTarget: '/tmp/installed',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('printCatalog', () => {
  it('prints "No artifacts found." for an empty list (human-readable mode)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printCatalog([], false);
    expect(spy).toHaveBeenCalledWith('No artifacts found.');
  });

  it('prints an empty JSON array for an empty list (json mode)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printCatalog([], true);
    expect(spy).toHaveBeenCalledWith('[]');
  });

  it('prints a real column-aligned table including the localStatus column', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printCatalog([makeEntry({ localStatus: 'edited_locally' })], false);

    const lines = spy.mock.calls.map((call) => call[0] as string);
    expect(lines[0]).toContain('status');
    expect(lines.some((l) => l.includes('edited_locally'))).toBe(true);
    expect(lines.some((l) => l.includes('my-artifact'))).toBe(true);
  });

  it('prints JSON including localStatus, tags, installParams, and signed', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printCatalog(
      [makeEntry({
        localStatus: 'pulled',
        manifest: makeManifest({
          install_params: [{ key: 'API_KEY', description: 'a key', secret: true, required: true }],
        }),
      })],
      true,
    );

    const printed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(printed[0].localStatus).toBe('pulled');
    expect(printed[0].signed).toBe(false);
    expect(printed[0].installParams).toEqual([
      { key: 'API_KEY', secret: true, required: true, hasDefault: false },
    ]);
  });
});

describe('printWiringActions', () => {
  const action: ResolvedWiringAction = {
    description: 'Wire up auth',
    targetFile: 'src/auth.ts',
    targetFileExists: true,
    instructions: 'Add this import.',
    snippet: 'import { auth } from "./auth";',
  };

  it('prints a clear message for no actions', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printWiringActions([], false);
    expect(spy).toHaveBeenCalledWith('No wiring actions declared for this artifact.');
  });

  it('prints JSON verbatim when json is set', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printWiringActions([action], true);
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toEqual([action]);
  });

  it('prints a human-readable card including the target file, EXISTS marker, and snippet', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printWiringActions([action], false);
    const output = spy.mock.calls.map((call) => call[0] as string).join('\n');
    expect(output).toContain('src/auth.ts -- EXISTS');
    expect(output).toContain('Wire up auth');
    expect(output).toContain('import { auth } from "./auth";');
  });

  it('marks a non-existent target file as NOT FOUND', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printWiringActions([{ ...action, targetFileExists: false, snippet: undefined }], false);
    const output = spy.mock.calls.map((call) => call[0] as string).join('\n');
    expect(output).toContain('src/auth.ts -- NOT FOUND');
  });
});
