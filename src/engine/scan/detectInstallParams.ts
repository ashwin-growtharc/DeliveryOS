import * as fs from 'fs';
import { listFilesRecursively } from './listFiles';

const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|prisma)$/;
const PROCESS_ENV_DOT_PATTERN = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
// Bracket-notation access (`process.env['FOO']`/`process.env["FOO"]`) is
// real, valid syntax distinct from dot-notation -- e.g. used when a key
// needs to be read dynamically, or just by author preference. Missing it
// entirely would silently under-detect any payload that happens to use
// this form for a real env var.
const PROCESS_ENV_BRACKET_PATTERN = /process\.env\[\s*["']([A-Z_][A-Z0-9_]*)["']\s*\]/g;
// Prisma's own convention for referencing an env var from a schema file
// (`datasource db { url = env("DATABASE_URL") }`) -- a real, distinct
// syntax from `process.env.X`, worth matching directly rather than
// missing every Prisma-based artifact's connection string entirely.
const PRISMA_ENV_PATTERN = /\benv\(\s*["']([A-Z_][A-Z0-9_]*)["']\s*\)/g;

/** A naming-pattern guess, not a certainty -- presented to a person as a
 * starting point to correct in the Add New form, never as an authoritative
 * claim. Real, already-shipped `install_params` don't follow this pattern
 * perfectly either (`DATABASE_URL` is secret despite not matching
 * SECRET/KEY/TOKEN/PASSWORD; `AUTH_URL` isn't secret despite ending in
 * `_URL`) -- exactly why this stays a correctable proposal, not an
 * auto-applied fact. */
const LIKELY_SECRET_PATTERN = /SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|_KEY$|DATABASE_URL|CONNECTION/i;

export interface DetectedInstallParam {
  key: string;
  /** Deliberately blank, not a fabricated guess -- "make the autofill
   * good, don't decorate it" (the same lesson this project already
   * learned once, removing Scan's old "AI guessed" sparkle badge because
   * the guess was useful but badging it as AI-generated wasn't). A key
   * name detected via a real `process.env.X` reference is a reliable,
   * mechanical fact; a plausible-sounding description of WHAT that value
   * is for is not -- that's left for a person to fill in themselves in
   * the Add New form, rather than confidently generating text that reads
   * like real analysis but might just be wrong. */
  description: string;
  secret: boolean;
  required: boolean;
}

/**
 * Phase 10 item 3: proposes `install_params` for a new artifact by
 * actually reading its payload source for real `process.env.X`,
 * `process.env['X']` (bracket notation is real, distinct syntax --
 * missing it would silently under-detect), and Prisma's own `env("X")`
 * usage -- a genuinely reliable, mechanical fact
 * (the key name really is referenced in the code), unlike guessing what
 * it's FOR. Every proposed entry defaults `required: true` (a real,
 * deliberate simplification: a plain regex over source text can't
 * reliably tell whether a call site has its own fallback, e.g.
 * `process.env.X ?? 'default'` vs. a bare reference that would actually
 * crash at runtime if unset -- defaulting to `required: true` and letting
 * a person uncheck it in the Add New form is the safer direction to be
 * wrong in than silently marking something optional that the code
 * actually needs).
 *
 * **Real, honest limitation, found by running this against the actual
 * shipped `nextauth-credentials` artifact**: it detects NOTHING there.
 * `AUTH_SECRET`/`AUTH_URL` are read implicitly by Auth.js's own internal
 * library code, never referenced in this artifact's own payload source at
 * all; `DATABASE_URL` lives in the CONSUMING project's own
 * `prisma/schema.prisma` (deliberately never part of this payload --
 * Tier 3, never auto-merged), not the `prisma-schema-snippet.prisma`
 * reference file this payload actually ships. Pure static analysis over a
 * payload's own text genuinely cannot see either of these -- there's
 * nothing to editorialize around it; this is a real, structural
 * limitation of what this mechanism can catch, worth stating plainly
 * rather than papering over. It still catches the case it was actually
 * built for: an artifact whose own payload code contains real, explicit
 * `process.env.X`/Prisma `env("X")` references.
 */
export function detectInstallParams(payloadPath: string): DetectedInstallParam[] {
  // A payload can be a single file, not just a directory (a real,
  // already-supported shape elsewhere in this codebase -- see
  // computePayloadDigest's own same handling).
  const stat = fs.statSync(payloadPath);
  const files = stat.isFile() ? [payloadPath] : listFilesRecursively(payloadPath, SOURCE_FILE_PATTERN);
  const keys = new Set<string>();

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      // Same "one bad sibling file shouldn't erase everyone else's
      // detection" principle already used elsewhere in this codebase
      // (extractPropsSchemas, generateTailwindCss).
      continue;
    }

    for (const match of content.matchAll(PROCESS_ENV_DOT_PATTERN)) {
      keys.add(match[1]);
    }
    for (const match of content.matchAll(PROCESS_ENV_BRACKET_PATTERN)) {
      keys.add(match[1]);
    }
    for (const match of content.matchAll(PRISMA_ENV_PATTERN)) {
      keys.add(match[1]);
    }
  }

  return Array.from(keys)
    .sort()
    .map((key) => ({
      key,
      description: '',
      secret: LIKELY_SECRET_PATTERN.test(key),
      required: true,
    }));
}
