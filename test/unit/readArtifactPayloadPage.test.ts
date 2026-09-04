import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  listArtifactPayloadFiles,
  readArtifactPayloadPage,
} from '../../src/engine/payload/readPayloadFile';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';

/**
 * The engine half of "take the template, here is my content, you get it done".
 *
 * `resolvePrimaryDoc` answers "what should a person read FIRST", and for most
 * artifacts that is the README -- the file that DESCRIBES the artifact. An agent
 * asked to fill a template in needs the template, a different file in the same
 * payload. These tests pin the three things that has to get right: naming the
 * files, distinguishing three outcomes from one empty string, and paging without
 * corrupting text.
 */

let deliveryOsHome: string;
let originalEnv: string | undefined;
const REMOTE = 'test-remote';
const ID = 'friction-log-ish';

/** Deliberately non-ASCII. Paginating a decoded string by BYTE offsets splits a
 * multi-byte character across the boundary and the halves never rejoin -- a bug
 * that passes an ASCII fixture and ships for every real template, in a repo
 * whose own docs are full of em dashes and curly quotes. */
const TEMPLATE = 'Root cause — the "why" — in full. Ünïcödé: é ü “ ” — done.\n'.repeat(6);

function payloadDir(): string {
  return path.join(remoteCachePath(REMOTE), 'artifacts', ID, 'payload');
}

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-payloadpage-'));
  process.env.DELIVERYOS_HOME = deliveryOsHome;
  fs.mkdirSync(deliveryOsHome, { recursive: true });
  fs.writeFileSync(
    remotesRegistryPath(),
    JSON.stringify({
      remotes: [{ name: REMOTE, url: 'https://example.invalid/r', addedAt: new Date().toISOString() }],
    }),
    'utf-8',
  );
  // `resolvePayloadDir` resolves through the catalog, so the artifact needs a
  // real manifest -- a bare directory is invisible to it.
  const artifactDir = path.join(remoteCachePath(REMOTE), 'artifacts', ID);
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, 'manifest.yaml'),
    [
      `id: ${ID}`,
      'kind: doc',
      'description: An artifact that ships a template beside its README',
      'owner: team-x',
      'version: 1.0.0',
      'source_repo: https://example.invalid/repo',
      `install_target: ${ID}`,
      'review_required: false',
      '',
    ].join('\n'),
    'utf-8',
  );

  const dir = payloadDir();
  fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# describes the artifact\n', 'utf-8');
  fs.writeFileSync(path.join(dir, 'template.md'), TEMPLATE, 'utf-8');
  fs.writeFileSync(path.join(dir, 'empty.md'), '', 'utf-8');
  fs.writeFileSync(path.join(dir, 'nested', 'deep.md'), 'nested\n', 'utf-8');
  // A NUL byte in the first block is what makes a file "not text" -- the same
  // heuristic git uses, and the thing that stops a decoded PNG reaching a model.
  fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.DELIVERYOS_HOME;
  else process.env.DELIVERYOS_HOME = originalEnv;
  fs.rmSync(deliveryOsHome, { recursive: true, force: true });
});

describe('artifact payload files, for an agent filling in a template', () => {
  it('names every payload file, so the template can be asked for by name', () => {
    expect(listArtifactPayloadFiles(REMOTE, ID)).toEqual([
      'README.md',
      'empty.md',
      'logo.png',
      'nested/deep.md',
      'template.md',
    ]);
  });

  it('THROWS for an artifact that does not exist, rather than reporting an empty payload', () => {
    // Deliberately not `[]`. An unknown artifact and an artifact with no files
    // are different facts, and an empty list would let a caller tell an agent
    // "that artifact ships nothing" when the truth is "there is no such
    // artifact" -- the coercion this codebase keeps finding. resolvePayloadDir
    // already throws; this pins that the wrapper does not soften it.
    expect(() => listArtifactPayloadFiles(REMOTE, 'no-such-artifact')).toThrow(/no artifact/i);
  });

  it('distinguishes real content, missing, not-text and empty -- four states, not one', () => {
    // The whole point. Collapsed to '' a caller cannot tell a missing template
    // from a PNG from an empty file, and reports success for all three.
    const real = readArtifactPayloadPage(REMOTE, ID, 'template.md');
    const missing = readArtifactPayloadPage(REMOTE, ID, 'nope.md');
    const binary = readArtifactPayloadPage(REMOTE, ID, 'logo.png');
    const empty = readArtifactPayloadPage(REMOTE, ID, 'empty.md');

    expect(real.kind).toBe('text');
    expect(missing.kind).toBe('not-found');
    expect(binary.kind).toBe('not-text');
    // An EMPTY file is text, and is not the same answer as a missing one.
    expect(empty.kind).toBe('text');
    if (empty.kind === 'text') {
      expect(empty.content).toBe('');
      expect(empty.totalChars).toBe(0);
      expect(empty.hasMore).toBe(false);
    }
  });

  it('refuses a path that escapes the payload directory', () => {
    // Containment is resolveWithinPayloadDir's and it throws. Asserted here
    // because this function is what an agent-supplied path reaches.
    expect(() => readArtifactPayloadPage(REMOTE, ID, '../manifest.yaml')).toThrow(/outside/i);
    expect(() => readArtifactPayloadPage(REMOTE, ID, '../../../../etc/passwd')).toThrow(/outside/i);
  });

  it('pages a non-ASCII file without losing or corrupting characters', () => {
    const whole = readArtifactPayloadPage(REMOTE, ID, 'template.md');
    if (whole.kind !== 'text') throw new Error('fixture should be text');

    let assembled = '';
    let offset = 0;
    for (let guard = 0; guard < 200; guard += 1) {
      const page = readArtifactPayloadPage(REMOTE, ID, 'template.md', { offset, limit: 17 });
      if (page.kind !== 'text') throw new Error('paging should stay text');
      assembled += page.content;
      offset += page.content.length;
      if (!page.hasMore) break;
    }

    expect(assembled).toEqual(whole.content);
    expect(assembled.length).toEqual(whole.totalChars);
    // Proves the fixture actually spans pages, so the assertion above is not
    // trivially true on a single-page file.
    expect(whole.totalChars).toBeGreaterThan(17);
    expect(assembled).toContain('—');
  });

  it('clamps an offset past the end instead of erroring', () => {
    const page = readArtifactPayloadPage(REMOTE, ID, 'template.md', { offset: 10_000_000 });
    expect(page.kind).toBe('text');
    if (page.kind === 'text') {
      expect(page.content).toBe('');
      expect(page.hasMore).toBe(false);
      // Still reports the real length, so a caller can recover.
      expect(page.totalChars).toBeGreaterThan(0);
    }
  });
});
