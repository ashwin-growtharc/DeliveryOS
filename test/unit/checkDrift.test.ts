import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkSourceDrift } from '../../src/engine/drift/checkDrift';
import { writeSourcesFile } from '../../src/engine/drift/recordSources';
import { SourcesFileMissingError } from '../../src/engine/errors';

describe('checkSourceDrift', () => {
  let payloadDir: string;
  let sourceRoot: string;

  beforeEach(() => {
    payloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-check-drift-payload-'));
    sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-check-drift-source-'));
  });

  afterEach(() => {
    fs.rmSync(payloadDir, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  });

  it('throws SourcesFileMissingError when the payload has no SOURCES.json', () => {
    expect(() => checkSourceDrift(payloadDir, sourceRoot)).toThrow(SourcesFileMissingError);
  });

  it('reports "unchanged" when the real source file is untouched since extraction', () => {
    const sourceFile = path.join(sourceRoot, 'src', 'components', 'ui', 'button.tsx');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, 'export function Button() { return null; }\n');

    writeSourcesFile(payloadDir, 'kortix-ai/suna -- apps/web', [
      {
        payloadPath: 'components/Button/Button.tsx',
        sourcePath: 'src/components/ui/button.tsx',
        sourceAbsolutePath: sourceFile,
      },
    ]);

    const results = checkSourceDrift(payloadDir, sourceRoot);
    expect(results).toEqual([
      {
        payloadPath: 'components/Button/Button.tsx',
        sourcePath: 'src/components/ui/button.tsx',
        status: 'unchanged',
      },
    ]);
  });

  it('reports "drifted" when the real source file has changed since extraction', () => {
    const sourceFile = path.join(sourceRoot, 'button.tsx');
    fs.writeFileSync(sourceFile, 'original content');

    writeSourcesFile(payloadDir, 'kortix-ai/suna -- apps/web', [
      { payloadPath: 'components/Button/Button.tsx', sourcePath: 'button.tsx', sourceAbsolutePath: sourceFile },
    ]);

    fs.writeFileSync(sourceFile, 'changed content');

    const results = checkSourceDrift(payloadDir, sourceRoot);
    expect(results[0].status).toBe('drifted');
  });

  it('reports "source-missing" when the real source file no longer exists', () => {
    const sourceFile = path.join(sourceRoot, 'button.tsx');
    fs.writeFileSync(sourceFile, 'content');

    writeSourcesFile(payloadDir, 'kortix-ai/suna -- apps/web', [
      { payloadPath: 'components/Button/Button.tsx', sourcePath: 'button.tsx', sourceAbsolutePath: sourceFile },
    ]);

    fs.rmSync(sourceFile);

    const results = checkSourceDrift(payloadDir, sourceRoot);
    expect(results[0].status).toBe('source-missing');
  });

  it('checks each entry independently across a mix of statuses', () => {
    const unchangedFile = path.join(sourceRoot, 'unchanged.tsx');
    const driftedFile = path.join(sourceRoot, 'drifted.tsx');
    const missingFile = path.join(sourceRoot, 'missing.tsx');
    fs.writeFileSync(unchangedFile, 'unchanged content');
    fs.writeFileSync(driftedFile, 'original content');
    fs.writeFileSync(missingFile, 'will be deleted');

    writeSourcesFile(payloadDir, 'kortix-ai/suna -- apps/web', [
      { payloadPath: 'components/A/A.tsx', sourcePath: 'unchanged.tsx', sourceAbsolutePath: unchangedFile },
      { payloadPath: 'components/B/B.tsx', sourcePath: 'drifted.tsx', sourceAbsolutePath: driftedFile },
      { payloadPath: 'components/C/C.tsx', sourcePath: 'missing.tsx', sourceAbsolutePath: missingFile },
    ]);

    fs.writeFileSync(driftedFile, 'changed content');
    fs.rmSync(missingFile);

    const results = checkSourceDrift(payloadDir, sourceRoot);
    const byPayloadPath = Object.fromEntries(results.map((r) => [r.payloadPath, r.status]));
    expect(byPayloadPath).toEqual({
      'components/A/A.tsx': 'unchanged',
      'components/B/B.tsx': 'drifted',
      'components/C/C.tsx': 'source-missing',
    });
  });
});
