import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  listArtifactPayloadFiles,
  readArtifactPayloadPage,
  readArtifactPayloadFile,
} from '../../src/engine/payload/readPayloadFile';
import { resolvePrimaryDoc } from '../../src/engine/payload/primaryDoc';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';

/**
 * `payload_path` "may name a single file or a directory" (schema.ts:150-158),
 * and in the live catalog the single-file case is the MAJORITY: 131 of 230
 * artifacts, 57%.
 *
 * Every one of them reported `files: []` on the MCP surface, in the same
 * response as `hasDoc: true` -- while `read_artifact_file`'s own description
 * told the agent to read by a path listed in `files`. So the answer to "what
 * can I read here?" was "nothing" for most of the catalog, delivered as a
 * confident empty array rather than as an error.
 *
 * That is the worse half of the silent-coercion class `AGENTS.md` names. A
 * wrong error gets investigated; a wrong all-clear gets believed. Nothing was
 * unreachable -- `doc.content` carried the whole document the whole time -- but
 * an agent reading `files: []` has been told there is nothing more to look at.
 *
 * These pin the contract that replaced it:
 *   1. `files` is never empty for a payload that exists on disk.
 *   2. `doc.relPath` is always a member of `files`.
 *   3. every member of `files` reads back.
 * and, because (3) meant WIDENING what a file root accepts, that it accepts
 * nothing else.
 */

let deliveryOsHome: string;
let originalEnv: string | undefined;
const REMOTE = 'single-file-remote';
const ID = 'one-file-artifact';
const DOC = 'Ünïcödé — the whole document, in one file.\n'.repeat(4);

function writeManifest(id: string, payloadPath: string): void {
  const dir = path.join(remoteCachePath(REMOTE), 'artifacts', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.yaml'),
    [
      `id: ${id}`,
      'kind: doc',
      'description: An artifact whose entire payload is a single file',
      'owner: team-x',
      'version: 1.0.0',
      'source_repo: https://example.invalid/repo',
      `install_target: ${id}.md`,
      `payload_path: ${payloadPath}`,
      'review_required: false',
      '',
    ].join('\n'),
    'utf-8',
  );
}

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-singlefile-'));
  process.env.DELIVERYOS_HOME = deliveryOsHome;
  fs.mkdirSync(deliveryOsHome, { recursive: true });
  fs.writeFileSync(
    remotesRegistryPath(),
    JSON.stringify({
      remotes: [{ name: REMOTE, url: 'https://example.invalid/r', addedAt: new Date().toISOString() }],
    }),
    'utf-8',
  );

  const docsDir = path.join(remoteCachePath(REMOTE), 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'one-file-artifact.md'), DOC, 'utf-8');
  // A sibling the payload must never be able to reach. Same directory, so a
  // `../name` escape would find it if the allowlist were a path join.
  fs.writeFileSync(path.join(docsDir, 'not-yours.md'), 'SECRET\n', 'utf-8');

  writeManifest(ID, 'docs/one-file-artifact.md');
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.DELIVERYOS_HOME;
  else process.env.DELIVERYOS_HOME = originalEnv;
  fs.rmSync(deliveryOsHome, { recursive: true, force: true });
});

describe('an artifact whose whole payload is one file', () => {
  it('names that file, rather than reporting an empty payload', () => {
    // The defect, directly. This returned [] for 57% of the live catalog.
    expect(listArtifactPayloadFiles(REMOTE, ID)).toEqual(['one-file-artifact.md']);
  });

  it('gives the primary doc a usable address, not the sentinel dot', () => {
    // `relPath` used to be '.', which told a caller the SHAPE at the cost of
    // being unusable as an address -- and reached agents on the MCP surface as
    // a literal dot they could not pass to anything.
    const doc = resolvePrimaryDoc(REMOTE, ID);
    expect(doc).not.toBeNull();
    expect(doc!.relPath).toBe('one-file-artifact.md');
    expect(doc!.truncated).toBe(false);
    expect(doc!.content).toBe(DOC);
  });

  it('keeps the two invariants the MCP response now promises', () => {
    const files = listArtifactPayloadFiles(REMOTE, ID);
    const doc = resolvePrimaryDoc(REMOTE, ID);

    expect(files.length, 'files is never empty for a payload that is on disk').toBeGreaterThan(0);
    expect(files, 'doc.path is always one of files').toContain(doc!.relPath);

    // And the third: everything named reads back. A list of names that cannot
    // be read would be the same lie in a new shape.
    for (const name of files) {
      const page = readArtifactPayloadPage(REMOTE, ID, name);
      expect(page.kind, `"${name}" is listed, so it must be readable`).toBe('text');
    }
  });

  it('reads the whole file back through the name it listed', () => {
    const page = readArtifactPayloadPage(REMOTE, ID, 'one-file-artifact.md');
    expect(page.kind).toBe('text');
    if (page.kind !== 'text') return;
    expect(page.content).toBe(DOC);
    expect(page.totalChars).toBe(DOC.length);
    expect(page.hasMore).toBe(false);
  });

  it('still answers to the older spellings of "the payload itself"', () => {
    // '.' was the documented address before this change and '' is what
    // listFilesRecursive produced for a file root. Both keep working, so a
    // caller written against either is not broken by the rename.
    for (const alias of ['.', '', './']) {
      const page = readArtifactPayloadPage(REMOTE, ID, alias);
      expect(page.kind, `alias "${alias}"`).toBe('text');
    }
    expect(readArtifactPayloadFile(REMOTE, ID, '.')).toBe(DOC);
  });
});

describe('containment on a single-file payload', () => {
  // These matter because making the basename readable WIDENED what a file root
  // accepts. The widening is an allowlist of exactly three spellings of one
  // file; everything else still goes through `resolveWithinPayloadDir`
  // untouched, so a traversal attempt still THROWS rather than being reported
  // as an absence.
  //
  // That distinction is the reason these tests exist. The first version of the
  // fix routed a file root around the containment check and returned
  // `not-found` for `../not-yours.md` -- which is the same coercion this repo
  // keeps finding, applied to the security check itself. It was caught by these
  // failing against the PRE-FIX code: a test guarding a widening should pass
  // before and after, and one that flips is reporting a behaviour change
  // nobody asked for.

  it('refuses a sibling file in the same directory, and refuses it by throwing', () => {
    // `not-yours.md` sits beside the payload, so a join-based implementation
    // resolving '../not-yours.md' against the file's parent would read it.
    const escapes = ['../not-yours.md', '..\\not-yours.md', '..', '../'];
    for (const attempt of escapes) {
      expect(
        () => readArtifactPayloadPage(REMOTE, ID, attempt),
        `must refuse "${attempt}" outright, not report it absent`,
      ).toThrow(/outside this artifact/i);
      expect(() => readArtifactPayloadFile(REMOTE, ID, attempt)).toThrow(/outside this artifact/i);
    }
  });

  it('refuses absolute and deep-traversal paths', () => {
    for (const attempt of ['../../../../etc/passwd', '/etc/passwd']) {
      expect(
        () => readArtifactPayloadPage(REMOTE, ID, attempt),
        `must refuse "${attempt}"`,
      ).toThrow(/outside this artifact/i);
    }
  });

  it('reports a plausible in-payload name that is simply wrong as not-found', () => {
    // The other side of the line. 'README.md' does not escape anything -- it is
    // a name this payload does not have, and an absence is the honest answer.
    // A single-file payload has no README, and answering with the payload
    // itself would be answering a question nobody asked.
    for (const name of ['README.md', 'not-yours.md', 'nested/deep.md']) {
      expect(readArtifactPayloadPage(REMOTE, ID, name).kind, name).toBe('not-found');
    }
  });
});

describe('a manifest naming a payload that is not on disk', () => {
  it('reports no files rather than throwing, and no doc rather than an empty one', () => {
    // Routine against a stale cache: the manifest is fine, the file has not
    // been fetched. Distinct from "no such artifact", which still throws.
    writeManifest('ghost-artifact', 'docs/never-fetched.md');
    expect(listArtifactPayloadFiles(REMOTE, 'ghost-artifact')).toEqual([]);
    expect(resolvePrimaryDoc(REMOTE, 'ghost-artifact')).toBeNull();
    expect(() => listArtifactPayloadFiles(REMOTE, 'no-such-artifact')).toThrow(/no artifact/i);
  });
});
