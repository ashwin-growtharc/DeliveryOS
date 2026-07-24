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
 * Builds the branch name a push creates its PR from:
 * `deliveryos/<id>/<UTC YYYYMMDDHHmmss>-<4 random hex chars>`.
 *
 * `now` defaults to the current time; it's an optional parameter purely so
 * tests can pin it for deterministic assertions.
 */
export function buildBranchName(id: string, now: Date = new Date()): string {
  const timestamp = utcTimestamp(now);
  const suffix = crypto.randomBytes(2).toString('hex');
  return `deliveryos/${id}/${timestamp}-${suffix}`;
}
