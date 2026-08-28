import * as crypto from 'crypto';
import * as fs from 'fs';

/**
 * Sha256 digest of a single real file's content, in the same
 * `sha256:<hex>` format `computePayloadDigest` (`provenance/digest.ts`)
 * already establishes for whole payloads -- kept consistent so a hash
 * printed by either module reads the same way.
 */
export function hashFile(absolutePath: string): string {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
  return `sha256:${hash}`;
}
