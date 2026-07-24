import { describe, it, expect } from 'vitest';
import { ManifestSchema } from '../../src/engine/manifest/schema';

const baseManifest = {
  id: 'my-artifact',
  kind: 'template',
  description: 'A test artifact',
  owner: 'team-x',
  version: '1.2.3',
  source_repo: 'https://example.invalid/repo',
  install_target: 'some/target',
  review_required: true,
};

describe('ManifestSchema', () => {
  it('accepts a valid manifest', () => {
    const result = ManifestSchema.safeParse(baseManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('my-artifact');
      expect(result.data.tags).toEqual({ roles: [], teams: [], stacks: [] });
    }
  });

  it('fails when a required field is missing', () => {
    const { description: _description, ...withoutDescription } = baseManifest;
    const result = ManifestSchema.safeParse(withoutDescription);
    expect(result.success).toBe(false);
  });

  it('accepts arbitrary kind values, not just a fixed set', () => {
    for (const kind of ['template', 'doc', 'config', 'totally-custom-kind']) {
      const result = ManifestSchema.safeParse({ ...baseManifest, kind });
      expect(result.success).toBe(true);
    }
  });

  it('rejects a malformed (non-semver) version', () => {
    const result = ManifestSchema.safeParse({ ...baseManifest, version: 'v1' });
    expect(result.success).toBe(false);
  });

  it('rejects a version missing a patch segment', () => {
    const result = ManifestSchema.safeParse({ ...baseManifest, version: '1.2' });
    expect(result.success).toBe(false);
  });

  it('accepts a manifest with payload_path set, pointing at a real location outside artifacts/', () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      payload_path: 'catalog/agents/code-reviewer.md',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload_path).toBe('catalog/agents/code-reviewer.md');
    }
  });

  it('leaves payload_path undefined when absent, exactly as today', () => {
    const result = ManifestSchema.safeParse(baseManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload_path).toBeUndefined();
    }
  });
});
