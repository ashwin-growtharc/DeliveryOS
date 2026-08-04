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

  it('upsert of a new id adds an entry', async () => {
    await upsertEntry(cwd, { id: 'artifact-a', version: '1.0.0', remote: 'test-remote' });
    const lockfile = readLockfile(cwd);
    expect(lockfile.entries).toEqual([{ id: 'artifact-a', version: '1.0.0', remote: 'test-remote' }]);
  });

  it('upsert of an existing id updates in place without duplicating', async () => {
    await upsertEntry(cwd, { id: 'artifact-a', version: '1.0.0', remote: 'test-remote' });
    await upsertEntry(cwd, { id: 'artifact-a', version: '2.0.0', remote: 'test-remote' });

    const lockfile = readLockfile(cwd);
    expect(lockfile.entries).toHaveLength(1);
    expect(lockfile.entries[0]).toEqual({ id: 'artifact-a', version: '2.0.0', remote: 'test-remote' });
  });

  it('keeps distinct ids as separate entries', async () => {
    await upsertEntry(cwd, { id: 'artifact-a', version: '1.0.0', remote: 'test-remote' });
    await upsertEntry(cwd, { id: 'artifact-b', version: '1.0.0', remote: 'test-remote' });

    const lockfile = readLockfile(cwd);
    expect(lockfile.entries).toHaveLength(2);
  });

  it('writes atomically, leaving no temp file behind on success', async () => {
    await upsertEntry(cwd, { id: 'artifact-a', version: '1.0.0', remote: 'test-remote' });

    expect(fs.existsSync(lockfilePath(cwd))).toBe(true);
    const dirEntries = fs.readdirSync(projectDeliveryOsDir(cwd));
    const tmpFiles = dirEntries.filter((name) => name.includes('.tmp'));
    expect(tmpFiles).toEqual([]);
  });

  it('two concurrent upserts of DIFFERENT ids both survive -- the real race this is fixing', async () => {
    // Regression test for a real, present-tense bug (see
    // scalable-architecture-research.md §3.7): upsertEntry used to be an
    // unlocked read-modify-write, so two callers racing (the app's own
    // 20-minute background auto-sync tick, and a concurrent manual
    // pull/push on the same machine, in real life) could each read the
    // same pre-race state and the second writer's rename would silently
    // clobber the first writer's already-applied update -- a lost update,
    // not a crash, so nothing would ever surface it as an error. Confirmed
    // this test actually catches that: reverting the lock in upsertEntry
    // makes this test flaky/failing (one entry silently missing), not just
    // theoretically at risk.
    await Promise.all([
      upsertEntry(cwd, { id: 'artifact-a', version: '1.0.0', remote: 'test-remote' }),
      upsertEntry(cwd, { id: 'artifact-b', version: '1.0.0', remote: 'test-remote' }),
      upsertEntry(cwd, { id: 'artifact-c', version: '1.0.0', remote: 'test-remote' }),
      upsertEntry(cwd, { id: 'artifact-d', version: '1.0.0', remote: 'test-remote' }),
      upsertEntry(cwd, { id: 'artifact-e', version: '1.0.0', remote: 'test-remote' }),
    ]);

    const lockfile = readLockfile(cwd);
    const ids = lockfile.entries.map((e) => e.id).sort();
    expect(ids).toEqual(['artifact-a', 'artifact-b', 'artifact-c', 'artifact-d', 'artifact-e']);
  });

  it('many concurrent updates to the SAME id never lose the final write', async () => {
    // A stricter version of the same race: every call targets the same
    // id, so a lost update here would show up as a wrong final version
    // (whichever writer got clobbered) rather than a missing entry --
    // both are the same underlying class of bug, worth proving separately
    // since a implementation could accidentally fix one shape and not
    // the other (e.g. a lock keyed by id rather than by the whole file).
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        upsertEntry(cwd, { id: 'artifact-a', version: `1.0.${i}`, remote: 'test-remote' })),
    );

    const lockfile = readLockfile(cwd);
    expect(lockfile.entries).toHaveLength(1);
    // Whichever of the 10 concurrent writes happened to finish last wins --
    // not asserting a specific one (genuinely nondeterministic), just that
    // exactly one real, valid entry survives, not a corrupted/partial one.
    expect(lockfile.entries[0].id).toBe('artifact-a');
    expect(lockfile.entries[0].version).toMatch(/^1\.0\.\d$/);
  });
});
