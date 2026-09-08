/**
 * Where a catalog's files come from.
 *
 * THE SECOND DRIVEN PORT IN THIS CODEBASE
 *
 * `ARCHITECTURE.md` calls the repository a hexagon, and it is one on the
 * driving side: the MCP adapter declares three ports and seven tests fail the
 * build if it reaches past them. The driven side had exactly one -- `GithubClient`
 * (`src/engine/github/github.ts`), documented there as "a DRIVEN port, two impls".
 *
 * Storage was not a port at all. git was not plugged in, it was wired in:
 * `remoteCache.ts` imported `cloneTo`/`fetchAndReset` statically, and everything
 * downstream simply asked for a directory. This is that seam, named.
 *
 * `docs/hardening-ledger.md` records the bar this team set for building a port
 * at all -- a genuine second implementation waiting -- and names SharePoint, S3
 * and "a folder somewhere" as exactly that case.
 *
 * WHY THE REQUIRED CORE IS THIS SMALL
 *
 * Because it is all the read path ever wanted. Catalog parsing is a plain
 * `readdirSync`, update detection compares version strings from YAML, drift
 * detection hashes files, and the pristine snapshot is a byte-compared copy.
 * None of them know or care what put the files there. The engine's whole
 * question is: *put a directory of files here, and tell me when it last
 * changed.*
 *
 * Anything larger would be inventing requirements to justify the abstraction.
 */

/**
 * What a backend can and cannot do, declared rather than assumed.
 *
 * The pattern is capability negotiation, borrowed from `agent-native`'s
 * `PlatformAdapter` and recorded in `docs/agent-surface-plan.md` §6b: a backend
 * states what it supports and call sites ASSERT before relying on it. The
 * alternative -- assuming uniformity and discovering the gap at runtime -- is
 * how a SharePoint remote ends up half-working, with `push` producing a
 * confusing failure three layers deep instead of one honest refusal.
 */
export interface RemoteBackendCapabilities {
  /**
   * A change can be proposed, reviewed, and accepted or rejected as a distinct
   * thing.
   *
   * Note what this is NOT: "can be written to". A folder can be written to
   * perfectly well. What it cannot do is hold a proposal that somebody reviews
   * while the original stays untouched -- which is what `pushArtifact` means by
   * contributing, and why it stores a pull request number and later asks
   * whether it was merged, closed or is still open.
   */
  opensPullRequests: boolean;

  /**
   * Previous versions of a file can be recovered from the backend itself.
   *
   * Deliberately not "has an audit trail". SharePoint and OneDrive keep real,
   * attributed version history, and writing into a synced folder produces it --
   * but through the sync client, not through anything DeliveryOS can read from
   * a plain directory. A `folder` backend declares `false` because *it* cannot
   * offer history, whatever the storage underneath it happens to do.
   */
  hasVersionHistory: boolean;

  /**
   * A reader is guaranteed a coherent tree -- nobody rewrites files midway
   * through a read.
   *
   * `git fetch` plus the cache lock gives this. A sync daemon does not: it
   * rewrites files whenever the cloud says so, and `withRemoteCacheLock` cannot
   * stop a process it does not know about. That matters because
   * `computeChangedFiles` and `computePayloadDigest` are byte-exact and can read
   * a torn tree.
   */
  supportsAtomicWrite: boolean;
}

/**
 * The whole required surface. Three functions, all about materialising files.
 *
 * Threaded as a parameter rather than imported, exactly like `GithubClient`, so
 * a test injects a fake instead of building a real repository on disk. The e2e
 * suite currently creates a genuine git repo for every fixture; this is the seam
 * that makes that optional.
 */
export interface RemoteBackend {
  /** Stable identifier, recorded on the registry entry so a remote is read back
   * with the same backend it was added with. */
  readonly kind: RemoteBackendKind;

  readonly capabilities: RemoteBackendCapabilities;

  /** First-time population of `dest` from `source`. `dest` must not exist. */
  materialize(source: string, dest: string): Promise<void>;

  /** Bring an already-materialised `dest` up to date with its source. */
  refresh(dest: string): Promise<void>;

  /**
   * When `dest` was last brought up to date, or `undefined` when that genuinely
   * cannot be determined.
   *
   * `undefined` is a real third outcome, not a stand-in for "old". A caller that
   * cannot tell how stale a catalog is has to say so rather than assert
   * freshness -- `resolveArtifact` phrases its "no such artifact" refusal
   * differently depending on this, because "it does not exist" and "it is not in
   * your copy" are different facts.
   */
  lastChangedAt(dest: string): Date | undefined;
}

/**
 * Which backends exist.
 *
 * A string union rather than a runtime registry, deliberately: with two
 * implementations in one repository, a registry buys extensibility nobody has
 * asked for and costs the exhaustiveness checking that makes adding a third
 * backend a compile error at every site that must handle it.
 */
export type RemoteBackendKind = 'git' | 'folder';
