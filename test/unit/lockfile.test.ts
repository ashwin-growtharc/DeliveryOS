import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readLockfile, upsertEntry } from '../../src/engine/lockfile/lockfile';
import { lockfilePath, projectDeliveryOsDir } from '../../src/engine/paths';

let cwd: string;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-lockfile-test-'));
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe('lockfile', () => {
  it('returns an empty lockfile when none exists yet', () => {
    const lockfile = readLockfile(cwd);
    expect(lockfile).toEqual({ version: 1, entries: [] });
  });

  it('upsert of a new id adds an entry', () => {
    upsertEntry(cwd, { id: 'artifact-a', version: '1.0.0', remote: 'test-remote' });
    const lockfile = readLockfile(cwd);
    expect(lockfile.entries).toEqual([{ id: 'artifact-a', version: '1.0.0', remote: 'test-remote' }]);
  });

  it('upsert of an existing id updates in place without duplicating', () => {
    upsertEntry(cwd, { id: 'artifact-a', version: '1.0.0', remote: 'test-remote' });
    upsertEntry(cwd, { id: 'artifact-a', version: '2.0.0', remote: 'test-remote' });

    const lockfile = readLockfile(cwd);
    expect(lockfile.entries).toHaveLength(1);
    expect(lockfile.entries[0]).toEqual({ id: 'artifact-a', version: '2.0.0', remote: 'test-remote' });
  });

  it('keeps distinct ids as separate entries', () => {
    upsertEntry(cwd, { id: 'artifact-a', version: '1.0.0', remote: 'test-remote' });
    upsertEntry(cwd, { id: 'artifact-b', version: '1.0.0', remote: 'test-remote' });

    const lockfile = readLockfile(cwd);
    expect(lockfile.entries).toHaveLength(2);
  });

  it('writes atomically, leaving no temp file behind on success', () => {
    upsertEntry(cwd, { id: 'artifact-a', version: '1.0.0', remote: 'test-remote' });

    expect(fs.existsSync(lockfilePath(cwd))).toBe(true);
    const dirEntries = fs.readdirSync(projectDeliveryOsDir(cwd));
    const tmpFiles = dirEntries.filter((name) => name.includes('.tmp'));
    expect(tmpFiles).toEqual([]);
  });
});
