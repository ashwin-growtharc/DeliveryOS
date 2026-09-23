import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** sha256 of one buffer, hex. The building block `computePayloadDigest` uses
 * per file, exported for the adoption mirror, which records a hash per mirrored
 * file so a later run can say what changed. */
export function sha256Hex(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** sha256 of a file, hex, read in chunks. `readFileSync` refuses anything over
 * Node's buffer ceiling (2 GiB) and holds the whole file in memory below it;
 * a client's library can contain a recorded workshop next to its templates,
 * and hashing it should cost bandwidth, not a crash. Synchronous, because the
 * mirror is. */
export function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunk = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      hash.update(chunk.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function listFilesRecursive(dir: string, baseDir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath, baseDir));
    } else if (entry.isFile()) {
      files.push(path.relative(baseDir, fullPath).split(path.sep).join('/'));
    }
  }
  return files;
}

/**
 * Deterministic sha256 digest over a payload's actual content -- independent
 * of file system metadata (mtimes, permissions) or traversal/OS
 * path-separator order, so the same tree hashes identically whether it's a
 * fresh git checkout on Windows or Linux. Handles both a directory payload
 * (the common case) and a single-file payload (a real, already-supported
 * shape -- see push.e2e.test.ts's single-file payload coverage).
 *
 * Deliberately reimplemented (not imported) by the signing workflow on the
 * artifact's OWNING remote (a separate repo/runtime) -- see
 * .github/workflows/sign-artifacts.yml on growtharc-ai-helpers -- so the
 * exact algorithm here is kept intentionally simple: sort relative POSIX
 * paths, then hash `relPath\0sha256(content)\n` for each in order.
 */
export function computePayloadDigest(payloadPath: string): string {
  const stat = fs.statSync(payloadPath);
  const hash = crypto.createHash('sha256');

  if (stat.isFile()) {
    const fileHash = crypto.createHash('sha256').update(fs.readFileSync(payloadPath)).digest('hex');
    hash.update(`${path.basename(payloadPath)}\0${fileHash}\n`);
  } else {
    const relPaths = listFilesRecursive(payloadPath, payloadPath).sort();
    for (const relPath of relPaths) {
      const fileHash = crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(payloadPath, relPath)))
        .digest('hex');
      hash.update(`${relPath}\0${fileHash}\n`);
    }
  }

  return `sha256:${hash.digest('hex')}`;
}
