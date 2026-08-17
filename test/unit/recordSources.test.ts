import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeSourcesFile } from '../../src/engine/drift/recordSources';
import { hashFile } from '../../src/engine/drift/hashFile';
import { SourcesFile } from '../../src/engine/drift/types';

describe('writeSourcesFile', () => {
  let payloadDir: string;
  let sourceDir: string;

  beforeEach(() => {
    payloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-record-sources-payload-'));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-record-sources-source-'));
  });

  afterEach(() => {
    fs.rmSync(payloadDir, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it('writes a SOURCES.json at the payload root with the source file hashed right now', () => {
    const sourceFile = path.join(sourceDir, 'button.tsx');
    fs.writeFileSync(sourceFile, 'export function Button() { return null; }\n');
    const expectedHash = hashFile(sourceFile);

    writeSourcesFile(payloadDir, 'kortix-ai/suna -- apps/web', [
      {
        payloadPath: 'components/Button/Button.tsx',
        sourcePath: 'src/components/ui/button.tsx',
        sourceAbsolutePath: sourceFile,
      },
    ]);

    const written: SourcesFile = JSON.parse(
      fs.readFileSync(path.join(payloadDir, 'SOURCES.json'), 'utf-8'),
    );
    expect(written.sourceDescription).toBe('kortix-ai/suna -- apps/web');
    expect(written.entries).toEqual([
      {
        payloadPath: 'components/Button/Button.tsx',
        sourcePath: 'src/components/ui/button.tsx',
        sourceHashAtExtraction: expectedHash,
      },
    ]);
    expect(new Date(written.recordedAt).toString()).not.toBe('Invalid Date');
  });

  it('records multiple pairs in the order given', () => {
    const buttonFile = path.join(sourceDir, 'button.tsx');
    const cardFile = path.join(sourceDir, 'card.tsx');
    fs.writeFileSync(buttonFile, 'button');
    fs.writeFileSync(cardFile, 'card');

    writeSourcesFile(payloadDir, 'kortix-ai/suna -- apps/web', [
      { payloadPath: 'components/Button/Button.tsx', sourcePath: 'button.tsx', sourceAbsolutePath: buttonFile },
      { payloadPath: 'components/Card/Card.tsx', sourcePath: 'card.tsx', sourceAbsolutePath: cardFile },
    ]);

    const written: SourcesFile = JSON.parse(
      fs.readFileSync(path.join(payloadDir, 'SOURCES.json'), 'utf-8'),
    );
    expect(written.entries.map((e) => e.payloadPath)).toEqual([
      'components/Button/Button.tsx',
      'components/Card/Card.tsx',
    ]);
  });

  it('writes an empty entries array when given no pairs', () => {
    writeSourcesFile(payloadDir, 'kortix-ai/suna -- apps/web', []);
    const written: SourcesFile = JSON.parse(
      fs.readFileSync(path.join(payloadDir, 'SOURCES.json'), 'utf-8'),
    );
    expect(written.entries).toEqual([]);
  });
});
