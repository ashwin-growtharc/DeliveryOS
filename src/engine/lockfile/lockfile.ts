import * as fs from 'fs';
import * as path from 'path';
import * as properLockfile from 'proper-lockfile';
import { lockfilePath, projectDeliveryOsDir } from '../paths';
import { LockFile, LockEntry } from './types';
import { LockfileCorruptError } from '../errors';

const EMPTY_LOCKFILE: LockFile = { version: 1, entries: [] };

/** Reads the cwd-scoped lockfile, returning an empty lockfile if none exists. */
export function readLockfile(cwd: string): LockFile {
  const filePath = lockfilePath(cwd);
  if (!fs.existsSync(filePath)) {
    return { version: 1, entries: [] };
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  let parsed: LockFile;
  try {
    parsed = JSON.parse(raw) as LockFile;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new LockfileCorruptError(`Failed to parse lockfile "${filePath}": ${detail}`);
  }
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

/**
 * Upserts an entry by id: updates in place if present, appends otherwise.
 *
 * Wrapped in a real inter-process lock (`proper-lockfile`, an `mkdir`-based
 * advisory lock -- atomic on any filesystem, no native bindings, so this
 * can't repeat the SEA-packaging surprise `playwright-core`'s own dynamic
 * `require` caused earlier this project). Without it, this was a genuine,
 * present-tense read-modify-write race: the read (`readLockfile`) and the
 * write (`writeLockfile`) are two separate steps, so two callers racing
 * (e.g. the app's own 20-minute background auto-sync tick, and a manual
 * `pull`/`push` run from a terminal at the same moment, on the same
 * machine) could both read the same pre-race state, each compute a
 * "new" lockfile in memory from it, and the second writer's rename would
 * silently clobber the first writer's already-applied update -- a lost
 * update, not a crash, so nothing would ever surface it as an error.
 *
 * The lock target is the lockfile path itself, with `realpath: false` --
 * this project's lockfile is a plain project-local JSON file, never a
 * symlink, so there's no need to pay for (or require, per
 * `proper-lockfile`'s own default behavior) the target file already
 * existing before the very first lock in a fresh project.
 */
export async function upsertEntry(cwd: string, entry: LockEntry): Promise<void> {
  const dir = projectDeliveryOsDir(cwd);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = lockfilePath(cwd);

  const release = await properLockfile.lock(filePath, {
    realpath: false,
    retries: { retries: 20, minTimeout: 25, maxTimeout: 500 },
  });
  try {
    const lockfile = readLockfile(cwd);
    const idx = lockfile.entries.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      lockfile.entries[idx] = entry;
    } else {
      lockfile.entries.push(entry);
    }
    writeLockfile(cwd, lockfile);
  } finally {
    await release();
  }
}

/**
 * Removes an entry by id, if present -- the other half of `upsertEntry`,
 * needed by `removeArtifact` (Phase 13's uninstall) to drop a lockfile
 * entry once its real files have already been deleted from disk. Same
 * real inter-process lock, same read-modify-write-under-lock shape as
 * `upsertEntry` above (see its own doc comment for why the lock exists at
 * all -- the race it guards against applies just as much to a delete as
 * to an upsert). A no-op (not an error) when `id` isn't present, so a
 * caller that already confirmed the entry exists via `readLockfile`
 * doesn't need to handle a surprise failure here too.
 */
export async function removeEntry(cwd: string, id: string): Promise<void> {
  const dir = projectDeliveryOsDir(cwd);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = lockfilePath(cwd);

  const release = await properLockfile.lock(filePath, {
    realpath: false,
    retries: { retries: 20, minTimeout: 25, maxTimeout: 500 },
  });
  try {
    const lockfile = readLockfile(cwd);
    lockfile.entries = lockfile.entries.filter((e) => e.id !== id);
    writeLockfile(cwd, lockfile);
  } finally {
    await release();
  }
}
