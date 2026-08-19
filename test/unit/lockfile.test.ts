import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readLockfile, upsertEntry, removeEntry } from '../../src/engine/lockfile/lockfile';
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
    // not a crash, so nothing would ever surface it as an error. Verified
    // by hand that this test actually catches it, not just theoretically:
    // temporarily bypassing the lock (with a small artificial delay
    // between the read and the write, to force the interleaving a real
    // race would have) made this test fail hard -- only 1 of these 5
    // entries survived, not "occasionally 4," a real and dramatic loss.
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

  it('a burst of same-id AND different-id upserts together never drops an id', async () => {
    // A same-id-only version of the race above turns out NOT to be a
    // meaningful regression test -- verified by hand: every concurrent
    // upsertEntry call computes a full replacement array from its own
    // snapshot read, so N racing writers all targeting the SAME id can
    // only ever produce "last write wins" (exactly one valid entry,
    // whichever writer's rename happened last), never a duplicate or a
    // dropped entry -- that's true with or without the lock, since
    // there's nothing else for a same-id race to lose. The REAL risk this
    // test guards instead: a realistic mixed burst (some calls repeatedly
    // updating one id, others adding brand-new distinct ids at the same
    // time) must still never lose one of the DISTINCT ids to the same
    // lost-update race the test above demonstrates -- same underlying
    // bug, just interleaved with same-id contention too.
    await Promise.all([
      ...Array.from({ length: 5 }, (_, i) =>
        upsertEntry(cwd, { id: 'artifact-a', version: `1.0.${i}`, remote: 'test-remote' })),
      upsertEntry(cwd, { id: 'artifact-b', version: '1.0.0', remote: 'test-remote' }),
      upsertEntry(cwd, { id: 'artifact-c', version: '1.0.0', remote: 'test-remote' }),
    ]);

    const lockfile = readLockfile(cwd);
    const ids = lockfile.entries.map((e) => e.id).sort();
    expect(ids).toEqual(['artifact-a', 'artifact-b', 'artifact-c']);
    // artifact-a's final version is genuinely nondeterministic (whichever
    // of the 5 racing writes to it finished last) -- only its shape is
    // asserted, not a specific value.
    const a = lockfile.entries.find((e) => e.id === 'artifact-a');
    expect(a?.version).toMatch(/^1\.0\.\d$/);
  });

  it('removeEntry removes the matching entry and leaves every other entry untouched', async () => {
    await upsertEntry(cwd, { id: 'artifact-a', version: '1.0.0', remote: 'test-remote' });
    await upsertEntry(cwd, { id: 'artifact-b', version: '2.0.0', remote: 'test-remote', installTarget: '/tmp/b' });
    await upsertEntry(cwd, { id: 'artifact-c', version: '3.0.0', remote: 'other-remote' });

    await removeEntry(cwd, 'artifact-b');

    const lockfile = readLockfile(cwd);
    const ids = lockfile.entries.map((e) => e.id).sort();
    expect(ids).toEqual(['artifact-a', 'artifact-c']);
    // The surviving entries are untouched, not just present by id.
    expect(lockfile.entries.find((e) => e.id === 'artifact-a')).toEqual({
      id: 'artifact-a',
      version: '1.0.0',
      remote: 'test-remote',
    });
    expect(lockfile.entries.find((e) => e.id === 'artifact-c')).toEqual({
      id: 'artifact-c',
      version: '3.0.0',
      remote: 'other-remote',
    });
  });

  it('removeEntry on an id that is not present is a safe no-op', async () => {
    await upsertEntry(cwd, { id: 'artifact-a', version: '1.0.0', remote: 'test-remote' });

    await removeEntry(cwd, 'does-not-exist');

    const lockfile = readLockfile(cwd);
    expect(lockfile.entries.map((e) => e.id)).toEqual(['artifact-a']);
  });
});
