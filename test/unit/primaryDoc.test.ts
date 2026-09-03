import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolvePrimaryDoc, DEFAULT_MAX_DOC_BYTES } from '../../src/engine/payload/primaryDoc';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';

/**
 * `resolvePayloadDir` returns two different KINDS of path -- a file for the
 * `payload_path` artifacts that point straight at one document, a directory
 * for the payload-directory skills -- and both shapes are common in the real
 * catalog. A caller that assumes "directory" reads nothing for the first
 * group; one that assumes "file" throws EISDIR on the second. These tests pin
 * the fork.
 */

let deliveryOsHome: string;
let originalEnv: string | undefined;
const REMOTE = 'test-remote';

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-primarydoc-'));
  process.env.DELIVERYOS_HOME = deliveryOsHome;
  fs.mkdirSync(deliveryOsHome, { recursive: true });
  fs.writeFileSync(
    remotesRegistryPath(),
    JSON.stringify({
      remotes: [{ name: REMOTE, url: 'https://example.invalid/r', addedAt: new Date().toISOString() }],
    }),
    'utf-8',
  );
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.DELIVERYOS_HOME;
  else process.env.DELIVERYOS_HOME = originalEnv;
  fs.rmSync(deliveryOsHome, { recursive: true, force: true });
});

/** Writes a manifest. `payloadPath` set => the `payload_path` escape hatch. */
function writeManifest(id: string, payloadPath?: string): void {
  const dir = path.join(remoteCachePath(REMOTE), 'artifacts', id);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    `id: ${id}`,
    'kind: skill',
    `description: Test artifact ${id}`,
    'owner: team-x',
    'version: 1.0.0',
    'source_repo: https://example.invalid/repo',
    'install_target: some/target',
    'review_required: false',
  ];
  if (payloadPath) lines.push(`payload_path: ${payloadPath}`);
  fs.writeFileSync(path.join(dir, 'manifest.yaml'), lines.join('\n') + '\n', 'utf-8');
}

/** Creates the conventional `artifacts/<id>/payload/` directory. */
function writePayloadDir(id: string, files: Record<string, string | Buffer>): void {
  const dir = path.join(remoteCachePath(REMOTE), 'artifacts', id, 'payload');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
}

describe('resolvePrimaryDoc', () => {
  it('reads SKILL.md from a payload DIRECTORY', () => {
    writeManifest('dir-skill');
    writePayloadDir('dir-skill', { 'SKILL.md': '# The skill\n' });

    const doc = resolvePrimaryDoc(REMOTE, 'dir-skill');
    expect(doc?.relPath).toBe('SKILL.md');
    expect(doc?.content).toBe('# The skill\n');
    expect(doc?.truncated).toBe(false);
  });

  it('reads the FILE itself when payload_path names one, reporting relPath "."', () => {
    // The other half of the fork, and the majority case in the real catalog.
    const docsDir = path.join(remoteCachePath(REMOTE), 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'handbook.md'), '# Handbook\n', 'utf-8');
    writeManifest('file-artifact', 'docs/handbook.md');

    const doc = resolvePrimaryDoc(REMOTE, 'file-artifact');
    expect(doc?.relPath).toBe('.');
    expect(doc?.content).toBe('# Handbook\n');
  });

  it('prefers SKILL.md over README.md when a payload has both', () => {
    // A payload carrying both means the README is the packaging note.
    writeManifest('both');
    writePayloadDir('both', { 'README.md': '# Packaging\n', 'SKILL.md': '# Content\n' });
    expect(resolvePrimaryDoc(REMOTE, 'both')?.content).toBe('# Content\n');
  });

  it('falls back to a lone markdown file named after the artifact', () => {
    writeManifest('self-named');
    writePayloadDir('self-named', { 'self-named.md': '# Self named\n' });
    expect(resolvePrimaryDoc(REMOTE, 'self-named')?.relPath).toBe('self-named.md');
  });

  it('refuses to guess between several unconventional markdown files', () => {
    // Picking arbitrarily would present a guess as an answer.
    writeManifest('ambiguous');
    writePayloadDir('ambiguous', { 'one.md': '# One\n', 'two.md': '# Two\n' });
    expect(resolvePrimaryDoc(REMOTE, 'ambiguous')).toBeNull();
  });

  it('returns null for a payload of pure code rather than throwing', () => {
    // An agent asking about 230 artifacts should not have to try/catch each.
    writeManifest('code-only');
    writePayloadDir('code-only', { 'index.ts': 'export const a = 1;\n' });
    expect(resolvePrimaryDoc(REMOTE, 'code-only')).toBeNull();
  });

  it('returns null for a binary payload instead of emitting replacement characters', () => {
    const binDir = path.join(remoteCachePath(REMOTE), 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    writeManifest('binary', 'bin/logo.png');
    expect(resolvePrimaryDoc(REMOTE, 'binary')).toBeNull();
  });

  it('truncates an oversized document and SAYS it truncated', () => {
    // Reported rather than hidden: an agent silently handed half a document
    // will answer confidently from the half it saw.
    writeManifest('huge');
    writePayloadDir('huge', { 'SKILL.md': 'x'.repeat(200) });

    const doc = resolvePrimaryDoc(REMOTE, 'huge', { maxBytes: 50 });
    expect(doc?.content).toHaveLength(50);
    expect(doc?.truncated).toBe(true);
  });

  it('does not mark a document truncated when it fits', () => {
    writeManifest('small');
    writePayloadDir('small', { 'SKILL.md': 'short' });
    const doc = resolvePrimaryDoc(REMOTE, 'small', { maxBytes: DEFAULT_MAX_DOC_BYTES });
    expect(doc?.truncated).toBe(false);
  });

  it('returns null when the manifest names a payload that is not on disk', () => {
    // Routine against a stale cache, and not this function's to report.
    writeManifest('missing', 'docs/never-written.md');
    expect(resolvePrimaryDoc(REMOTE, 'missing')).toBeNull();
  });

  it('still throws for an unknown artifact id, which is a real error', () => {
    expect(() => resolvePrimaryDoc(REMOTE, 'no-such-artifact')).toThrow(/no-such-artifact/);
  });
});
