import * as fs from 'fs';
import { resolvePayloadDir, resolveWithinPayloadDir } from './payloadDir';
import { listFilesRecursive } from '../push/diff';

/**
 * Reads a single file, by relative path, out of a catalog artifact's real
 * payload directory in its remote's local cache -- e.g. Detail's
 * required-config UX rendering a `backend-plugin` artifact's `README.md`
 * before anyone decides to pull it, the same "browse before you commit"
 * principle `compileArtifactPreview` already established for `ui-component`
 * live previews.
 *
 * Returns `undefined` (not an error) when the file doesn't exist -- most
 * artifacts have no README at all, and "no README" is a normal, common
 * case for a caller to render around, not a failure.
 */
export function readArtifactPayloadFile(
  remoteName: string,
  id: string,
  relativePath: string,
): string | undefined {
  const payloadDir = resolvePayloadDir(remoteName, id);
  const resolvedFilePath = resolveWithinPayloadDir(payloadDir, relativePath);

  if (!fs.existsSync(resolvedFilePath) || !fs.statSync(resolvedFilePath).isFile()) {
    return undefined;
  }

  return fs.readFileSync(resolvedFilePath, 'utf-8');
}

/**
 * Every file in an artifact's payload, as forward-slashed relative paths.
 *
 * Exists because knowing an artifact HAS a template is not the same as knowing
 * what the template is CALLED. `resolvePrimaryDoc` answers "what should a person
 * read first" and usually answers `README.md` -- the file that *describes* the
 * artifact. That is the wrong file for an agent asked to fill a template in:
 * `friction-log`'s actual format lives in `friction-log.md`, sitting beside that
 * README and unnameable without this list.
 *
 * `listFilesRecursive` already returns forward-slashed relative paths. Its
 * single-`''` result for a root that is itself a file is filtered out: an
 * artifact whose payload is one unnamed file is not something a caller can ask
 * for by path anyway.
 *
 * THROWS for an unknown artifact, because `resolvePayloadDir` does and this
 * deliberately does not soften it. "No such artifact" and "that artifact ships
 * no files" are different facts, and returning `[]` for the first would let a
 * caller tell an agent the second.
 */
export function listArtifactPayloadFiles(remoteName: string, id: string): string[] {
  return listFilesRecursive(resolvePayloadDir(remoteName, id))
    .filter((relPath) => relPath.length > 0)
    .sort();
}

/** One page of a payload file, or a typed reason there is none. */
export type PayloadPage =
  | { kind: 'text'; content: string; offset: number; limit: number; totalChars: number; hasMore: boolean }
  | { kind: 'not-found' }
  | { kind: 'not-text' };

/** How much of a file one page returns when the caller does not say. Large
 * enough that every real template arrives whole in one call, small enough that
 * a stray large file cannot flood a model's context. */
export const PAYLOAD_PAGE_DEFAULT_LIMIT = 40_000;

/** Bytes inspected when deciding whether a file is text. Git uses the same
 * "NUL in the first block" heuristic, and it is right for the thing we care
 * about: refusing to hand an agent a decoded PNG. */
const BINARY_SNIFF_BYTES = 8_000;

/**
 * Reads one page of a payload file, distinguishing three outcomes that an empty
 * string would collapse into one: real content, no such file, and not text.
 *
 * That distinction is the whole point. A caller that receives `''` cannot tell
 * an empty template from a missing one from a JPEG, and would report success for
 * all three -- the coercion habit this codebase keeps finding.
 *
 * Paginated by CHARACTERS of the decoded string, never by bytes. Slicing a
 * decoded string at byte offsets lets a UTF-8 multi-byte character straddle the
 * page boundary, so the two halves would not rejoin. This repo's own docs are
 * full of em dashes and curly quotes, so a byte-based implementation would pass
 * an ASCII fixture and corrupt every real template.
 *
 * THROWS when `relativePath` escapes the payload directory -- containment is
 * `resolveWithinPayloadDir`'s, deliberately not re-implemented here.
 */
export function readArtifactPayloadPage(
  remoteName: string,
  id: string,
  relativePath: string,
  options: { offset?: number; limit?: number } = {},
): PayloadPage {
  const payloadDir = resolvePayloadDir(remoteName, id);
  const resolvedFilePath = resolveWithinPayloadDir(payloadDir, relativePath);

  if (!fs.existsSync(resolvedFilePath) || !fs.statSync(resolvedFilePath).isFile()) {
    return { kind: 'not-found' };
  }

  const buffer = fs.readFileSync(resolvedFilePath);
  if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    return { kind: 'not-text' };
  }

  const whole = buffer.toString('utf-8');
  // Clamped rather than rejected: an agent paging through a file it has already
  // been told the length of should not get an error for asking one page too far.
  const offset = Math.max(0, Math.min(Math.trunc(options.offset ?? 0), whole.length));
  const limit = Math.max(1, Math.trunc(options.limit ?? PAYLOAD_PAGE_DEFAULT_LIMIT));
  const content = whole.slice(offset, offset + limit);

  return {
    kind: 'text',
    content,
    offset,
    limit,
    totalChars: whole.length,
    hasMore: offset + content.length < whole.length,
  };
}
