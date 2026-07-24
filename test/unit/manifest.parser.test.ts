import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverManifests } from '../../src/engine/manifest/parser';
import { ManifestValidationError } from '../../src/engine/errors';

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
  it('returns an empty array when there is no artifacts directory', () => {
    expect(discoverManifests(remoteDir)).toEqual([]);
  });

  it('discovers valid manifests', () => {
    writeArtifact('artifact-one', validManifestYaml('artifact-one'));
    writeArtifact('artifact-two', validManifestYaml('artifact-two'));

    const manifests = discoverManifests(remoteDir);
    expect(manifests).toHaveLength(2);
    expect(manifests.map((m) => m.id).sort()).toEqual(['artifact-one', 'artifact-two']);
  });

  it('throws with the file path when id does not match the folder name', () => {
    const manifestPath = writeArtifact('folder-name', validManifestYaml('different-id'));

    expect(() => discoverManifests(remoteDir)).toThrow(ManifestValidationError);
    try {
      discoverManifests(remoteDir);
      throw new Error('expected discoverManifests to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestValidationError);
      expect((err as Error).message).toContain(manifestPath);
    }
  });

  it('throws with the file path on duplicate ids across folders', () => {
    // The first folder's id matches its own folder name (so it passes the
    // id/folder check cleanly); the second folder reuses the same id under
    // a different folder name, which must be reported as a duplicate id
    // rather than (only) as an id/folder mismatch.
    writeArtifact('same-id', validManifestYaml('same-id'));
    const secondPath = writeArtifact('some-other-folder', validManifestYaml('same-id'));

    try {
      discoverManifests(remoteDir);
      throw new Error('expected discoverManifests to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestValidationError);
      expect((err as Error).message).toContain(secondPath);
      expect((err as Error).message).toContain('same-id');
    }
  });

  it('throws with the file path on invalid YAML', () => {
    const manifestPath = writeArtifact('bad-yaml', 'id: [this is not, valid: yaml');

    try {
      discoverManifests(remoteDir);
      throw new Error('expected discoverManifests to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestValidationError);
      expect((err as Error).message).toContain(manifestPath);
    }
  });

  it('throws on schema validation failure', () => {
    const manifestPath = writeArtifact(
      'bad-schema',
      ['id: bad-schema', 'kind: template', 'description: missing required fields', ''].join('\n'),
    );

    try {
      discoverManifests(remoteDir);
      throw new Error('expected discoverManifests to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestValidationError);
      expect((err as Error).message).toContain(manifestPath);
    }
  });
});
