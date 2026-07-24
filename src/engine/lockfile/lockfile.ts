import * as fs from 'fs';
import * as path from 'path';
import { lockfilePath, projectDeliveryOsDir } from '../paths';
import { LockFile, LockEntry } from './types';

const EMPTY_LOCKFILE: LockFile = { version: 1, entries: [] };

/** Reads the cwd-scoped lockfile, returning an empty lockfile if none exists. */
export function readLockfile(cwd: string): LockFile {
  const filePath = lockfilePath(cwd);
  if (!fs.existsSync(filePath)) {
    return { version: 1, entries: [] };
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as LockFile;
  if (!parsed.entries || !Array.isArray(parsed.entries)) {
    return { ...EMPTY_LOCKFILE };
  }
  return parsed;
}

/**
 * Writes the lockfile atomically: write to a temp file in the same
 * directory, then rename over the destination. Avoids leaving a
 * half-written lock.json if the process is interrupted mid-write.
 */
export function writeLockfile(cwd: string, lockfile: LockFile): void {
  const dir = projectDeliveryOsDir(cwd);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = lockfilePath(cwd);
  const tmpPath = path.join(dir, `.lock.json.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(lockfile, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/** Upserts an entry by id: updates in place if present, appends otherwise. */
export function upsertEntry(cwd: string, entry: LockEntry): void {
  const lockfile = readLockfile(cwd);
  const idx = lockfile.entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    lockfile.entries[idx] = entry;
  } else {
    lockfile.entries.push(entry);
  }
  writeLockfile(cwd, lockfile);
}
