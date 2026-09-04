/**
 * What DeliveryOS can do, declared once.
 *
 * DeliveryOS has three driving adapters over one engine -- the CLI
 * (`src/cli/**`), the Tauri sidecar (`src/sidecar.ts`) and the MCP server
 * (`src/mcp/**`) -- and until this file, nothing described the operations they
 * expose. Each adapter hand-wired its own argument handling, its own risk
 * judgement, and its own consent posture. That is why they drift, and the drift
 * is invisible until someone reads two files side by side:
 *
 *  - `check-updates --apply` updates EVERY artifact on the CLI
 *    (`cli/commands/checkUpdates.ts:30`) and exactly ONE in the sidecar
 *    (`sidecar.ts:465`) -- same engine function, opposite blast radius.
 *  - `artifact.applyBuildFix` takes `remote`/`id` as optional
 *    (`sidecar.ts:543`) while `readBuildFixLog` requires them to filter, so
 *    an unattributed audit entry is permanently unreadable. The engine says so
 *    at `fixBuildFailure.ts:343`; nothing stopped it.
 *  - Eight operations spend real money on a paid API call, and nothing said so
 *    anywhere -- which matters the moment an agent can call them.
 *
 * This file does NOT migrate any handler. It declares what already exists, so
 * that (a) drift becomes a failing test rather than an archaeology exercise,
 * (b) `readOnlyHint`/`destructiveHint`, CLI confirmations and the app's dialogs
 * stop being three hand-maintained encodings of one fact, and (c) a fourth
 * surface can be written against a list instead of by reading three adapters.
 *
 * `test/unit/capabilities.test.ts` asserts every real CLI command, every
 * sidecar RPC key and every MCP tool appears here exactly once, and that this
 * file names nothing that does not exist. Adding an operation to one surface
 * without declaring it fails the build.
 */

export interface Capability {
  /** Canonical name. Matches the sidecar's RPC key where one exists, since
   * that is the most complete surface (40 of 43); CLI-only operations follow
   * the same dotted style. */
  name: string;

  /** One line, in terms a person would use. Not a restatement of the name. */
  summary: string;

  /** How each surface spells it. Absent means the surface does not expose it. */
  cli?: string;
  sidecar?: string;
  /** A single operation may back more than one MCP tool: `catalog.list` backs
   * both `search_artifacts` and `catalog_overview`, which are different shapes
   * over the same read. */
  mcp?: string[];

  /** Writes anything, anywhere -- the project, the caches, or a git remote. */
  mutates: boolean;

  /** Can destroy work that this tool cannot then restore. The distinction from
   * `mutates` is the one an approval dialog actually needs: writing
   * `.env.local` is a mutation, deleting an edited install target is not
   * recoverable from inside DeliveryOS. */
  destructive: boolean;

  /** Runs a shell command that came from a manifest -- `post_install`,
   * `post_remove`, or a project's own build script. Unbounded by construction:
   * no allowlist exists and none is proposed here. */
  executesShell: boolean;

  /** Spends money on a paid model call. Declared because an agent driving these
   * has no way to know, and a person approving a tool call deserves to. */
  costsRealMoney: boolean;

  /** Reaches the network, so it can hang or fail for reasons outside the
   * machine. Maps to MCP's `openWorldHint`. */
  network: boolean;

  /** Reports intermediate progress through `ProgressCallback`. A surface that
   * ignores this on a long operation looks hung. */
  emitsProgress: boolean;

  /** Needs a project directory, which must be validated -- see
   * `assertUsableProjectDir` in `engine/paths.ts`. */
  needsProjectDir: boolean;

  /** Whether the remote name is required rather than optional. Declared here
   * because deciding it per handler is what produced the `applyBuildFix`
   * defect above. */
  remoteRequired: boolean;
}

/** Defaults for the common case: a local read of one project. Every entry below
 * states only what differs, so a surprising value is visible rather than buried
 * in a wall of identical booleans. */
const read = {
  mutates: false,
  destructive: false,
  executesShell: false,
  costsRealMoney: false,
  network: false,
  emitsProgress: false,
  needsProjectDir: true,
  remoteRequired: false,
} as const;

export const CAPABILITIES: Capability[] = [
  // ---------------------------------------------------------------- remotes
  {
    ...read,
    name: 'remote.add',
    summary: 'Register a git remote and clone it into the local cache',
    cli: 'remote add <git-url>',
    sidecar: 'remote.add',
    // The one WRITING operation an agent may reach, and the exception is
    // named in RISKY_CAPABILITIES_ALLOWED_ON_MCP with its reason rather than
    // inherited. It is the onboarding interview the transcript describes
    // (00:36:16, "our MCP will ask the user. Hey, do you have a UI library?")
    // and it never touches a project -- see `needsProjectDir: false` below.
    mcp: ['add_remote'],
    mutates: true,
    network: true,
    needsProjectDir: false,
  },
  {
    ...read,
    name: 'remote.remove',
    summary: 'Unregister a remote and delete its local cache',
    cli: 'remote remove <name>',
    sidecar: 'remote.remove',
    mutates: true,
    // Deletes the cache directory. Recoverable only by re-cloning, which needs
    // the network and the original URL.
    destructive: true,
    needsProjectDir: false,
  },
  {
    ...read,
    name: 'remote.list',
    summary: 'List registered remotes',
    cli: 'remote list',
    sidecar: 'remote.list',
    // Distinct from `catalog_overview`, which reports counts keyed by remote
    // NAME and never the URL. An agent running the interview has to know what
    // is already registered before it starts asking.
    mcp: ['list_remotes'],
    needsProjectDir: false,
  },

  // ---------------------------------------------------------------- catalog
  {
    ...read,
    name: 'catalog.list',
    summary: 'Read every artifact across registered remotes, with install status for this project',
    cli: 'list',
    sidecar: 'catalog.list',
    mcp: ['search_artifacts', 'catalog_overview'],
  },
  {
    ...read,
    name: 'catalog.refresh',
    summary: 'Fetch every remote from git, then read the catalog',
    // No CLI equivalent -- the cache-staleness gap README already documents.
    sidecar: 'catalog.refresh',
    mcp: ['refresh_catalog'],
    // Writes to the remote caches under ~/.deliveryos. Not destructive: a reset
    // to upstream is what the caches are for.
    mutates: true,
    network: true,
    emitsProgress: true,
  },
  {
    ...read,
    name: 'artifact.read',
    summary: "Read one artifact's full manifest and its primary document",
    // MCP-only, and genuinely new rather than a reshape: `resolvePrimaryDoc`
    // has exactly one production caller.
    mcp: ['get_artifact'],
  },

  // ------------------------------------------------------- artifact reading
  {
    ...read,
    name: 'artifact.readPayloadFile',
    summary: "Read one file out of an artifact's payload",
    sidecar: 'artifact.readPayloadFile',
    // On MCP because `get_artifact` answers "what should a person read first"
    // and returns the README -- the file that DESCRIBES an artifact. An agent
    // asked to fill in a template needs the template, which is a different file
    // in the same payload. Read-only, reads the catalog cache and never the
    // project, so it needs no `cwd` and adds no new risk class.
    mcp: ['read_artifact_file'],
  },
  {
    ...read,
    name: 'artifact.parseGuidelines',
    summary: "Parse a design kit's GUIDELINES.md into colour tokens and rules",
    sidecar: 'artifact.parseGuidelines',
  },
  {
    ...read,
    name: 'artifact.parseRoutes',
    summary: "Extract a template's route map",
    sidecar: 'artifact.parseRoutes',
  },
  {
    ...read,
    name: 'artifact.listPayloadComponents',
    summary: 'List the individually-pullable components inside a design kit',
    sidecar: 'artifact.listPayloadComponents',
  },
  {
    ...read,
    name: 'artifact.readInstallParamValues',
    summary: "Read this project's current values for an artifact's install_params",
    sidecar: 'artifact.readInstallParamValues',
    // RETURNS REAL SECRETS -- the actual values out of `.env.local`, including
    // any param declared `secret: true`. It exists for the app's config form,
    // which renders them into a password field on the user's own machine.
    // Deliberately absent from MCP, and `mcp.architecture.test.ts` names it
    // explicitly so it cannot be added by accident.
  },

  // ------------------------------------------------------------- installing
  {
    ...read,
    name: 'artifact.pull',
    summary: 'Copy an artifact into the project and run its post_install',
    cli: 'pull <id>',
    sidecar: 'artifact.pull',
    mutates: true,
    // `cpSync` is a wholesale overwrite of the install target, and `--force`
    // skips the local-edits guard entirely. The pristine snapshot -- the only
    // other copy -- is replaced in the same call.
    destructive: true,
    executesShell: true,
    // Only with `force`, which fetches before discarding local edits.
    network: true,
    emitsProgress: true,
  },
  {
    ...read,
    name: 'artifact.pullAndAutoWire',
    summary: 'Pull, then apply the artifact\'s mechanical wiring steps and verify the build',
    // The CLI reaches this through the same `pull` command, gated on
    // `wiring_actions.length > 0` -- a decision currently re-derived in four
    // places (see PLAN.md Phase 4).
    cli: 'pull <id>',
    sidecar: 'artifact.pullAndAutoWire',
    mutates: true,
    destructive: true,
    executesShell: true,
    network: true,
    emitsProgress: true,
  },
  {
    ...read,
    name: 'artifact.pullPayloadComponent',
    summary: 'Pull one component out of a design kit rather than the whole kit',
    sidecar: 'artifact.pullPayloadComponent',
    mutates: true,
  },
  {
    ...read,
    name: 'artifact.applyInstallParams',
    summary: "Write values for an artifact's install_params into .env.local",
    cli: 'config <id>',
    sidecar: 'artifact.applyInstallParams',
    mutates: true,
  },
  {
    ...read,
    name: 'artifact.remove',
    summary: 'Delete an installed artifact, running its post_remove teardown first',
    cli: 'remove <id>',
    sidecar: 'artifact.remove',
    mutates: true,
    // Recursively deletes the install target with NO local-edit guard, and no
    // confirmation on the CLI at all. The app confirms; the CLI does not.
    destructive: true,
    executesShell: true,
  },
  {
    ...read,
    name: 'artifact.applyUpdate',
    summary: 'Update installed artifacts to their latest upstream version',
    // Two disagreements worth seeing, both declared rather than discovered:
    //
    // 1. The CLI applies to ALL artifacts; the sidecar requires an id and
    //    applies to one. Same engine function, opposite blast radius.
    // 2. On the CLI this is not its own command -- it is `--apply` on
    //    `check-updates`, so ONE command is both a safe read and a
    //    destructive write depending on a flag. That is the exact shape MCP's
    //    own directory rules reject ("a single tool that accepts both safe and
    //    unsafe methods is rejected"), and it is why this operation cannot be
    //    exposed as a tool by simply forwarding the CLI's shape.
    cli: 'check-updates',
    sidecar: 'artifact.applyUpdate',
    mutates: true,
    destructive: true,
    executesShell: true,
    network: true,
    emitsProgress: true,
  },

  // ------------------------------------------------------------ contributing
  {
    ...read,
    name: 'artifact.push',
    summary: 'Open a pull request on the artifact\'s own remote from local edits',
    cli: 'push <id>',
    sidecar: 'artifact.push',
    mcp: ['preview_contribution', 'contribute_artifact'],
    // CORRECTED. This previously read "Writes to a SHARED remote, not the
    // project ... which is why it is the safest mutating operation to expose
    // to an agent". Two thirds of that was false, and it was the stated
    // justification for exposing it:
    //
    //  - It DOES write to the project. `push.ts:772-774` puts `pendingPr` in
    //    the lockfile on success, and `push.ts:624` reads it back as
    //    `hasOwnPushInFlight` to DISABLE the stale-push guard for the next
    //    push. Opening a PR silently removes a safety check for whoever
    //    pushes next.
    //  - It is not the safest. It is the only operation whose blast radius
    //    reaches other people, and it publishes the WHOLE pulled folder --
    //    which is how `ARCHITECTURE.md:363` ("No customer data in any
    //    DeliveryOS-shared remote, ever") becomes reachable from here, via a
    //    `risk-register` artifact whose own README says "never push it back".
    //
    // Exposed anyway, but only behind a preview that shows the exact file list
    // first and a single-use token binding the push to it. See
    // RISKY_CAPABILITIES_ALLOWED_ON_MCP in src/mcp/server.ts.
    mutates: true,
    network: true,
    emitsProgress: true,
  },

  // ------------------------------------------------------------------- sync
  {
    ...read,
    name: 'sync.checkForUpdates',
    summary: 'Report which installed artifacts have a newer version upstream',
    cli: 'check-updates',
    sidecar: 'sync.checkForUpdates',
    network: true,
    emitsProgress: true,
  },
  {
    ...read,
    name: 'sync.resolvePendingPushes',
    summary: 'Ask GitHub what happened to pull requests this project opened',
    cli: 'check-pending-pushes',
    sidecar: 'sync.resolvePendingPushes',
    network: true,
    emitsProgress: true,
  },

  // --------------------------------------------------------- drift and scan
  {
    ...read,
    name: 'artifact.checkSourceDrift',
    summary: "Compare an artifact's payload against the real source it was extracted from",
    cli: 'check-drift <id>',
    sidecar: 'artifact.checkSourceDrift',
    remoteRequired: true,
  },
  {
    ...read,
    name: 'scan.run',
    summary: 'Find reusable content already in this project and propose it as artifacts',
    cli: 'scan',
    sidecar: 'scan.run',
    network: true,
    emitsProgress: true,
    remoteRequired: true,
  },
  {
    ...read,
    name: 'artifact.detectMetadata',
    summary: "Infer kind, tags and description from a payload's own contents",
    sidecar: 'artifact.detectMetadata',
    // Local heuristics, not a model call -- unlike its `suggest*` siblings.
    needsProjectDir: false,
  },
  {
    ...read,
    name: 'git.identity',
    summary: "Read the machine's git user.name and user.email",
    sidecar: 'git.identity',
  },

  // ---------------------------------------------------------------- wiring
  {
    ...read,
    name: 'artifact.resolveWiringActions',
    summary: "Resolve an artifact's wiring steps against this project, without applying them",
    cli: 'wiring <id>',
    sidecar: 'artifact.resolveWiringActions',
  },
  {
    ...read,
    name: 'artifact.verifyBuild',
    summary: "Run the project's own build script and report whether it still passes",
    sidecar: 'artifact.verifyBuild',
    // Runs the project's build, which is a shell command DeliveryOS did not
    // write. Up to five minutes.
    executesShell: true,
  },

  // ------------------------------------------------- paid model calls (8)
  {
    ...read,
    name: 'artifact.suggestMetadata',
    summary: 'Ask a model to draft an artifact\'s description and tags',
    sidecar: 'artifact.suggestMetadata',
    costsRealMoney: true,
    network: true,
  },
  {
    ...read,
    name: 'artifact.suggestAntiPatterns',
    summary: 'Ask a model to review a payload for anti-patterns before it is proposed',
    sidecar: 'artifact.suggestAntiPatterns',
    costsRealMoney: true,
    network: true,
  },
  {
    ...read,
    name: 'artifact.requestBuildFix',
    summary: 'Ask a model for a patch that would fix a failing build',
    sidecar: 'artifact.requestBuildFix',
    costsRealMoney: true,
    network: true,
  },
  {
    ...read,
    name: 'artifact.requestWiringMerge',
    summary: 'Ask a model how to merge an artifact\'s wiring into an existing file',
    sidecar: 'artifact.requestWiringMerge',
    costsRealMoney: true,
    network: true,
  },
  {
    ...read,
    name: 'artifact.requestWiringPlacement',
    summary: 'Ask a model where in the project a wiring step should go',
    sidecar: 'artifact.requestWiringPlacement',
    costsRealMoney: true,
    network: true,
  },
  {
    ...read,
    name: 'artifact.requestAntiPatternFix',
    summary: 'Ask a model for a patch that would fix a flagged anti-pattern',
    sidecar: 'artifact.requestAntiPatternFix',
    costsRealMoney: true,
    network: true,
  },
  {
    ...read,
    name: 'artifact.wireWithClaude',
    summary: 'Hand the last mile of wiring to a real interactive Claude Code session',
    cli: 'wire-with-claude <id>',
    // The only `stdio: 'inherit'` call in the codebase -- it hands over the
    // terminal, which is why it is structurally impossible over any agent
    // surface and appears on no other adapter.
    costsRealMoney: true,
    executesShell: true,
    network: true,
  },
  {
    ...read,
    name: 'artifact.scaffoldBackendPlugin',
    summary: "Draft install_params and wiring_actions from a real consumer file, for review",
    cli: 'scaffold-backend-plugin',
    // Paid, and CLI-only -- an audit of the sidecar alone reports six paid
    // operations and misses this one and `wireWithClaude`.
    costsRealMoney: true,
    network: true,
  },

  // ------------------------------------------------- applying model output
  {
    ...read,
    name: 'artifact.applyBuildFix',
    summary: 'Write a model-proposed build fix into the project',
    sidecar: 'artifact.applyBuildFix',
    mutates: true,
    // `remote`/`id` are optional on this handler but required by
    // `readBuildFixLog` to filter, so an unattributed entry can never be read
    // back. Declared required here; the handler is corrected in Phase 4.
    remoteRequired: true,
  },
  {
    ...read,
    name: 'artifact.applyWiringMerge',
    summary: 'Write a model-proposed wiring merge into an existing project file',
    sidecar: 'artifact.applyWiringMerge',
    mutates: true,
    remoteRequired: true,
  },
  {
    ...read,
    name: 'artifact.applyWiringPlacement',
    summary: 'Write a wiring step into the location a model proposed',
    sidecar: 'artifact.applyWiringPlacement',
    mutates: true,
    remoteRequired: true,
  },
  {
    ...read,
    name: 'artifact.applyAntiPatternFix',
    summary: 'Write a model-proposed anti-pattern fix into a staged payload',
    sidecar: 'artifact.applyAntiPatternFix',
    mutates: true,
  },

  // ------------------------------------------------------------ audit logs
  {
    ...read,
    name: 'artifact.readBuildFixLog',
    summary: 'Read the record of build fixes applied to this project',
    sidecar: 'artifact.readBuildFixLog',
    remoteRequired: true,
  },
  {
    ...read,
    name: 'artifact.readWiringMergeLog',
    summary: 'Read the record of wiring merges applied to this project',
    sidecar: 'artifact.readWiringMergeLog',
  },

  // --------------------------------------------------------------- preview
  {
    ...read,
    name: 'preview.compile',
    summary: "Compile a cataloged component's live preview",
    sidecar: 'preview.compile',
    // Writes to the preview cache and shells out to esbuild.
    mutates: true,
    executesShell: true,
    needsProjectDir: false,
  },
  {
    ...read,
    name: 'preview.compileLocal',
    summary: 'Compile a live preview for a component in the local project',
    sidecar: 'preview.compileLocal',
    mutates: true,
    executesShell: true,
  },
  {
    ...read,
    name: 'preview.compilePayloadComponent',
    summary: 'Compile a live preview for one component inside a design kit',
    sidecar: 'preview.compilePayloadComponent',
    mutates: true,
    executesShell: true,
    needsProjectDir: false,
  },
];

/** Lookup by canonical name. */
export function findCapability(name: string): Capability | undefined {
  return CAPABILITIES.find((c) => c.name === name);
}

/** Everything that writes, in any sense. The set an approval model cares about. */
export function mutatingCapabilities(): Capability[] {
  return CAPABILITIES.filter((c) => c.mutates);
}

/** Everything that spends money. Eight, at the time of writing, and two of them
 * are reachable only from the CLI -- which is why this belongs in one file
 * rather than being re-derived per surface. */
export function paidCapabilities(): Capability[] {
  return CAPABILITIES.filter((c) => c.costsRealMoney);
}
