import type { CatalogListEntry, SkippedCatalogManifest } from '../engine/catalog/catalog';
import type { PrimaryDoc } from '../engine/payload/primaryDoc';

/**
 * The driving port the MCP adapter talks to.
 *
 * DeliveryOS already had two driving adapters over one core -- the CLI
 * (`src/cli/**`) and the Tauri sidecar (`src/sidecar.ts`) -- but neither
 * declared what it needed from the engine; both simply imported engine
 * functions directly and wired argument shapes inline. That works until you
 * want to test the adapter, at which point there is no seam and you are back
 * to spawning processes against real git remotes (`test/e2e/sidecar.e2e.test.ts`
 * builds a whole correlation harness for exactly that reason).
 *
 * This is the third adapter, so it declares the port. `server.ts` depends on
 * this interface and NOTHING under `src/engine/**`; `engineAdapter.ts` is the
 * one file that binds it to the real core. The payoff is concrete rather than
 * architectural: the tool-surface tests inject a fake port and run in
 * milliseconds with no filesystem, no git, and no remotes -- which is the only
 * way "advertised equals callable" stays a guardrail instead of a chore.
 *
 * The port speaks in the core's own domain types (`CatalogListEntry`,
 * `PrimaryDoc`). Re-declaring those here would be duplication, not isolation:
 * the boundary that matters is that the adapter cannot reach engine BEHAVIOUR,
 * and a type import cannot.
 */

export interface CatalogSnapshot {
  entries: CatalogListEntry[];
  /** Manifests that could not be parsed. Carried WITH the catalog rather than
   * fetched separately, for the same reason the sidecar does it: a follow-up
   * call is a different request and would report nothing. An agent that is
   * told "230 artifacts" when 4 failed to load will reason from a catalog it
   * believes is complete. */
  skipped: SkippedCatalogManifest[];
}

export interface ArtifactDetail {
  entry: CatalogListEntry;
  /** Null when the artifact has no readable primary document -- pure code, an
   * empty payload, or a binary file. Distinct from "the artifact does not
   * exist", which throws. */
  doc: PrimaryDoc | null;
}

/**
 * Read-only by construction. There is no `pull`, `push` or `remove` here, and
 * that is a deliberate first cut rather than an unfinished one: every mutating
 * operation in this system either writes to a person's project or opens a PR
 * against a shared remote, and the multi-user work that just landed
 * (stale-push refusal, destructive-pull refusal) exists precisely because
 * those paths destroy work when two actors disagree. An agent is a second
 * actor. Adding mutation is a separate decision with its own consent model,
 * not a widening of this interface.
 */
export interface DeliveryOsReadPort {
  /** Reads the catalog from local caches. Does not touch the network. */
  listCatalog(input: { cwd: string; remote?: string }): CatalogSnapshot;

  /** Fetches every registered remote, then reads. Slow (seconds per remote)
   * and the only method here that can hang on a network. */
  refreshCatalog(input: { cwd: string; remote?: string }): Promise<CatalogSnapshot>;

  /** Throws when `id` names no artifact, or is ambiguous across remotes with
   * no `remote` given -- both are real errors an agent must see, not empty
   * results it will paper over. */
  readArtifact(input: {
    cwd: string;
    id: string;
    remote?: string;
    maxDocBytes?: number;
  }): ArtifactDetail;
}
