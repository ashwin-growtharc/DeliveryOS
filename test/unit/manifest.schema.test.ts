import { describe, it, expect } from 'vitest';
import { ManifestSchema, InstallParamSchema, WiringActionSchema } from '../../src/engine/manifest/schema';

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
      expect(result.data.tags).toEqual({ roles: [], teams: [], stacks: [], componentTypes: [] });
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

  describe('install_params / content_digest / signature (Phase 7 groundwork)', () => {
    it('defaults install_params to an empty array when absent -- every pre-Phase-7 manifest still parses unchanged', () => {
      const result = ManifestSchema.safeParse(baseManifest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.install_params).toEqual([]);
        expect(result.data.content_digest).toBeUndefined();
        expect(result.data.signature).toBeUndefined();
      }
    });

    it('accepts a real install_params array, e.g. the Phase 7 Auth.js target\'s own values', () => {
      const result = ManifestSchema.safeParse({
        ...baseManifest,
        install_params: [
          { key: 'AUTH_SECRET', description: 'Session-signing secret', secret: true, required: true },
          { key: 'AUTH_URL', description: 'Canonical app URL', secret: false, required: true, default: 'http://localhost:3000' },
          { key: 'DATABASE_URL', description: 'Postgres connection string', secret: true, required: true },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.install_params).toHaveLength(3);
        expect(result.data.install_params[1].default).toBe('http://localhost:3000');
      }
    });

    it('rejects an install_param marked secret that also declares a default -- a schema-level impossibility, not just a convention', () => {
      const result = InstallParamSchema.safeParse({
        key: 'AUTH_SECRET',
        description: 'Session-signing secret',
        secret: true,
        default: 'not-actually-secret-then',
      });
      expect(result.success).toBe(false);
    });

    it('defaults an install_param\'s secret/required flags (false/true) when omitted', () => {
      const result = InstallParamSchema.safeParse({
        key: 'SOME_FLAG',
        description: 'A non-secret, non-required value',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.secret).toBe(false);
        expect(result.data.required).toBe(true);
      }
    });

    it('accepts a valid content_digest', () => {
      const digest = `sha256:${'a'.repeat(64)}`;
      const result = ManifestSchema.safeParse({ ...baseManifest, content_digest: digest });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content_digest).toBe(digest);
      }
    });

    it('rejects a malformed content_digest (wrong prefix, wrong length, non-hex)', () => {
      for (const bad of ['sha1:' + 'a'.repeat(64), 'sha256:tooshort', `sha256:${'z'.repeat(64)}`]) {
        const result = ManifestSchema.safeParse({ ...baseManifest, content_digest: bad });
        expect(result.success).toBe(false);
      }
    });

    it('accepts a valid signature object', () => {
      const result = ManifestSchema.safeParse({
        ...baseManifest,
        signature: {
          algorithm: 'cosign',
          certificate_identity: 'https://github.com/ashwin-growtharc/growtharc-ai-helpers/.github/workflows/sign.yml@refs/heads/main',
          oidc_issuer: 'https://token.actions.githubusercontent.com',
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.signature?.algorithm).toBe('cosign');
      }
    });

    it('rejects a signature with an algorithm other than the literal "cosign"', () => {
      const result = ManifestSchema.safeParse({
        ...baseManifest,
        signature: {
          algorithm: 'gpg',
          certificate_identity: 'whoever',
          oidc_issuer: 'whatever',
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('wiring_actions (Phase 7 item 6)', () => {
    it('defaults wiring_actions to an empty array when absent -- every pre-item-6 manifest still parses unchanged', () => {
      const result = ManifestSchema.safeParse(baseManifest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.wiring_actions).toEqual([]);
      }
    });

    it('accepts a real wiring_actions array, e.g. the nextauth-credentials target\'s own auth.ts action', () => {
      const result = ManifestSchema.safeParse({
        ...baseManifest,
        wiring_actions: [
          {
            type: 'suggest_snippet',
            description: 'Wire up the root Auth.js entry point',
            targetFile: 'auth.ts',
            whenAbsent: {
              instructions: 'Create auth.ts at your project root with this content.',
              snippet: "export const { handlers, auth } = NextAuth(authConfig);",
            },
            whenPresent: {
              instructions: 'A root auth.ts already exists -- review before replacing it.',
            },
          },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.wiring_actions).toHaveLength(1);
        expect(result.data.wiring_actions[0].targetFile).toBe('auth.ts');
      }
    });

    it('rejects a wiring_action whose whenAbsent has no snippet -- a fresh file always needs one to hand over', () => {
      const result = WiringActionSchema.safeParse({
        type: 'suggest_snippet',
        description: 'test',
        targetFile: 'middleware.ts',
        whenAbsent: { instructions: 'do the thing' }, // missing snippet
      });
      expect(result.success).toBe(false);
    });

    it('accepts a whenPresent with no snippet at all -- "this exists, review before touching it," no snippet offered', () => {
      const result = WiringActionSchema.safeParse({
        type: 'suggest_snippet',
        description: 'test',
        targetFile: 'middleware.ts',
        whenAbsent: { instructions: 'create it', snippet: 'export {};' },
        whenPresent: { instructions: 'already exists, review before touching' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.whenPresent?.snippet).toBeUndefined();
      }
    });

    it('accepts a wiring_action with no whenPresent at all -- file-exists is itself the signal, nothing else to say', () => {
      const result = WiringActionSchema.safeParse({
        type: 'suggest_snippet',
        description: 'test',
        targetFile: 'app/api/auth/[...nextauth]/route.ts',
        whenAbsent: { instructions: 'create it', snippet: 'export { GET, POST } from "../../../../auth";' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.whenPresent).toBeUndefined();
      }
    });

    it('rejects an unknown wiring_action type -- suggest_snippet is the only variant today', () => {
      const result = WiringActionSchema.safeParse({
        type: 'auto_edit',
        description: 'test',
        targetFile: 'middleware.ts',
        whenAbsent: { instructions: 'create it', snippet: 'export {};' },
      });
      expect(result.success).toBe(false);
    });
  });
});
