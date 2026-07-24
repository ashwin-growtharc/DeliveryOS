import * as fs from 'fs';
import * as path from 'path';
import { PristineSnapshotMissingError } from '../errors';

export interface ChangedFile {
  relPath: string;
  status: 'added' | 'modified' | 'deleted';
}

/** Recursively lists every file (not directory) under `root`, as paths
 * relative to `root` with forward slashes (stable across platforms). */
export function listFilesRecursive(root: string): string[] {
  const result: string[] = [];

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        result.push(path.relative(root, fullPath).split(path.sep).join('/'));
      }
    }
  }

  if (fs.existsSync(root)) {
    walk(root);
  }

  return result;
}

/**
 * Compares the current contents of `installTarget` against the pristine
 * snapshot taken at pull time (`pristineDir`), by file existence and byte
 * content -- never mtimes. Returns the union of added/modified/deleted
 * files, sorted by relative path for a deterministic, reproducible order.
 *
 * Throws PristineSnapshotMissingError if `pristineDir` doesn't exist at
 * all: that means this id has a lockfile entry but no pristine snapshot on
 * disk (a stale/pre-upgrade pull), and diffing against nothing would
 * incorrectly report every file as "added". The fix is always to re-pull.
 */
export function computeChangedFiles(installTarget: string, pristineDir: string): ChangedFile[] {
  if (!fs.existsSync(pristineDir)) {
    throw new PristineSnapshotMissingError(
      `No pristine snapshot found at "${pristineDir}" for this artifact. This can happen if it was pulled before DeliveryOS tracked pristine snapshots. Re-pull it first: \`deliveryos pull <id>\`.`,
    );
  }

  const currentFiles = new Set(listFilesRecursive(installTarget));
  const pristineFiles = new Set(listFilesRecursive(pristineDir));
  const allPaths = Array.from(new Set([...currentFiles, ...pristineFiles])).sort();

  const changes: ChangedFile[] = [];
  for (const relPath of allPaths) {
    const inCurrent = currentFiles.has(relPath);
    const inPristine = pristineFiles.has(relPath);

    if (inCurrent && !inPristine) {
      changes.push({ relPath, status: 'added' });
      continue;
    }
    if (!inCurrent && inPristine) {
      changes.push({ relPath, status: 'deleted' });
      continue;
    }

    const currentContent = fs.readFileSync(path.join(installTarget, relPath));
    const pristineContent = fs.readFileSync(path.join(pristineDir, relPath));
    if (!currentContent.equals(pristineContent)) {
      changes.push({ relPath, status: 'modified' });
    }
  }

  return changes;
}
