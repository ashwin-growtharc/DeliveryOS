import * as crypto from 'crypto';

function pad(n: number, width = 2): string {
  return n.toString().padStart(width, '0');
}

function utcTimestamp(date: Date): string {
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  );
}

/**
 * Turns an arbitrary artifact id into something safe to embed in a git ref.
 * Refs can't contain whitespace or most punctuation (`git help
 * check-ref-format`) -- an id like "GrowthArc-Brand Guidelines" (spaces,
 * typed as-is into the Add New form's free-text Artifact ID field) would
 * otherwise produce an invalid ref and make the branch create fail outright.
 * Lowercases, replaces every run of non `[a-z0-9._-]` characters with a
 * single `-`, then trims leading/trailing `-`/`.` (refs can't start with
 * `.` or end with `.lock`).
 */
function slugifyForRef(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  // An id made entirely of characters this strips (e.g. "???", or an
  // all-emoji id) slugifies to "" -- buildBranchName would then produce
  // an invalid double-slash ref (`deliveryos//<timestamp>-<hex>`), failing
  // deep inside createBranch with a cryptic git error instead of naming
  // the real problem. Falls back to a short hash of the ORIGINAL id so
  // the branch name stays a function of the id (two pushes for the same
  // unslugifiable id still get visibly-related branch names), rather than
  // a fixed placeholder that would look identical for every such id.
  if (slug.length === 0) {
    return `artifact-${crypto.createHash('sha256').update(id).digest('hex').slice(0, 8)}`;
  }
  return slug;
}

/**
 * Builds the branch name a push creates its PR from:
 * `deliveryos/<slugified id>/<UTC YYYYMMDDHHmmss>-<4 random hex chars>`.
 *
 * `now` defaults to the current time; it's an optional parameter purely so
 * tests can pin it for deterministic assertions.
 */
export function buildBranchName(id: string, now: Date = new Date()): string {
  const timestamp = utcTimestamp(now);
  const suffix = crypto.randomBytes(2).toString('hex');
  return `deliveryos/${slugifyForRef(id)}/${timestamp}-${suffix}`;
}
