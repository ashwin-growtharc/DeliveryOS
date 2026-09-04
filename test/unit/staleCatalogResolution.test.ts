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
 *
 * WHY THESE ASSERT THE WHOLE SENTENCE, NOT SUBSTRINGS
 *
 * A substring assertion passes silently when the wording changes, so nobody
 * ever reads the new wording. That is exactly how "Your local catalog IS last
 * refreshed 1 day ago" shipped past `/day/i` and `/refresh/i` -- every
 * assertion passed and the sentence was ungrammatical. Only running the tool
 * caught it.
 *
 * An exact assertion cannot judge a sentence either. What it does is relocate
 * the reading: the moment wording changes the test fails, the full new sentence
 * lands in the diff, and somebody has to read it to make the suite green again.
 *
 * The usual objection is brittleness. Here that is the point, and the line is
 * worth stating: for a string an AGENT CONSUMES, the wording is the product, so
 * brittleness is correct. For an incidental log line it would not be. Exact
 * assertions belong on the first kind only.
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

    // The fixture pins the age at 26 hours, so this sentence is deterministic.
    expect(message).toBe(
      'No artifact with id "pushed-by-a-colleague" found in any registered remote.'
      + ' Your local catalog was last refreshed 1 day ago, so this may exist upstream'
      + ' already -- run `deliveryos refresh` and try again before concluding it does'
      + ' not exist.',
    );
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

    expect(message, 'a fresh catalog must not be hedged').toBe(
      'No artifact with id "genuinely-absent" found in any registered remote.',
    );
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

  it('says no remotes are configured, rather than implying the artifact is missing', () => {
    // The state every new user starts in. "Not found in any registered remote"
    // is technically true and practically misleading -- there are no registered
    // remotes. Deliberately does NOT suggest `refresh`: refreshing a catalog
    // with no sources does nothing.
    fs.writeFileSync(remotesRegistryPath(), JSON.stringify({ remotes: [] }), 'utf-8');

    let message = '';
    try {
      resolveArtifact('some-id', undefined, []);
      throw new Error('expected resolveArtifact to throw');
    } catch (err) {
      message = (err as Error).message;
    }

    // One coherent sentence, not a staleness message with a contradiction
    // stapled on. Asserting the whole thing is what stops "not found in any
    // registered remote" drifting back in front of it.
    expect(message).toBe(
      'Cannot look up "some-id": no remotes are configured yet.'
      + ' Add one with `deliveryos remote add <git-url>`.',
    );
    expect(message, 'refreshing a catalog with no sources does nothing').not.toMatch(/refresh/i);
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
