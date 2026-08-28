import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readRegistry,
  addRemoteEntry,
  removeRemoteEntry,
  findRemote,
  listRemotes,
  deriveNameFromUrl,
} from '../../src/engine/remote/remoteRegistry';
import { remotesRegistryPath } from '../../src/engine/paths';
import { RemoteRegistryError } from '../../src/engine/errors';

let deliveryOsHome: string;
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-remote-registry-test-'));
  process.env.DELIVERYOS_HOME = deliveryOsHome;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.DELIVERYOS_HOME;
  } else {
    process.env.DELIVERYOS_HOME = originalEnv;
  }
  fs.rmSync(deliveryOsHome, { recursive: true, force: true });
});

describe('deriveNameFromUrl', () => {
  it('takes the last path segment and strips a trailing .git suffix', () => {
    expect(deriveNameFromUrl('https://github.com/org/my-repo.git')).toBe('my-repo');
  });

  it('works without a .git suffix', () => {
    expect(deriveNameFromUrl('https://github.com/org/my-repo')).toBe('my-repo');
  });

  it('strips a trailing slash before taking the last segment', () => {
    expect(deriveNameFromUrl('https://github.com/org/my-repo/')).toBe('my-repo');
  });

  it('handles a local filesystem path with backslashes', () => {
    expect(deriveNameFromUrl('C:\\Users\\me\\repos\\my-repo')).toBe('my-repo');
  });
});

describe('readRegistry', () => {
  it('returns an empty registry when the file does not exist yet', () => {
    expect(readRegistry()).toEqual({ remotes: [] });
  });

  it('returns an empty registry for a malformed shape (no "remotes" array)', () => {
    fs.mkdirSync(deliveryOsHome, { recursive: true });
    fs.writeFileSync(remotesRegistryPath(), JSON.stringify({ notRemotes: [] }), 'utf-8');
    expect(readRegistry()).toEqual({ remotes: [] });
  });

  it('throws RemoteRegistryError (not a raw SyntaxError) for genuinely invalid JSON', () => {
    fs.mkdirSync(deliveryOsHome, { recursive: true });
    fs.writeFileSync(remotesRegistryPath(), '{ not valid json !!', 'utf-8');
    expect(() => readRegistry()).toThrow(RemoteRegistryError);
  });
});

describe('addRemoteEntry / removeRemoteEntry', () => {
  it('adds a new entry, findable via findRemote and listRemotes', async () => {
    await addRemoteEntry({ name: 'origin', url: 'https://example.invalid/repo', addedAt: '2026-01-01T00:00:00.000Z' });

    expect(findRemote('origin')).toEqual({
      name: 'origin',
      url: 'https://example.invalid/repo',
      addedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(listRemotes()).toHaveLength(1);
  });

  it('throws RemoteRegistryError (without mutating the registry) on a duplicate name', async () => {
    await addRemoteEntry({ name: 'origin', url: 'https://example.invalid/a', addedAt: '2026-01-01T00:00:00.000Z' });

    await expect(
      addRemoteEntry({ name: 'origin', url: 'https://example.invalid/b', addedAt: '2026-01-02T00:00:00.000Z' }),
    ).rejects.toThrow(RemoteRegistryError);

    // The original entry survives untouched -- not overwritten by the
    // rejected duplicate add.
    expect(findRemote('origin')?.url).toBe('https://example.invalid/a');
    expect(listRemotes()).toHaveLength(1);
  });

  it('removes an existing entry', async () => {
    await addRemoteEntry({ name: 'origin', url: 'https://example.invalid/repo', addedAt: '2026-01-01T00:00:00.000Z' });
    await removeRemoteEntry('origin');
    expect(findRemote('origin')).toBeUndefined();
    expect(listRemotes()).toEqual([]);
  });

  it('throws RemoteRegistryError when removing a name that is not registered', async () => {
    await expect(removeRemoteEntry('does-not-exist')).rejects.toThrow(RemoteRegistryError);
  });

  it('a burst of concurrent adds for DISTINCT names never drops one -- the same real read-modify-write race lockfile.ts\'s own upsertEntry test guards against', async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        addRemoteEntry({ name: `remote-${i}`, url: `https://example.invalid/${i}`, addedAt: new Date().toISOString() })),
    );

    const names = listRemotes().map((r) => r.name).sort();
    expect(names).toEqual(['remote-0', 'remote-1', 'remote-2', 'remote-3', 'remote-4']);
  });
});
