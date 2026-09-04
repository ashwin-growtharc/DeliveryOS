import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveArtifact } from '../../src/engine/pull/pull';
import type { CatalogEntry } from '../../src/engine/catalog/catalog';
import { lastFetchedAt } from '../../src/engine/remote/remoteCache';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';

/**
 * "It does not exist" and "it is not in your copy" are different facts, and the
 * catalog is read from a local clone.
 *
 * When a colleague pushes an artifact upstream, every machine that has not
 * refreshed since reports it as nonexistent. That is the silent-coercion class
 * `AGENTS.md` names as the most repeated cause of user reports -- a failure that
 * reads as an ANSWER rather than as a gap. PLAN.md recorded this one as open and
 * predicted it would get worse under Phase 16 "because an agent will relay it as
 * fact". Phase 16 shipped, so it did.
 *
 * Both directions matter. Hedging every miss with a staleness caveat would trade
 * a wrong answer for an unusable one, so a genuine miss against a fresh cache
 * must still be reported plainly.
 */

let deliveryOsHome: string;
let originalEnv: string | undefined;
const REMOTE = 'stale-remote';

/** Creates a cache clone whose last fetch is `minutesAgo`. */
function seedCache(name: string, minutesAgo: number): void {
  const gitDir = path.join(remoteCachePath(name), '.git');
  fs.mkdirSync(gitDir, { recursive: true });
  const fetchHead = path.join(gitDir, 'FETCH_HEAD');
  fs.writeFileSync(fetchHead, '', 'utf-8');
  const when = new Date(Date.now() - minutesAgo * 60_000);
  fs.utimesSync(fetchHead, when, when);
  // The .git directory itself is the fallback when FETCH_HEAD is absent, so it
  // must be aged too or a "fresh" case could pass for the wrong reason.
  fs.utimesSync(gitDir, when, when);
}

function registerRemote(name: string): void {
  fs.writeFileSync(
    remotesRegistryPath(),
    JSON.stringify({
      remotes: [{ name, url: 'https://example.invalid/r', addedAt: new Date().toISOString() }],
    }),
    'utf-8',
  );
}

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-stale-'));
  process.env.DELIVERYOS_HOME = deliveryOsHome;
  fs.mkdirSync(deliveryOsHome, { recursive: true });
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.DELIVERYOS_HOME;
  else process.env.DELIVERYOS_HOME = originalEnv;
  fs.rmSync(deliveryOsHome, { recursive: true, force: true });
});

describe('resolving an id that is not in the local catalog', () => {
  it('says the catalog may be stale, rather than asserting the artifact does not exist', () => {
    registerRemote(REMOTE);
    seedCache(REMOTE, 60 * 26); // just over a day

    // An EMPTY catalog is passed deliberately: this is about what the refusal
    // says, not about catalog construction.
    let message = '';
    try {
      resolveArtifact('pushed-by-a-colleague', undefined, []);
      throw new Error('expected resolveArtifact to throw');
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('pushed-by-a-colleague');
    expect(message).toMatch(/refresh/i);
    expect(message, 'the age is what tells someone whether to act').toMatch(/day/i);
    // The point of the whole fix: it must not leave the caller concluding
    // nonexistence when the honest answer is "not in your copy".
    expect(message).toMatch(/may exist upstream/i);
  });

  it('reports a genuine miss plainly when the catalog was just refreshed', () => {
    // The counterweight. Without this the fix drifts into caveating every miss,
    // and an agent can no longer trust a negative answer at all.
    registerRemote(REMOTE);
    seedCache(REMOTE, 0);

    let message = '';
    try {
      resolveArtifact('genuinely-absent', undefined, []);
      throw new Error('expected resolveArtifact to throw');
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('genuinely-absent');
    expect(message, 'a fresh catalog must not be hedged').not.toMatch(/refresh/i);
    expect(message).not.toMatch(/may exist upstream/i);
  });

  it('hedges when the cache age cannot be determined at all', () => {
    // Three outcomes, not two: "fresh", "stale", and "unknowable". Treating the
    // third as fresh would assert a freshness nobody established.
    registerRemote(REMOTE); // registered, but never cloned

    let message = '';
    try {
      resolveArtifact('anything', undefined, []);
      throw new Error('expected resolveArtifact to throw');
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toMatch(/unknown age/i);
    expect(message).toMatch(/refresh/i);
  });

  it('names the remote, and its staleness, when the id exists elsewhere but not there', () => {
    // The named-remote branch is only reachable when the id exists in SOME
    // remote -- an id absent everywhere takes the generic path above. So the
    // catalog here holds it under a different remote, which is exactly the real
    // situation: "I know this artifact, just not from the source you named."
    registerRemote(REMOTE);
    seedCache(REMOTE, 90);

    const elsewhere = [{
      manifest: { id: 'some-id' } as unknown as CatalogEntry['manifest'],
      remoteName: 'another-remote',
    }];

    let message = '';
    try {
      resolveArtifact('some-id', REMOTE, elsewhere);
      throw new Error('expected resolveArtifact to throw');
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain(`"${REMOTE}"`);
    expect(message).toMatch(/hour/i);
    expect(message).toMatch(/refresh/i);
  });

  it('stays plain when no remotes are registered, since staleness is not the problem', () => {
    // Nothing to be stale about. Adding a "run refresh" hint here would send
    // someone to refresh a catalog that has no sources.
    fs.writeFileSync(remotesRegistryPath(), JSON.stringify({ remotes: [] }), 'utf-8');

    let message = '';
    try {
      resolveArtifact('some-id', undefined, []);
      throw new Error('expected resolveArtifact to throw');
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).not.toMatch(/refresh/i);
  });
});

describe('lastFetchedAt', () => {
  it('reads the fetch time from the clone, with no registry field to maintain', () => {
    registerRemote(REMOTE);
    seedCache(REMOTE, 120);

    const at = lastFetchedAt(REMOTE);
    expect(at).toBeInstanceOf(Date);
    const minutes = Math.round((Date.now() - (at as Date).getTime()) / 60_000);
    expect(minutes).toBeGreaterThanOrEqual(119);
    expect(minutes).toBeLessThanOrEqual(121);
  });

  it('falls back to the clone directory when FETCH_HEAD does not exist', () => {
    // A fresh `git clone` does not always write FETCH_HEAD. "When it was cloned"
    // is the right answer for a remote that has never been refreshed.
    registerRemote(REMOTE);
    seedCache(REMOTE, 30);
    fs.rmSync(path.join(remoteCachePath(REMOTE), '.git', 'FETCH_HEAD'));

    expect(lastFetchedAt(REMOTE)).toBeInstanceOf(Date);
  });

  it('returns undefined -- not a date -- when there is no cache at all', () => {
    expect(lastFetchedAt('never-cloned')).toBeUndefined();
  });
});
