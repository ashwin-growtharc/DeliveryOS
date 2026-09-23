import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  describePayloadFiles,
  readArtifactPayloadBinary,
  PAYLOAD_BINARY_MAX_BYTES,
} from '../../src/engine/payload/readPayloadFile';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';
import { DeliveryOsError } from '../../src/engine/errors';
import { buildDocxBuffer } from '../fixtures/officeZip';

/**
 * Bytes for the desktop's Document tab.
 *
 * The interesting cases are the refusals: a path that escapes the payload must
 * THROW (containment is a refusal, never an absence), and a file over the cap
 * must be refused by its size before being read, in a sentence a person can
 * act on.
 */

let home: string;
let originalHome: string | undefined;
const REMOTE = 'test-remote';

function registerRemote(): void {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    remotesRegistryPath(),
    JSON.stringify({ remotes: [{ name: REMOTE, url: 'https://example.invalid/r', addedAt: new Date().toISOString() }] }),
    'utf-8',
  );
}

/** A directory payload: a README beside a template. */
function directoryArtifact(id: string): string {
  const artifactDir = path.join(remoteCachePath(REMOTE), 'artifacts', id);
  const payload = path.join(artifactDir, 'payload');
  fs.mkdirSync(path.join(payload, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'manifest.yaml'), manifest(id, id), 'utf-8');
  fs.writeFileSync(path.join(payload, 'README.md'), '# describes it\n', 'utf-8');
  fs.writeFileSync(path.join(payload, 'proposal.docx'), buildDocxBuffer([['Proposal ', 'template']]));
  fs.writeFileSync(path.join(payload, 'nested', 'deck.pptx'), Buffer.from([0x50, 0x4b, 0x00, 0x00]));
  return payload;
}

/** A single-file payload: the adopted shape, `payload_path` naming one file. */
function singleFileArtifact(id: string): void {
  const artifactDir = path.join(remoteCachePath(REMOTE), 'artifacts', id);
  fs.mkdirSync(path.join(remoteCachePath(REMOTE), 'templates'), { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(remoteCachePath(REMOTE), 'templates', 'sow.docx'), buildDocxBuffer([['Statement of work']]));
  fs.writeFileSync(path.join(artifactDir, 'manifest.yaml'), manifest(id, 'templates/sow.docx', 'templates/sow.docx'), 'utf-8');
}

function manifest(id: string, installTarget: string, payloadPath?: string): string {
  return [
    `id: ${id}`,
    'kind: doc',
    'description: A template',
    'owner: team-x',
    'version: 1.0.0',
    'source_repo: https://example.invalid/repo',
    `install_target: ${installTarget}`,
    ...(payloadPath ? [`payload_path: ${payloadPath}`] : []),
    'review_required: false',
    '',
  ].join('\n');
}

beforeEach(() => {
  originalHome = process.env.DELIVERYOS_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-binary-'));
  process.env.DELIVERYOS_HOME = home;
  registerRemote();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.DELIVERYOS_HOME;
  else process.env.DELIVERYOS_HOME = originalHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('describePayloadFiles', () => {
  it('lists a directory payload, and says it is not one file', () => {
    directoryArtifact('kit');
    expect(describePayloadFiles(REMOTE, 'kit')).toEqual({
      files: ['README.md', 'nested/deck.pptx', 'proposal.docx'],
      rootIsFile: false,
    });
  });

  it('names a single-file payload by its basename, and says it is one file', () => {
    // The two facts together are what the desktop needs: with `rootIsFile`
    // the installed path IS install_target; without it, install_target/<file>.
    singleFileArtifact('sow');
    expect(describePayloadFiles(REMOTE, 'sow')).toEqual({ files: ['sow.docx'], rootIsFile: true });
  });
});

describe('readArtifactPayloadBinary', () => {
  it('round-trips the bytes, with a name, a mime type and the size', () => {
    const payload = directoryArtifact('kit');
    const result = readArtifactPayloadBinary(REMOTE, 'kit', 'proposal.docx');
    expect(result.kind).toBe('bytes');
    if (result.kind !== 'bytes') return;
    const original = fs.readFileSync(path.join(payload, 'proposal.docx'));
    expect(Buffer.from(result.base64, 'base64').equals(original)).toBe(true);
    expect(result.size).toBe(original.length);
    expect(result.name).toBe('proposal.docx');
    expect(result.mime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('answers to the basename of a single-file payload', () => {
    singleFileArtifact('sow');
    expect(readArtifactPayloadBinary(REMOTE, 'sow', 'sow.docx').kind).toBe('bytes');
  });

  it('reports a missing file as not-found, not as empty bytes', () => {
    directoryArtifact('kit');
    expect(readArtifactPayloadBinary(REMOTE, 'kit', 'absent.docx')).toEqual({ kind: 'not-found' });
  });

  it('THROWS for a path that escapes the payload -- a refusal, never an absence', () => {
    directoryArtifact('kit');
    // The manifest sits one level above the payload. Reaching it by path is
    // exactly what containment exists to stop, and softening the throw into
    // `not-found` would be this codebase's own coercion habit applied to its
    // containment check.
    expect(() => readArtifactPayloadBinary(REMOTE, 'kit', '../manifest.yaml')).toThrow();
  });

  it('refuses a file over the cap by its size, before reading it, naming the cap', () => {
    const payload = directoryArtifact('kit');
    const big = path.join(payload, 'workshop.pdf');
    // Sparse: a file that reports a size well over the cap without costing
    // the disk that much. If the implementation read it before checking, this
    // test would allocate the whole thing.
    const fd = fs.openSync(big, 'w');
    fs.writeSync(fd, Buffer.from([0]), 0, 1, PAYLOAD_BINARY_MAX_BYTES + 5 * 1024 * 1024);
    fs.closeSync(fd);

    expect(() => readArtifactPayloadBinary(REMOTE, 'kit', 'workshop.pdf')).toThrow(DeliveryOsError);
    expect(() => readArtifactPayloadBinary(REMOTE, 'kit', 'workshop.pdf')).toThrow(/15\.0 MB, over the 10 MB limit/);
  });

  it('lets a caller lower the cap', () => {
    directoryArtifact('kit');
    expect(() => readArtifactPayloadBinary(REMOTE, 'kit', 'proposal.docx', { maxBytes: 16 })).toThrow(/over the 0 MB limit/);
  });
});
