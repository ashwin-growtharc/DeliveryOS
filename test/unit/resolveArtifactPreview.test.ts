import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  compileArtifactPreview,
  compileLocalPreview,
  compileTemplateComponentPreview,
  findPreviewEntryFile,
} from '../../src/engine/preview/resolveArtifactPreview';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';

let deliveryOsHome: string;
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-resolve-preview-test-'));
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

function writeUiComponentArtifact(remoteCacheDir: string, id: string): string {
  const payloadDir = path.join(remoteCacheDir, 'artifacts', id, 'payload');
  fs.mkdirSync(payloadDir, { recursive: true });
  fs.writeFileSync(
    path.join(remoteCacheDir, 'artifacts', id, 'manifest.yaml'),
    [
      `id: ${id}`,
      `kind: ui-component`,
      `description: Test button component`,
      `owner: team-x`,
      `version: 1.0.0`,
      `source_repo: https://example.invalid/repo`,
      `install_target: some/target`,
      `review_required: false`,
      '',
    ].join('\n'),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(payloadDir, 'Button.tsx'),
    `export function Button() { return <button>Click me</button>; }\n`,
    'utf-8',
  );
  fs.writeFileSync(
    path.join(payloadDir, 'preview.tsx'),
    `import { Button } from './Button';\nexport const Primary = () => <Button />;\n`,
    'utf-8',
  );
  return payloadDir;
}

function writeTemplateComponentArtifact(
  remoteCacheDir: string,
  templateId: string,
  componentName: string,
  buttonLabel: string,
): string {
  const templateDir = path.join(remoteCacheDir, 'artifacts', templateId);
  const componentDir = path.join(templateDir, 'payload', 'components', componentName);
  fs.mkdirSync(componentDir, { recursive: true });
  fs.writeFileSync(
    path.join(templateDir, 'manifest.yaml'),
    [
      `id: ${templateId}`,
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
  fs.writeFileSync(
    path.join(componentDir, `${componentName}.tsx`),
    `export function ${componentName}() { return <button>${buttonLabel}</button>; }\n`,
    'utf-8',
  );
  fs.writeFileSync(
    path.join(componentDir, 'preview.tsx'),
    `import { ${componentName} } from './${componentName}';\nexport const Default = () => <${componentName} />;\n`,
    'utf-8',
  );
  return componentDir;
}

describe('findPreviewEntryFile', () => {
  it('finds preview.tsx when present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-find-preview-'));
    try {
      fs.writeFileSync(path.join(dir, 'preview.tsx'), 'export const X = () => null;');
      expect(findPreviewEntryFile(dir)).toBe(path.join(dir, 'preview.tsx'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws a clear error when no conventional preview file exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-find-preview-'));
    try {
      expect(() => findPreviewEntryFile(dir)).toThrow(/No preview entry file found/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('compileArtifactPreview', () => {
  it('resolves a pushed artifact by (remote, id) and compiles its preview, reading directly from the remote cache -- no pull required', async () => {
    writeRegistry(['test-remote']);
    writeUiComponentArtifact(remoteCachePath('test-remote'), 'my-button');

    const { html } = await compileArtifactPreview('test-remote', 'my-button');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Click me');
  });
});

describe('compileTemplateComponentPreview', () => {
  it('compiles one component out of a template artifact’s own components/<Name> folder', async () => {
    writeRegistry(['test-remote']);
    const componentDir = writeTemplateComponentArtifact(
      remoteCachePath('test-remote'),
      'my-design-kit',
      'Stepper',
      'Step one',
    );

    const { html } = await compileTemplateComponentPreview('test-remote', 'my-design-kit', componentDir);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Step one');
  });

  it('caches per component, unlike compileLocalPreview -- a real fix for the template grid firing one uncached compile per component on every open', async () => {
    writeRegistry(['test-remote']);
    const componentDir = writeTemplateComponentArtifact(
      remoteCachePath('test-remote'),
      'my-design-kit',
      'Stepper',
      'Step one',
    );

    const first = await compileTemplateComponentPreview('test-remote', 'my-design-kit', componentDir);
    expect(first.html).toContain('Step one');

    // Edit the source after the first compile -- a genuine cache hit
    // returns the FIRST compile's output regardless, same assertion shape
    // compileArtifactPreview's own caching would need (it just doesn't
    // have a dedicated test for it either -- this is the first one for
    // this cache path specifically).
    fs.writeFileSync(
      path.join(componentDir, 'Stepper.tsx'),
      `export function Stepper() { return <button>Edited label</button>; }\n`,
      'utf-8',
    );
    const second = await compileTemplateComponentPreview('test-remote', 'my-design-kit', componentDir);
    expect(second.html).toContain('Step one');
    expect(second.html).not.toContain('Edited label');
  });

  it('does not collide across two different components in the same template version', async () => {
    writeRegistry(['test-remote']);
    const remoteDir = remoteCachePath('test-remote');
    const stepperDir = writeTemplateComponentArtifact(remoteDir, 'my-design-kit', 'Stepper', 'Step one');
    const badgeDir = writeTemplateComponentArtifact(remoteDir, 'my-design-kit', 'Badge', 'New');

    const stepper = await compileTemplateComponentPreview('test-remote', 'my-design-kit', stepperDir);
    const badge = await compileTemplateComponentPreview('test-remote', 'my-design-kit', badgeDir);

    expect(stepper.html).toContain('Step one');
    expect(stepper.html).not.toContain('>New<');
    expect(badge.html).toContain('New');
    expect(badge.html).not.toContain('Step one');
  });
});

describe('compileLocalPreview (Phase D)', () => {
  it('compiles a preview straight from a local payload directory, with no remote/id/version at all', async () => {
    // Deliberately reuses writeUiComponentArtifact's payload dir directly,
    // not through a registered remote -- a Scan-discovered candidate has
    // never been pushed, so there is no remote cache entry to read from at
    // all, only a real folder sitting somewhere in the project (or a
    // synthetic staged one). No writeRegistry() call here on purpose.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-local-preview-'));
    try {
      const payloadDir = writeUiComponentArtifact(dir, 'unpushed-button');
      const { html } = await compileLocalPreview(payloadDir);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Click me');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recompiles fresh on every call rather than caching -- unlike compileArtifactPreview, there is no (remote, id, version) to key a cache on yet', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-local-preview-nocache-'));
    try {
      const payloadDir = writeUiComponentArtifact(dir, 'unpushed-button');
      const first = await compileLocalPreview(payloadDir);

      // Change the component's own source after the first compile -- if
      // this were wrongly routed through the cached getOrCompilePreview
      // path, the second call would silently return the FIRST compile's
      // stale output instead of reflecting this edit.
      fs.writeFileSync(
        path.join(payloadDir, 'Button.tsx'),
        `export function Button() { return <button>Edited label</button>; }\n`,
        'utf-8',
      );
      const second = await compileLocalPreview(payloadDir);

      expect(first.html).toContain('Click me');
      expect(second.html).toContain('Edited label');
      expect(second.html).not.toContain('Click me');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
