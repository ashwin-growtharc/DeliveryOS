import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listArtifactPayloadComponents } from '../../src/engine/payload/listPayloadComponents';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';

let deliveryOsHome: string;
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-list-payload-components-test-'));
  process.env.DELIVERYOS_HOME = deliveryOsHome;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.DELIVERYOS_HOME;
  } else {
    process.env.DELIVERYOS_HOME = originalEnv;
  }
  fs.rmSync(deliveryOsHome, { recursive: true, force: true });
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

describe('listArtifactPayloadComponents', () => {
  it('returns [] when the artifact has no components/ directory at all -- the normal case for most artifacts', () => {
    writeRegistry(['test-remote']);
    writeManifest(remoteCachePath('test-remote'), 'plain-kit');
    expect(listArtifactPayloadComponents('test-remote', 'plain-kit')).toEqual([]);
  });

  it('lists every component with its own preview.tsx, one subdirectory per component', () => {
    writeRegistry(['test-remote']);
    writeManifest(remoteCachePath('test-remote'), 'design-kit');
    const payloadDir = path.join(remoteCachePath('test-remote'), 'artifacts', 'design-kit', 'payload');
    writeComponent(path.join(payloadDir, 'components', 'Button'));
    writeComponent(path.join(payloadDir, 'components', 'Card'));

    const components = listArtifactPayloadComponents('test-remote', 'design-kit');
    expect(components.map((c) => c.name).sort()).toEqual(['Button', 'Card']);
    expect(components.find((c) => c.name === 'Button')?.relativeDir).toBe('components/Button');
  });

  it('recurses one bounded extra level for a category folder, per GUIDELINES.md\'s own rule (3+ related components may live under e.g. components/forms/)', () => {
    writeRegistry(['test-remote']);
    writeManifest(remoteCachePath('test-remote'), 'design-kit');
    const payloadDir = path.join(remoteCachePath('test-remote'), 'artifacts', 'design-kit', 'payload');
    writeComponent(path.join(payloadDir, 'components', 'Button'));
    writeComponent(path.join(payloadDir, 'components', 'forms', 'Input'));
    writeComponent(path.join(payloadDir, 'components', 'forms', 'Select'));

    const components = listArtifactPayloadComponents('test-remote', 'design-kit');
    expect(components.map((c) => c.name).sort()).toEqual(['Button', 'Input', 'Select']);
    expect(components.find((c) => c.name === 'Input')?.relativeDir).toBe('components/forms/Input');
  });

  it('skips a subdirectory with no preview file at all, and does not throw', () => {
    writeRegistry(['test-remote']);
    writeManifest(remoteCachePath('test-remote'), 'design-kit');
    const payloadDir = path.join(remoteCachePath('test-remote'), 'artifacts', 'design-kit', 'payload');
    writeComponent(path.join(payloadDir, 'components', 'Button'));
    // A directory with no preview.tsx anywhere under it -- e.g. stray docs
    // or assets sitting alongside real components.
    fs.mkdirSync(path.join(payloadDir, 'components', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(payloadDir, 'components', 'assets', 'logo.svg'), '<svg></svg>', 'utf-8');

    const components = listArtifactPayloadComponents('test-remote', 'design-kit');
    expect(components.map((c) => c.name)).toEqual(['Button']);
  });
});
