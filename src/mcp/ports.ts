import type { CatalogListEntry, SkippedCatalogManifest } from '../engine/catalog/catalog';
import type { PrimaryDoc } from '../engine/payload/primaryDoc';
import type { PushPlan } from '../engine/push/planPush';

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
  /** Every file in the payload, forward-slashed and sorted.
   *
   * `doc` answers "what should someone read FIRST" and is usually `README.md`,
   * the file that DESCRIBES the artifact. That is the wrong file for an agent
   * asked to fill a template in -- `friction-log`'s actual format lives in
   * `friction-log.md`, which without this list the agent cannot even name in a
   * follow-up call. */
  files: string[];
}

/**
 * One page of a payload file, or a typed reason there is no content.
 *
 * Three outcomes, deliberately not two. An empty string would collapse "this
 * file is empty", "there is no such file" and "this file is not text" into one
 * value a caller reads as success -- the coercion habit this codebase keeps
 * finding. `kind` makes them distinguishable at the type level.
 *
 * Paginated by CHARACTERS of the decoded string, never by bytes: slicing a
 * decoded string at byte offsets lets a UTF-8 multi-byte character straddle the
 * boundary, so two pages would not rejoin. Our own docs are full of em dashes,
 * so that bug would pass an ASCII fixture and ship for every real template.
 */
export type PayloadFileResult =
  | {
      kind: 'text';
      content: string;
      offset: number;
      limit: number;
      /** Characters in the WHOLE file, not in this page. */
      totalChars: number;
      hasMore: boolean;
    }
  | { kind: 'not-found'; message: string }
  | { kind: 'not-text'; message: string };

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
  /** One page of one file from an artifact's payload, read out of the remote
   * cache under `DELIVERYOS_HOME` and never from the user's project -- which is
   * why this method takes no `cwd`.
   *
   * THROWS when `path` escapes the payload directory. That containment is the
   * engine's own (`resolveWithinPayloadDir`) and is not re-implemented here. */
  readPayloadFile(input: {
    remote: string;
    id: string;
    path: string;
    offset?: number;
    limit?: number;
  }): PayloadFileResult;

  /**
   * The artifact's primary document as plain text, for SEARCH ONLY, or
   * `undefined` when it has none.
   *
   * Separate from `readArtifact` because search calls it per candidate and must
   * not pay for a full manifest resolution, and separate from `readPayloadFile`
   * because search does not know a path -- that is the whole point: 131 of 230
   * artifacts ship a single file whose name search has no way to guess.
   *
   * Exists because the catalog's real content was invisible to the tool whose
   * job is finding it. Measured: `stale` appears in 0 artifact descriptions and
   * 9 bodies; `drift` in 0 and 10.
   */
  readSearchableText(input: { remote: string; id: string }): string | undefined;

  readArtifact(input: {
    cwd: string;
    id: string;
    remote?: string;
    maxDocBytes?: number;
  }): ArtifactDetail;
}

/**
 * Registering where artifacts live. A SEPARATE port from the read one, and
 * deliberately so.
 *
 * Folding these two methods into `DeliveryOsReadPort` would have been less
 * code and would have quietly destroyed the property that makes that
 * interface worth having -- "read-only by construction", enforced by an
 * allowlist in `mcp.architecture.test.ts`. A port that is read-only except
 * for the parts that are not is just a port.
 *
 * So configuration is its own interface, its own binding, and its own opt-in:
 * `buildMcpServer` takes it optionally, and a server constructed without it
 * exposes no configuration tools at all. The read-only server that shipped
 * stays exactly what it was.
 *
 * WHY THIS EXISTS AT ALL is worth recording, because it is the one part of
 * the MCP surface that comes straight from the transcript rather than from
 * inference. Vaibhav, describing the MCP he wants (00:36:16):
 *
 *   "our MCP will ask the user. Hey, do you have a UI library? And we will say
 *    yes, we have a UI library. Okay, fine. you store skills? Okay, we have
 *    it. do you have any kind of artefact ... So after three, four questions,
 *    [initialisation] is done."
 *
 * That MCP is INTERROGATIVE. It is neither pull nor push -- it asks what you
 * already have and configures itself from the answers. Nothing else in this
 * codebase addresses it, and it serves the stated V1 goal directly: "as long
 * as we are able to aggregate the artifacts ... some kind of an aggregation of
 * artefact knowledge in one centralised way" (00:35).
 *
 * Note what is NOT here: no project directory. `remote.add` is declared
 * `needsProjectDir: false` in `src/capabilities.ts`, and that is why this
 * could be built now -- the project-root authority problem that gates every
 * install tool simply does not apply to an operation that never touches a
 * project.
 */
export interface DeliveryOsConfigPort {
  /** Every registered remote, with its URL -- which `catalog_overview` cannot
   * give, since that reports counts keyed by remote NAME. An agent running the
   * onboarding interview needs to know what is already registered before it
   * starts asking. */
  listRemotes(): Array<{ name: string; url: string; addedAt: string }>;

  /** Registers a git URL and clones it. Throws when the name is already in
   * use -- checked before anything is cloned, so a refusal leaves no stray
   * directory behind. `name` is derived from the URL when omitted. */
  addRemote(input: { url: string; name?: string }): Promise<{
    name: string;
    url: string;
    dest: string;
  }>;
}

/**
 * Previewing and contributing an edit back to the artifact's own remote.
 *
 * A THIRD port, separate again, and for a sharper reason than the config one.
 * `push` is the only operation in the manifest whose blast radius reaches other
 * people: it publishes bytes from the project to a shared git remote. The
 * read port is read-only by construction and the config port touches only
 * ~/.deliveryos; folding either shape into this one would erase a property that
 * a test currently enforces.
 *
 * WHY A PREVIEW IS PART OF THE PORT, not a convenience beside it.
 * `docs/agent-surface-plan.md:379-382` records why push was not an agent
 * surface: *"Push is all-or-nothing over the whole pulled folder with no diff
 * preview and no confirmation (verified). An agent pushing a filled-in risk
 * register would publish client data to a shared repo."* That is concrete --
 * Phase 15 ships a `risk-register` whose own README says "fill in your own
 * copy, never push it back", against `ARCHITECTURE.md`'s hard rule of "No
 * customer data in any DeliveryOS-shared remote, ever". So the preview is the
 * control, and the port shape enforces the order: you cannot reach `contribute`
 * without a token that only `preview` mints.
 */
export interface DeliveryOsContributePort {
  /** What a push WOULD do. Reaches no network, writes nothing. Returns the
   * plan plus the single-use token that authorises exactly this push. */
  preview(input: { cwd: string; id: string }): {
    plan: PushPlan;
    token: string;
  };

  /** Opens the pull request the token was minted for.
   *
   * Refuses if the token is missing, does not match the project's current
   * state, or has already been presented -- including after a FAILED push,
   * because `pushBranch` succeeding and `pulls.create` failing leaves a branch
   * on the shared remote that nothing deletes. */
  contribute(input: { cwd: string; id: string; token: string }): Promise<{
    url: string;
    number: number;
    branch: string;
    cacheResetWarning?: string;
  }>;
}
