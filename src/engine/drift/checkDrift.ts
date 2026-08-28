import * as fs from 'fs';
import * as path from 'path';
import { SourcesFileMissingError } from '../errors';
import { hashFile } from './hashFile';
import { SourcesFile } from './types';
import { resolveContainedPath } from '../paths';

export interface DriftResult {
  payloadPath: string;
  sourcePath: string;
  status: 'unchanged' | 'drifted' | 'source-missing';
}

/**
 * For each entry recorded in `payloadDir`'s `SOURCES.json`, re-hashes the
 * real source file at `sourceRootAbsolutePath/entry.sourcePath` right now
 * and compares it against the hash frozen at extraction time. Deliberately
 * does NOT diff the transformed payload file against the source -- that
 * would require modeling every deliberate rewrite (import paths, etc.);
 * this only answers "has the ORIGINAL source itself changed since
 * extraction?" (see the source-drift-detection plan's "key
 * simplification").
 */
export function checkSourceDrift(payloadDir: string, sourceRootAbsolutePath: string): DriftResult[] {
  const sourcesFilePath = path.join(payloadDir, 'SOURCES.json');
  if (!fs.existsSync(sourcesFilePath)) {
    throw new SourcesFileMissingError(
      `No SOURCES.json found at "${payloadDir}" -- this artifact wasn't recorded with source-drift `
        + 'tracking, so there is nothing to check drift against.',
    );
  }

  const sourcesFile: SourcesFile = JSON.parse(fs.readFileSync(sourcesFilePath, 'utf-8'));

  return sourcesFile.entries.map((entry) => {
    // entry.sourcePath comes from the ARTIFACT's own SOURCES.json --
    // author-controlled, not something DeliveryOS wrote, unlike
    // `sourceRootAbsolutePath` itself (a real local folder the user picked
    // via a native dialog). Same containment check pull.ts/push.ts already
    // apply to other manifest/payload-declared paths: an unchecked
    // "../../../../etc/passwd"-shaped entry would otherwise let a crafted
    // SOURCES.json read and hash an arbitrary file outside the folder the
    // user actually pointed this at. Treated the same as a genuinely
    // missing source file -- there's nothing safe to check it against.
    const sourceAbsolutePath = resolveContainedPath(sourceRootAbsolutePath, entry.sourcePath);
    if (!sourceAbsolutePath || !fs.existsSync(sourceAbsolutePath)) {
      return { payloadPath: entry.payloadPath, sourcePath: entry.sourcePath, status: 'source-missing' as const };
    }
    const currentHash = hashFile(sourceAbsolutePath);
    return {
      payloadPath: entry.payloadPath,
      sourcePath: entry.sourcePath,
      status: currentHash === entry.sourceHashAtExtraction ? ('unchanged' as const) : ('drifted' as const),
    };
  });
}
