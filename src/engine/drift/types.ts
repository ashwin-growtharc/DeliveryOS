/**
 * One payload file that's a genuine port of a real external source file
 * (never a hand-written `preview.tsx`/generated `preview-css.ts` -- those
 * simply get no entry, same "presence, not a blanket rule" gating this app
 * uses everywhere else). `payloadPath`/`sourcePath` are both relative --
 * the former to the payload root, the latter to whatever source root is
 * later passed to `checkSourceDrift`.
 */
export interface SourceEntry {
  payloadPath: string;
  sourcePath: string;
  sourceHashAtExtraction: string;
}

/** The `SOURCES.json` file written once, at extraction time, to a
 * payload's root -- see `recordSources.ts`/`checkDrift.ts`. */
export interface SourcesFile {
  sourceDescription: string;
  recordedAt: string;
  entries: SourceEntry[];
}
