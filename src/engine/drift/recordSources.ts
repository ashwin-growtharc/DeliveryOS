import * as fs from 'fs';
import * as path from 'path';
import { hashFile } from './hashFile';
import { SourcesFile } from './types';

export interface SourcePair {
  /** Relative to the payload root, e.g. `components/Button/Button.tsx`. */
  payloadPath: string;
  /** Relative to whatever source root will later be passed to
   * `checkSourceDrift` (e.g. Suna's real `apps/web/` directory). */
  sourcePath: string;
  /** Absolute path to the real source file on disk right now, hashed
   * immediately to freeze what "at extraction" means. */
  sourceAbsolutePath: string;
}

/**
 * Writes `SOURCES.json` to `payloadDir`'s root, recording the real source
 * file's content hash for each pair right now -- called once, at
 * extraction time, from a one-off script (composing the actual list of
 * pairs is inherently specific to each extraction, not something to
 * generalize into a CLI flag interface -- see the source-drift-detection
 * plan). Not every payload file needs an entry: hand-written files like
 * `preview.tsx` or a generated `preview-css.ts` simply have none.
 */
export function writeSourcesFile(
  payloadDir: string,
  sourceDescription: string,
  pairs: SourcePair[],
): void {
  const sourcesFile: SourcesFile = {
    sourceDescription,
    recordedAt: new Date().toISOString(),
    entries: pairs.map((pair) => ({
      payloadPath: pair.payloadPath,
      sourcePath: pair.sourcePath,
      sourceHashAtExtraction: hashFile(pair.sourceAbsolutePath),
    })),
  };

  fs.writeFileSync(
    path.join(payloadDir, 'SOURCES.json'),
    `${JSON.stringify(sourcesFile, null, 2)}\n`,
    'utf-8',
  );
}
