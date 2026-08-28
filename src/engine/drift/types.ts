import { z } from 'zod';

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

/** Runtime shape check for a `SOURCES.json` read back off disk.
 *
 * `SOURCES.json` lives inside an artifact's PAYLOAD, so it arrives from a
 * remote and is author-controlled -- exactly the kind of input that gets a
 * schema everywhere else in the engine (see `ManifestSchema`). It used to be
 * `JSON.parse(...)` cast straight to `SourcesFile`, so malformed JSON
 * escaped as a raw `SyntaxError` stack trace and a structurally-wrong file
 * (no `entries`) died with `Cannot read properties of undefined (reading
 * 'map')` one line later. Both now surface as `SourcesFileInvalidError`. */
export const SourcesFileSchema = z.object({
  sourceDescription: z.string(),
  recordedAt: z.string(),
  entries: z.array(
    z.object({
      payloadPath: z.string(),
      sourcePath: z.string(),
      sourceHashAtExtraction: z.string(),
    }),
  ),
});
