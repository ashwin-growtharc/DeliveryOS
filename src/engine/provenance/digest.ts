import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

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
