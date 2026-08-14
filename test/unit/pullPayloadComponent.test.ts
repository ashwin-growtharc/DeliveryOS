import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pullPayloadComponent, PullPayloadComponentConflictError } from '../../src/engine/payload/pullPayloadComponent';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';

let deliveryOsHome: string;
let originalEnv: string | undefined;
let destParent: string;

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-pull-payload-component-test-'));
  process.env.DELIVERYOS_HOME = deliveryOsHome;
  destParent = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-pull-payload-component-dest-'));
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.DELIVERYOS_HOME;
  } else {
    process.env.DELIVERYOS_HOME = originalEnv;
  }
  fs.rmSync(deliveryOsHome, { recursive: true, force: true });
  fs.rmSync(destParent, { recursive: true, force: true });
});

function writeRegistry(remoteNames: string[]): void {
  const registry = {
    remotes: remoteNames.map((name) => ({
      name,
      url: `https://example.invalid/${name}`,
      addedAt: new Date().toISOString(),
    })),
  };
  fs.mkdirSync(deliveryOsHome, { recursive: true });
  fs.writeFileSync(remotesRegistryPath(), JSON.stringify(registry), 'utf-8');
}

function writeManifest(remoteCacheDir: string, id: string): void {
  fs.mkdirSync(path.join(remoteCacheDir, 'artifacts', id, 'payload'), { recursive: true });
  fs.writeFileSync(
    path.join(remoteCacheDir, 'artifacts', id, 'manifest.yaml'),
    [
      `id: ${id}`,
      `kind: template`,
      `description: Test design kit`,
      `owner: team-x`,
      `version: 1.0.0`,
      `source_repo: https://example.invalid/repo`,
      `install_target: some/target`,
      `review_required: false`,
      '',
    ].join('\n'),
    'utf-8',
  );
}

function writeComponent(componentDir: string): void {
  fs.mkdirSync(componentDir, { recursive: true });
  const name = path.basename(componentDir);
  fs.writeFileSync(
    path.join(componentDir, `${name}.tsx`),
    `export function ${name}() { return <div>${name}</div>; }\n`,
    'utf-8',
  );
  fs.writeFileSync(
    path.join(componentDir, 'preview.tsx'),
    `import { ${name} } from './${name}';\nexport const Default = () => <${name} />;\n`,
    'utf-8',
  );
}

describe('pullPayloadComponent', () => {
  it('copies a component\'s real source file(s) into destDir, excluding preview.tsx', () => {
    writeRegistry(['test-remote']);
    writeManifest(remoteCachePath('test-remote'), 'design-kit');
    const payloadDir = path.join(remoteCachePath('test-remote'), 'artifacts', 'design-kit', 'payload');
    writeComponent(path.join(payloadDir, 'components', 'Header'));

    const destDir = path.join(destParent, 'Header');
    const result = pullPayloadComponent('test-remote', 'design-kit', 'components/Header', destDir);

    expect(result.destDir).toBe(destDir);
    expect(result.copiedFiles.sort()).toEqual(['Header.tsx']);
    expect(fs.existsSync(path.join(destDir, 'Header.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'preview.tsx'))).toBe(false);
    expect(fs.readFileSync(path.join(destDir, 'Header.tsx'), 'utf-8')).toContain('export function Header');
  });

  it('creates destDir (recursively) when it does not exist yet', () => {
    writeRegistry(['test-remote']);
    writeManifest(remoteCachePath('test-remote'), 'design-kit');
    const payloadDir = path.join(remoteCachePath('test-remote'), 'artifacts', 'design-kit', 'payload');
    writeComponent(path.join(payloadDir, 'components', 'Footer'));

    const destDir = path.join(destParent, 'nested', 'deeper', 'Footer');
    pullPayloadComponent('test-remote', 'design-kit', 'components/Footer', destDir);

    expect(fs.existsSync(path.join(destDir, 'Footer.tsx'))).toBe(true);
  });

  it('throws (never silently escapes) when relativeDir tries to resolve outside the payload directory', () => {
    writeRegistry(['test-remote']);
    writeManifest(remoteCachePath('test-remote'), 'design-kit');

    expect(() =>
      pullPayloadComponent('test-remote', 'design-kit', '../../../etc', path.join(destParent, 'evil')),
    ).toThrow();
  });

  it('recursively copies a nested subdirectory, excluding preview files at any depth (never silently drops them)', () => {
    writeRegistry(['test-remote']);
    writeManifest(remoteCachePath('test-remote'), 'design-kit');
    const payloadDir = path.join(remoteCachePath('test-remote'), 'artifacts', 'design-kit', 'payload');
    const componentDir = path.join(payloadDir, 'components', 'IconButton');
    writeComponent(componentDir);
    fs.mkdirSync(path.join(componentDir, 'icons'), { recursive: true });
    fs.writeFileSync(path.join(componentDir, 'icons', 'plus.svg'), '<svg></svg>', 'utf-8');
    fs.writeFileSync(path.join(componentDir, 'icons', 'preview.tsx'), 'nested preview scaffold, must be excluded', 'utf-8');

    const destDir = path.join(destParent, 'IconButton');
    const result = pullPayloadComponent('test-remote', 'design-kit', 'components/IconButton', destDir);

    expect(result.copiedFiles.sort()).toEqual(['IconButton.tsx', path.join('icons', 'plus.svg')].sort());
    expect(fs.existsSync(path.join(destDir, 'icons', 'plus.svg'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'icons', 'preview.tsx'))).toBe(false);
  });

  it('throws a clear conflict error instead of silently overwriting an existing file at the destination', () => {
    writeRegistry(['test-remote']);
    writeManifest(remoteCachePath('test-remote'), 'design-kit');
    const payloadDir = path.join(remoteCachePath('test-remote'), 'artifacts', 'design-kit', 'payload');
    writeComponent(path.join(payloadDir, 'components', 'Header'));

    const destDir = path.join(destParent, 'Header');
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, 'Header.tsx'), 'a real, pre-existing file the user already has', 'utf-8');

    expect(() => pullPayloadComponent('test-remote', 'design-kit', 'components/Header', destDir)).toThrow(
      PullPayloadComponentConflictError,
    );
    // Never partially written -- the pre-existing file is untouched.
    expect(fs.readFileSync(path.join(destDir, 'Header.tsx'), 'utf-8')).toBe(
      'a real, pre-existing file the user already has',
    );
  });
});
