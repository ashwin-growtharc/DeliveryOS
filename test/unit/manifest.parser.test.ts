import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverManifests } from '../../src/engine/manifest/parser';

let remoteDir: string;

function writeArtifact(folderName: string, manifestYamlContent: string): string {
  const artifactDir = path.join(remoteDir, 'artifacts', folderName);
  fs.mkdirSync(path.join(artifactDir, 'payload'), { recursive: true });
  const manifestPath = path.join(artifactDir, 'manifest.yaml');
  fs.writeFileSync(manifestPath, manifestYamlContent, 'utf-8');
  return manifestPath;
}

function validManifestYaml(id: string): string {
  return [
    `id: ${id}`,
    `kind: template`,
    `description: A valid test manifest`,
    `owner: team-x`,
    `version: 1.0.0`,
    `source_repo: https://example.invalid/repo`,
    `install_target: some/target`,
    `review_required: false`,
    '',
  ].join('\n');
}

beforeEach(() => {
  remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-parser-test-'));
});

afterEach(() => {
  fs.rmSync(remoteDir, { recursive: true, force: true });
});

describe('discoverManifests', () => {
  // These all used to assert that discoverManifests THREW on a bad manifest.
  // That was the wrong contract for a shared catalog, and it caused a real
  // outage: one artifact failing a newly-tightened install_target rule made
  // `deliveryos list` return nothing but a validation error, taking all 227
  // artifacts down with it. One person pushing a bad manifest must not stop
  // everyone else browsing. Each bad manifest is now skipped and reported,
  // and its siblings still load.

  it('returns nothing when there is no artifacts directory', () => {
    expect(discoverManifests(remoteDir)).toEqual({ manifests: [], skipped: [] });
  });

  it('discovers valid manifests', () => {
    writeArtifact('artifact-one', validManifestYaml('artifact-one'));
    writeArtifact('artifact-two', validManifestYaml('artifact-two'));

    const { manifests, skipped } = discoverManifests(remoteDir);
    expect(manifests).toHaveLength(2);
    expect(manifests.map((m) => m.id).sort()).toEqual(['artifact-one', 'artifact-two']);
    expect(skipped).toEqual([]);
  });

  it('skips and reports a manifest whose id does not match its folder', () => {
    const manifestPath = writeArtifact('folder-name', validManifestYaml('different-id'));

    const { manifests, skipped } = discoverManifests(remoteDir);
    expect(manifests).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].path).toBe(manifestPath);
    expect(skipped[0].reason).toContain('does not match its folder name');
  });

  it('skips and reports the second of two folders claiming the same id', () => {
    writeArtifact('same-id', validManifestYaml('same-id'));
    const secondPath = writeArtifact('some-other-folder', validManifestYaml('same-id'));

    const { manifests, skipped } = discoverManifests(remoteDir);
    // The first one still loads -- a duplicate must not cost you both.
    expect(manifests.map((m) => m.id)).toEqual(['same-id']);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].path).toBe(secondPath);
    expect(skipped[0].reason).toContain('duplicate id');
  });

  it('skips and reports invalid YAML', () => {
    const manifestPath = writeArtifact('bad-yaml', 'id: [this is not, valid: yaml');

    const { manifests, skipped } = discoverManifests(remoteDir);
    expect(manifests).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].path).toBe(manifestPath);
    expect(skipped[0].reason).toContain('not valid YAML');
  });

  it('skips and reports a schema validation failure', () => {
    const manifestPath = writeArtifact(
      'bad-schema',
      ['id: bad-schema', 'kind: template', 'description: missing required fields', ''].join('\n'),
    );

    const { manifests, skipped } = discoverManifests(remoteDir);
    expect(manifests).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].path).toBe(manifestPath);
    expect(skipped[0].reason).toContain('failed validation');
  });

  // THE regression test for the outage. This is the shape that actually
  // happened: a big catalog, one bad artifact in it.
  it('still returns every good manifest when one sibling is broken', () => {
    for (let i = 0; i < 12; i += 1) {
      writeArtifact(`good-${i}`, validManifestYaml(`good-${i}`));
    }
    const badPath = writeArtifact(
      'broken',
      ['id: broken', 'kind: template', 'description: no owner, no version', ''].join('\n'),
    );

    const { manifests, skipped } = discoverManifests(remoteDir);
    expect(manifests).toHaveLength(12);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].path).toBe(badPath);
  });

  // The specific manifest that caused the outage: a lint/tooling scaffold
  // whose whole purpose is to write config files at the project root.
  it('accepts a root install_target, as a real scaffold artifact uses', () => {
    writeArtifact(
      'react-vite-lint-scaffold',
      [
        'id: react-vite-lint-scaffold',
        'kind: template',
        'description: ESLint + Prettier + Husky for a Vite React project',
        'owner: team-x',
        'version: 1.0.0',
        'source_repo: https://example.invalid/repo',
        'install_target: .',
        'review_required: false',
        '',
      ].join('\n'),
    );

    const { manifests, skipped } = discoverManifests(remoteDir);
    expect(skipped).toEqual([]);
    expect(manifests).toHaveLength(1);
    expect(manifests[0].install_target).toBe('.');
  });
});
