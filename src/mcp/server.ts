import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { CatalogListEntry } from '../engine/catalog/catalog';
import type { DeliveryOsConfigPort, DeliveryOsContributePort, DeliveryOsReadPort } from './ports';
import { CAPABILITIES } from '../capabilities';

/**
 * The MCP driving adapter: it translates tool calls into port calls and
 * results into text. It imports the PORT, never `src/engine/**` behaviour --
 * that is the whole architectural claim here, and it is checked by
 * `test/unit/mcp.architecture.test.ts` rather than left to discipline.
 *
 * Nothing in this file may write to stdout. `src/sidecar.ts:5-8` states that
 * rule for the sidecar and nothing enforced it; a stray `console.log` here
 * corrupts the JSON-RPC stream on the wire and the client sees a parse error
 * with no hint where it came from. This is now an ESLint rule
 * (`no-console` scoped to `src/mcp/**` in eslint.config.js), which matters
 * because every neighbouring file in `src/cli/commands/` opens with a
 * `console.log` and copying one in is the obvious mistake.
 */

/** Kept low on purpose. The live catalog is 230 artifacts; returning them all
 * as full manifests would spend an agent's entire context on a directory
 * listing. Search returns compact rows and a total, so the agent can narrow. */
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;

/** A search row: enough to decide whether to fetch the whole thing, and no
 * more. Notably includes `localStatus`, because "do I already have this?" is
 * most of why an agent asks. */
interface SearchRow {
  id: string;
  kind: string;
  remote: string;
  version: string;
  description: string;
  localStatus: string;
  installTarget: string;
  tags: string[];
}

function flattenTags(entry: CatalogListEntry): string[] {
  const { tags } = entry.manifest;
  return [...tags.roles, ...tags.teams, ...tags.stacks, ...tags.componentTypes];
}

function toRow(entry: CatalogListEntry): SearchRow {
  return {
    id: entry.manifest.id,
    kind: entry.manifest.kind,
    remote: entry.remoteName,
    version: entry.manifest.version,
    description: entry.manifest.description,
    localStatus: entry.localStatus,
    installTarget: entry.installTarget,
    tags: flattenTags(entry),
  };
}

/** Words too common to narrow anything, and present in most natural questions.
 * Dropped so "a skill for reviewing code" scores on `reviewing`/`code` rather
 * than on whatever happens to contain "for". */
const IGNORED_QUERY_WORDS = new Set([
  'a', 'an', 'the', 'for', 'to', 'of', 'in', 'on', 'with', 'and', 'or',
  'my', 'me', 'is', 'are', 'that', 'this', 'it', 'something', 'anything',
  'how', 'do', 'does', 'help', 'need', 'want', 'use', 'using', 'about',
]);

/** Splits text into comparable words. Ids are hyphenated, descriptions are
 * prose, tags are free text -- all three become the same shape here. */
function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * How well one query term matches one indexed word. 2 = the same word,
 * 1 = a shared stem, 0 = unrelated.
 *
 * Word-level, NOT substring, because substring matching was wrong in BOTH
 * directions and each direction produced a different bad answer:
 *
 *  - **False positives.** "setting up authentication" ranked `docs-lookup` and
 *    `doc-updater` top, because "up" is inside "lookup" and "updater". A
 *    question about auth answered with three documentation artifacts.
 *  - **False negatives.** "reviewing" never matched `code-reviewer`, since
 *    `'code-reviewer'.includes('reviewing')` is false. Substring matching only
 *    works when the query term is SHORTER than the indexed word, which is not
 *    a property natural questions have.
 *
 * The prefix rule covers the morphology this catalog actually contains --
 * review/reviewer/reviewing, test/testing, auth/authentication -- without a
 * stemmer. Four characters is the floor because below it prefixes stop
 * discriminating: "api" and "app" would collide at three.
 */
function termMatch(term: string, word: string): number {
  if (word === term) return 2;
  const [shorter, longer] = term.length < word.length ? [term, word] : [word, term];
  return shorter.length >= 4 && longer.startsWith(shorter) ? 1 : 0;
}

/** Best match for a term anywhere in one field. */
function bestMatch(term: string, indexed: string[]): number {
  let best = 0;
  for (const word of indexed) {
    best = Math.max(best, termMatch(term, word));
    if (best === 2) break;
  }
  return best;
}

/**
 * Scores an artifact against a query, PER TERM and PER WORD.
 *
 * This used to match the whole query as one substring, and the bug that
 * exposed was severe in exactly the case the tool exists for: **"reviewing a
 * pull request" returned zero matches** against a catalog containing
 * `code-reviewer`, `pr-review-reality-checker` and `java-api-review`. A single
 * word worked ("review" -> 34 matches); a natural question did not, because no
 * id or description contains that exact phrase.
 *
 * Every test here used a single-word query, because that is what the
 * implementation was built for -- so the tests agreed with the code and both
 * were wrong. It surfaced the first time the tool was asked a question the way
 * an agent would actually ask one, which no test was going to do.
 *
 * The failure mode is the worst available: an empty result reads as an answer.
 * An agent concludes nothing is available -- precisely what the server
 * instructions warn against for unconfigured remotes.
 *
 * Still additive and deterministic: an agent that cannot predict the ranking
 * will just request everything.
 */
function score(entry: CatalogListEntry, query: string): number {
  const whole = query.trim().toLowerCase();
  const id = entry.manifest.id.toLowerCase();

  // An exact id match wins outright, whatever the tokeniser makes of it.
  if (id === whole) return 1000;

  const terms = words(whole).filter((t) => t.length >= 3 && !IGNORED_QUERY_WORDS.has(t));
  // A query of nothing but stop-words ("how do I") is not a search. Returning
  // 0 filters it out rather than ranking the catalog arbitrarily.
  if (terms.length === 0) return 0;

  const idWords = words(id);
  const descWords = words(entry.manifest.description);
  const tagWords = flattenTags(entry).flatMap(words);
  const kind = entry.manifest.kind.toLowerCase();

  let total = 0;
  let matchedTerms = 0;

  for (const term of terms) {
    // An exact word in the id is the strongest signal a catalog like this
    // offers -- ids are short and hand-written, so a word in one was chosen.
    const termScore = bestMatch(term, idWords) * 40
      + bestMatch(term, descWords) * 12
      + bestMatch(term, tagWords) * 10
      + termMatch(term, kind) * 8;

    if (termScore > 0) matchedTerms += 1;
    total += termScore;
  }

  if (matchedTerms === 0) return 0;

  // Breadth over depth: something matching `pull` AND `request` is a better
  // answer than something mentioning `pull` three times.
  return total + matchedTerms * 30;
}

/**
 * The tool's annotations, DERIVED from `src/capabilities.ts` rather than typed
 * out here.
 *
 * These are not cosmetic: Anthropic's directory requirements state that
 * "read-only tools can run without per-call confirmation; destructive tools
 * always prompt", so these values decide whether a person is asked before a
 * tool runs. Getting them from the declaration means the answer cannot differ
 * between what the manifest says an operation does and what this file claims.
 *
 * Throws for an undeclared tool. That is deliberate -- a tool registered here
 * without a capability entry would otherwise silently get whatever defaults
 * the SDK picks, which for a write is the wrong way to fail.
 */
/**
 * Capabilities allowed to reach an agent despite carrying real risk, each
 * named individually with the reason.
 *
 * This is an ALLOWLIST, and it is the gate rather than the annotation. Deriving
 * `destructiveHint` from the manifest tells a client to prompt; it does not
 * stop a destructive operation being exposed in the first place. Those are
 * different guarantees, and the second is the one that matters when the
 * question is "can an agent reach this at all".
 *
 * The lesson this shape comes from is `agent-native`'s own recorded bug, cited
 * in `docs/agent-surface-plan.md`: `authorize` is honoured on all six of its
 * surfaces because it is baked INSIDE `run`, while `needsApproval` is
 * "honoured only inside the agent loop" because it took the flag route. A
 * declared risk flag that no code refuses to act on is exactly that flag route.
 *
 * Keyed by capability name, not tool name, so renaming a tool cannot silently
 * inherit an exemption meant for a different operation.
 */
const RISKY_CAPABILITIES_ALLOWED_ON_MCP: Record<string, string> = {
  // Writes only the remote caches under ~/.deliveryos, never the user's
  // project. `destructive: false` because resetting a cache to upstream is
  // what a cache is for. Annotated openWorldHint/readOnlyHint:false so a
  // client still prompts if it chooses to.
  'catalog.refresh': 'Writes only ~/.deliveryos caches; touches no project file.',

  // The onboarding interview the transcript describes (00:36:16). Allowed
  // because of what it does NOT do: it registers a git URL and clones it into
  // ~/.deliveryos, and touches no project file at all -- `needsProjectDir:
  // false` in the manifest, which is why the project-root authority problem
  // that gates every install tool does not apply here. It cannot overwrite
  // anything either: a duplicate name is refused before the clone starts.
  //
  // The remaining exposure is real and worth naming: an agent can cause a
  // clone of an attacker-supplied URL onto the user's disk. That is a network
  // fetch into a cache directory, not code execution -- nothing runs a
  // cloned repo -- and the tool is annotated so a client prompts.
  'remote.add': 'Clones into ~/.deliveryos only; never writes a project file; refuses duplicates before cloning.',

  // The one operation here whose mistakes land on OTHER PEOPLE'S work, and the
  // only entry in this list that needed a real argument rather than a short
  // one. `docs/agent-surface-plan.md:379-382` recorded why it was not an agent
  // surface: "Push is all-or-nothing over the whole pulled folder with no diff
  // preview and no confirmation (verified). An agent pushing a filled-in risk
  // register would publish client data to a shared repo." That is concrete --
  // Phase 15 ships a `risk-register` whose own README says "fill in your own
  // copy, never push it back", against ARCHITECTURE.md:363's hard rule.
  //
  // What changed is that the precondition is now met rather than waived:
  //
  //  - `preview_contribution` shows the exact file list, statuses and version
  //    bump BEFORE anything is published, and `planPush.equivalence.e2e.test.ts`
  //    pins that the preview promises exactly what the push commits.
  //  - `contribute_artifact` requires a single-use token minted by that
  //    preview, consumed BEFORE the attempt, and invalidated across a restart
  //    by a per-instance nonce -- the "argument-bound single-use grant" that
  //    doc itself recommends over an unbounded per-tool "always allow".
  //  - `force` is unreachable: there is no parameter for it, so a stale push
  //    refuses rather than reverting a colleague's merged change.
  //  - An open `pendingPr` refuses, because it would silently disable the
  //    stale-push guard for the next push.
  //  - The PR body says an agent assembled the diff, so the reviewer -- the
  //    last safeguard -- knows to read it on that basis.
  'artifact.push': 'Only reachable via a preview-bound single-use token; force and pendingPr both refused; PR body discloses agent authorship.',
};

/**
 * The tool's annotations, DERIVED from `src/capabilities.ts` rather than typed
 * out here -- and the point at which an operation too risky to expose is
 * refused outright.
 *
 * The annotations are not cosmetic: Anthropic's directory requirements state
 * that "read-only tools can run without per-call confirmation; destructive
 * tools always prompt", so these values decide whether a person is asked
 * before a tool runs. Getting them from the declaration means the answer
 * cannot differ between what the manifest says an operation does and what this
 * file claims.
 *
 * Refuses, loudly, in three cases -- all of them at server-construction time,
 * so a bad registration cannot reach a client at all:
 *
 *  1. **Undeclared.** A tool with no capability entry would otherwise take
 *     whatever defaults the SDK picks, which for a write is the wrong way to
 *     fail.
 *  2. **Declared destructive, not allowlisted.** Eight operations in this
 *     system spend real money and five can destroy unrecoverable work; none
 *     should become agent-reachable because somebody added an `mcp:` line.
 *  3. **Declared paid, not allowlisted.** Same, for the money.
 */
function annotationsFor(toolName: string) {
  // `filter`, not `find`. With `find`, a SECOND capability claiming an
  // already-claimed tool name is silently ignored because the first match
  // wins -- so a destructive operation could be attached to an existing
  // read-only tool's name and inherit its clean annotations. Found by the
  // gate's own test, which is why the test claims a taken name on purpose.
  const claimants = CAPABILITIES.filter((c) => c.mcp?.includes(toolName));

  if (claimants.length === 0) {
    throw new Error(
      `MCP tool "${toolName}" has no entry in src/capabilities.ts. Declare it there `
        + '(and in the surfaces list) so its risk classification has one source.',
    );
  }
  if (claimants.length > 1) {
    throw new Error(
      `MCP tool "${toolName}" is claimed by more than one capability `
        + `(${claimants.map((c) => c.name).join(', ')}). One tool must map to exactly one `
        + 'operation, or its risk classification is ambiguous.',
    );
  }

  const capability = claimants[0];

  const exempt = Object.prototype.hasOwnProperty.call(
    RISKY_CAPABILITIES_ALLOWED_ON_MCP,
    capability.name,
  );

  // Gated on `mutates`, not only on `destructive`/`costsRealMoney`.
  //
  // The narrower version was decorative: `catalog.refresh` is the only
  // mutating tool exposed today and it is neither destructive nor paid, so
  // removing it from the allowlist changed nothing and the allowlist proved
  // nothing. Anything that WRITES should be an explicit, named decision --
  // that is the whole question ("can an agent reach this at all"), and it is
  // the decision Phase 2's `remote.add` will need to make on purpose rather
  // than inherit.
  if (!exempt && (capability.mutates || capability.destructive || capability.costsRealMoney)) {
    const why = [
      capability.destructive && 'can destroy work its caller cannot recover',
      capability.costsRealMoney && 'spends real money',
      capability.mutates && 'writes',
    ].filter(Boolean).join(', ');

    throw new Error(
      `Capability "${capability.name}" ${why}, so it cannot be exposed as MCP tool "${toolName}" `
        + 'without an explicit decision. Whether an agent may reach a writing operation is a '
        + 'consent question, not a registration detail -- add it to '
        + 'RISKY_CAPABILITIES_ALLOWED_ON_MCP with the reason it is safe.',
    );
  }

  return {
    readOnlyHint: !capability.mutates,
    destructiveHint: capability.destructive,
    idempotentHint: !capability.mutates || !capability.destructive,
    openWorldHint: capability.network,
  };
}

function json(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function failure(error: unknown): {
  content: [{ type: 'text'; text: string }];
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * The server's own description of itself, COMPOSED from which ports were
 * actually supplied rather than written out once.
 *
 * This was a single unconditional literal, and it said: "These tools are
 * READ-ONLY ... They cannot pull, push, or modify anything." That was true when
 * written and false by the time `add_remote` and `contribute_artifact` shipped
 * -- and unlike a stale comment, this string is RUNTIME OUTPUT. It is the first
 * thing a connecting client reads, and the one statement an agent uses to
 * decide what it may do. An agent holding a push tool while being told the
 * surface cannot push has been handed a false model of its own capabilities,
 * which is the exact opposite of what the contribution flow was built to
 * guarantee: the preview exists so the file list is seen before publication,
 * `initiatedBy` exists so a reviewer knows an agent assembled the diff, and the
 * tool descriptions name every refusal. A server-level claim that none of it
 * can happen undercuts all three.
 *
 * Composing it means the claim cannot drift again: a port that is not supplied
 * contributes no prose, and a port that is cannot be silently omitted from it.
 * `mcp.instructions.test.ts` asserts the two agree in both directions.
 */
function buildInstructions({ hasConfig, hasContribute }: {
  hasConfig: boolean;
  hasContribute: boolean;
}): string {
  const parts: string[] = [
    'DeliveryOS distributes versioned artifacts (skills, agents, rules, commands, UI components, '
      + 'templates, backend plugins) from git remotes into a project.',
  ];

  if (!hasConfig && !hasContribute) {
    parts.push(
      'These tools are READ-ONLY: they let you find an artifact and read what it contains, so you '
        + 'can tell the user what is available and what it would do. They cannot install, '
        + 'contribute, or modify anything.',
    );
  } else {
    parts.push(
      'Most of these tools are read-only -- they find artifacts and read what they contain. A few '
        + 'write, and those are named below. None of them installs an artifact into a project.',
    );
  }

  parts.push(
    'To INSTALL an artifact, DeliveryOS is a CLI: run its `pullCommand` (returned by get_artifact) '
      + 'in a terminal, the same way a person would. There is no install tool here. Read the '
      + 'artifact first and tell the user what it will do -- especially its postInstall, which is a '
      + 'shell command that runs on their machine.',
    'Tools that act on a project need `cwd`, the absolute path of the project being worked in, '
      + 'because whether an artifact is installed is a property of that project, not of the machine.',
  );

  if (hasConfig) {
    parts.push(
      'SETTING UP (writes: add_remote). If catalog_overview or search_artifacts comes back empty, do '
        + 'not conclude there is nothing available -- check list_remotes first. An empty remote list '
        + 'means no sources are configured yet, which is a different problem with a different '
        + 'answer. When that is the case, interview the user rather than guessing: ask where their '
        + 'shared work already lives -- do they have a UI component library? a set of Claude skills '
        + 'or agents? project templates? backend plugins? -- and register each repository they name '
        + 'with add_remote. A few questions is usually enough. Never invent a URL.',
    );
  }

  if (hasContribute) {
    parts.push(
      'CONTRIBUTING BACK. If the user has edited an artifact and wants to share the change, ALWAYS '
        + 'call preview_contribution first and show them the exact file list it returns. Push is '
        + 'all-or-nothing over the whole installed folder, so an artifact someone filled in with '
        + 'real client details would publish those to a shared repository -- the preview is how '
        + 'that gets caught, and it is why this is two tools rather than one. Only once they have '
        + 'seen that list, call contribute_artifact with the token the preview returned. That is '
        + 'the tool that writes, and it reaches other people: it opens a pull request on a shared '
        + 'remote. The token authorises exactly the previewed diff, once. It cannot force over a '
        + 'colleague\'s merged change, and it refuses while an earlier pull request from this '
        + 'project is still open.',
    );
  }

  return parts.join(' ');
}

export interface McpServerDeps {
  /** Required, not defaulted. Defaulting it to `createEngineReadPort()` here
   * would make this file import engine BEHAVIOUR for the sake of convenience,
   * and the convenience is worth nothing: the CLI command is the composition
   * root and is the only caller that has to know. What it buys is that
   * `src/mcp/server.ts` has no runtime dependency on the core at all. */
  port: DeliveryOsReadPort;
  /** Optional, and its absence is the default. A server built without it
   * exposes no configuration tools at all, so the read-only surface that
   * shipped stays exactly what it was. Opt-in rather than opt-out, because
   * the question "may an agent change how this machine is configured" should
   * be answered by a caller, not inherited. */
  configPort?: DeliveryOsConfigPort;
  /** Optional, absent by default, and separate from `configPort` on purpose:
   * registering where artifacts come from and publishing project bytes to a
   * shared remote are different consent questions, and an embedder should be
   * able to answer them differently. */
  contributePort?: DeliveryOsContributePort;
  /** Passed in rather than declared here. `src/cli/program.ts` owns the one
   * version literal in this codebase and `test/unit/cliVersion.test.ts` fails
   * the build when it drifts from package.json -- a second literal here would
   * be exactly the drift that test exists to prevent. */
  version: string;
}

export function buildMcpServer({ port: engine, configPort, contributePort, version }: McpServerDeps): McpServer {

  const server = new McpServer(
    { name: 'deliveryos', version },
    {
      capabilities: { tools: {} },
      instructions: buildInstructions({
        hasConfig: configPort !== undefined,
        hasContribute: contributePort !== undefined,
      }),
    },
  );

  const cwdSchema = z
    .string()
    .min(1)
    .describe('Absolute path to the project directory whose install state should be reported');
  const remoteSchema = z
    .string()
    .min(1)
    .optional()
    .describe('Restrict to one registered remote by name. Omit to search every remote.');

  server.registerTool(
    'search_artifacts',
    {
      title: 'Search the DeliveryOS catalog',
      description:
        'Finds artifacts by free-text query, kind, remote or install status. Returns compact '
        + 'rows plus the total number of matches, so a broad query can be narrowed rather than '
        + 'dumped. Use get_artifact to read one in full. Reads local caches only -- call '
        + 'refresh_catalog first if the remotes may have moved.',
      inputSchema: {
        cwd: cwdSchema,
        query: z
          .string()
          .optional()
          .describe('Free text matched against id, description and tags. Omit to list everything.'),
        kind: z
          .string()
          .optional()
          .describe('Exact kind filter, e.g. "skill", "agent", "ui-component", "backend-plugin"'),
        remote: remoteSchema,
        status: z
          .enum(['not_pulled', 'pulled', 'edited_locally'])
          .optional()
          .describe('Filter by whether the artifact is installed in cwd, and whether it was edited'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SEARCH_LIMIT)
          .optional()
          .describe(`Maximum rows to return (default ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT})`),
      },
      annotations: annotationsFor('search_artifacts'),
    },
    async ({ cwd, query, kind, remote, status, limit }) => {
      try {
        const { entries, skipped } = engine.listCatalog({ cwd, remote });

        let matched = entries;
        if (kind) matched = matched.filter((e) => e.manifest.kind === kind);
        if (status) matched = matched.filter((e) => e.localStatus === status);

        let ranked: CatalogListEntry[];
        if (query) {
          ranked = matched
            .map((entry) => ({ entry, s: score(entry, query) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s || a.entry.manifest.id.localeCompare(b.entry.manifest.id))
            .map((x) => x.entry);
        } else {
          ranked = [...matched].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
        }

        const capped = Math.min(limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
        return json({
          total: ranked.length,
          returned: Math.min(ranked.length, capped),
          truncated: ranked.length > capped,
          results: ranked.slice(0, capped).map(toRow),
          // Surfaced on every search, not only on the overview: an agent that
          // searched for something a broken manifest would have matched needs
          // to know its answer is from an incomplete catalog.
          skippedManifests: skipped.length,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'get_artifact',
    {
      title: 'Read one artifact in full',
      description:
        'Returns an artifact\'s complete manifest plus its primary document (SKILL.md, README.md, '
        + 'or the single file it points at), so you can judge what it actually does before '
        + 'recommending it. Also reports side effects that are otherwise invisible until install '
        + 'time: post_install shell commands, install_params, and wiring_actions.',
      inputSchema: {
        cwd: cwdSchema,
        id: z.string().min(1).describe('The artifact id, exactly as search_artifacts reported it'),
        remote: z
          .string()
          .min(1)
          .optional()
          .describe('Required only when the same id exists in more than one remote'),
        includeDoc: z
          .boolean()
          .optional()
          .describe('Include the primary document body (default true). Set false for the manifest alone.'),
      },
      annotations: annotationsFor('get_artifact'),
    },
    async ({ cwd, id, remote, includeDoc }) => {
      try {
        const { entry, doc, files } = engine.readArtifact({ cwd, id, remote });
        const m = entry.manifest;
        return json({
          id: m.id,
          kind: m.kind,
          remote: entry.remoteName,
          version: m.version,
          description: m.description,
          owner: m.owner,
          sourceRepo: m.source_repo,
          tags: m.tags,
          localStatus: entry.localStatus,
          installTarget: entry.installTarget,
          reviewRequired: m.review_required,
          pendingPr: entry.pendingPr ?? null,
          // Named plainly rather than as a boolean. `post_install` is an
          // arbitrary shell command that runs on the user's machine after the
          // payload is copied; the desktop app coerced it to `!!` in both
          // places it touched it, so nobody could see WHAT would run. An agent
          // recommending an artifact should be able to quote the command.
          postInstall: m.post_install ?? null,
          postRemove: m.post_remove ?? null,
          installParams: m.install_params,
          wiringActions: m.wiring_actions,
          // Both usually null: only 3 of 230 artifacts in the live catalog are
          // signed, because sign-artifacts.mjs skips every kind except
          // backend-plugin. Reported as-is rather than dressed up -- an agent
          // should be able to say "this is not signed" accurately.
          contentDigest: m.content_digest ?? null,
          signature: m.signature ?? null,
          doc:
            includeDoc === false || doc === null
              ? null
              : { path: doc.relPath, truncated: doc.truncated, content: doc.content },
          hasDoc: doc !== null,
          // Every file in the payload, so a follow-up `read_artifact_file` can
          // name one. `doc` above answers "what should a person read FIRST" and
          // is usually the README -- the file that DESCRIBES the artifact. An
          // agent asked to fill a template in needs the template, and for
          // `friction-log` that is `friction-log.md`, sitting beside the README
          // and unnameable without this list.
          files,
          // The exact command, ready to run, rather than leaving the agent to
          // assemble it. These tools are read-only on purpose, so installing is
          // always a handoff -- and a handoff that hands over a half-specified
          // command is where an agent guesses at `--remote` and pulls the wrong
          // artifact from the wrong place. `--remote` is always included even
          // when the id is currently unambiguous, because ambiguity is a
          // property of the catalog at the moment it runs, not of this answer.
          pullCommand: `deliveryos pull ${m.id} --remote ${entry.remoteName}`,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'read_artifact_file',
    {
      title: 'Read one file from an artifact',
      description:
        'Returns the contents of a single file from an artifact\'s payload, by the relative path '
        + '`get_artifact` listed in `files`. Use this to read a TEMPLATE an artifact ships -- '
        + 'get_artifact returns the README, which describes the artifact rather than being the '
        + 'thing you fill in. Reads the catalog cache only; it never touches the project, and '
        + 'writing the finished document is yours to do.',
      inputSchema: {
        id: z.string().min(1).describe('The artifact id, exactly as search_artifacts reported it'),
        remote: z.string().min(1).describe('The remote the artifact came from, as get_artifact reported it'),
        path: z
          .string()
          .min(1)
          .describe('Relative path inside the payload, exactly as get_artifact listed it in `files`'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Character offset to start from (default 0). Use with `totalChars` to page a long file.'),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Maximum characters to return (default 40000).'),
      },
      annotations: annotationsFor('read_artifact_file'),
    },
    async ({ id, remote, path, offset, limit }) => {
      try {
        const result = engine.readPayloadFile({ remote, id, path, offset, limit });
        // Three outcomes reported as three shapes, never as an empty string:
        // a caller receiving '' could not tell an empty template from a missing
        // one from a PNG, and would call all three a success.
        if (result.kind !== 'text') {
          return failure(new Error(result.message));
        }
        return json({
          id,
          remote,
          path,
          content: result.content,
          offset: result.offset,
          limit: result.limit,
          totalChars: result.totalChars,
          hasMore: result.hasMore,
        });
      } catch (error) {
        // The containment refusal from `resolveWithinPayloadDir` arrives here.
        return failure(error);
      }
    },
  );

  server.registerTool(
    'catalog_overview',
    {
      title: 'Summarise the catalog',
      description:
        'Counts artifacts by kind, by remote and by install status, and names any manifest that '
        + 'failed to load. Use this to orient before searching -- it answers "what kinds of thing '
        + 'are available here" in one call instead of paging through hundreds of rows.',
      inputSchema: { cwd: cwdSchema, remote: remoteSchema },
      annotations: annotationsFor('catalog_overview'),
    },
    async ({ cwd, remote }) => {
      try {
        return json(summarise(engine.listCatalog({ cwd, remote })));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'refresh_catalog',
    {
      title: 'Fetch every remote, then summarise',
      description:
        'Updates the local cache of every registered remote from git, then returns the same '
        + 'summary as catalog_overview. Slow -- seconds per remote, and it can hang if a remote '
        + 'is unreachable. Call it when the catalog looks stale, not routinely.',
      inputSchema: { cwd: cwdSchema, remote: remoteSchema },
      // Derived, and the derivation gets this one right for free: the
      // capability declares `mutates: true` (it writes the remote caches under
      // ~/.deliveryos), `destructive: false` (a reset to upstream is what a
      // cache is for), and `network: true` -- so this comes out
      // readOnlyHint:false / destructiveHint:false / openWorldHint:true, which
      // is what was previously typed here by hand.
      annotations: annotationsFor('refresh_catalog'),
    },
    async ({ cwd, remote }) => {
      try {
        return json(summarise(await engine.refreshCatalog({ cwd, remote })));
      } catch (error) {
        return failure(error);
      }
    },
  );

  // --------------------------------------------------------- configuration
  //
  // Registered only when a config port was supplied. The transcript's MCP is
  // interrogative -- "our MCP will ask the user. Hey, do you have a UI
  // library? ... So after three, four questions, [initialisation] is done"
  // (00:36:16) -- and these two tools are what an agent needs to run that
  // interview.
  //
  // Deliberately NOT built on MCP elicitation. Elicitation would let the
  // server ask directly, which is closer to the literal words, but it is
  // supported in Claude Code and returns `-32601 Method not found` in Claude
  // Desktop -- so it would work in exactly one client. The agent is a better
  // interviewer anyway: it already has the conversation, it can ask follow-up
  // questions the server never anticipated, and this shape works in every
  // client that speaks MCP at all. The interview lives in the server
  // `instructions` and these descriptions; the agent drives it.
  if (configPort) {
    server.registerTool(
      'list_remotes',
      {
        title: 'List where artifacts come from',
        description:
          'Lists the git remotes DeliveryOS is configured to read artifacts from, with their '
          + 'URLs. Call this FIRST when helping someone set DeliveryOS up: if it returns an '
          + 'empty list, nothing is configured yet and the catalog will be empty for a reason '
          + 'that has nothing to do with the project. Distinct from catalog_overview, which '
          + 'counts artifacts per remote but never shows a URL.',
        inputSchema: {},
        annotations: annotationsFor('list_remotes'),
      },
      async () => {
        try {
          const remotes = configPort.listRemotes();
          return json({
            count: remotes.length,
            remotes,
            // Said plainly rather than left for the agent to infer from an
            // empty array, because "the catalog is empty" and "no sources are
            // configured" look identical otherwise and lead to very different
            // advice.
            configured: remotes.length > 0,
          });
        } catch (error) {
          return failure(error);
        }
      },
    );

    server.registerTool(
      'add_remote',
      {
        title: 'Register a source of artifacts',
        description:
          'Registers a git repository as a source of DeliveryOS artifacts and clones it into '
          + "the local cache under the user's home directory. Use this to set DeliveryOS up: ask "
          + 'the user where their shared artifacts live -- a UI component library, a set of '
          + 'Claude skills, project templates, backend plugins -- and register each repository '
          + 'they name. Ask before calling; do not guess a URL. Writes nothing into the '
          + "project, and refuses a name that is already registered before cloning anything.",
        inputSchema: {
          url: z
            .string()
            .min(1)
            .describe('Git URL of the repository, exactly as the user gave it'),
          name: z
            .string()
            .min(1)
            .optional()
            .describe('Short local name. Derived from the URL when omitted, which is usually right.'),
        },
        annotations: annotationsFor('add_remote'),
      },
      async ({ url, name }) => {
        try {
          const added = await configPort.addRemote({ url, name });
          return json({
            ...added,
            nextStep:
              'Registered. Run catalog_overview to see what this remote provides, or add_remote '
              + 'again for another source.',
          });
        } catch (error) {
          return failure(error);
        }
      },
    );
  }

  // -------------------------------------------------------- contributing
  //
  // Two tools, and the ORDER between them is the safety property: `contribute`
  // is unreachable without a token only `preview` mints. That is the
  // "argument-bound single-use grant" `docs/agent-surface-plan.md:701-707`
  // recommends over an unbounded per-tool "always allow", and it is what closes
  // the objection recorded at `:379-382` -- push being all-or-nothing over the
  // whole pulled folder with no diff preview.
  if (contributePort) {
    server.registerTool(
      'preview_contribution',
      {
        title: 'See what contributing would publish',
        description:
          'Shows exactly what pushing an artifact\'s local edits would publish: every file, its '
          + 'status, and the version bump -- WITHOUT publishing anything. Always call this first '
          + 'and show the file list to the user before contributing. It matters: push is '
          + 'all-or-nothing over the whole installed folder, so an artifact someone filled in '
          + 'with real client details would publish those to a shared repository. Reaches no '
          + 'network and writes nothing.',
        inputSchema: {
          cwd: cwdSchema,
          id: z.string().min(1).describe('The artifact id, as search_artifacts reported it'),
        },
        annotations: annotationsFor('preview_contribution'),
      },
      async ({ cwd, id }) => {
        try {
          const { plan, token } = contributePort.preview({ cwd, id });
          return json({
            id: plan.id,
            remote: plan.remoteName,
            versionBump: `${plan.previousVersion} -> ${plan.newVersion}`,
            fileCount: plan.changedFiles.length,
            files: plan.changedFiles.map((f) => ({ status: f.status, path: f.relPath })),
            stale: plan.stale,
            ...(plan.upstreamVersion ? { upstreamVersion: plan.upstreamVersion } : {}),
            pendingPr: plan.pendingPr ?? null,
            confirmationToken: token,
            nextStep:
              'Show the user this file list before going further. If they approve, call '
              + 'contribute_artifact with this confirmationToken. The token authorises exactly '
              + 'this diff, once.',
          });
        } catch (error) {
          return failure(error);
        }
      },
    );

    server.registerTool(
      'contribute_artifact',
      {
        title: 'Open a pull request with local edits',
        description:
          'Opens a pull request on the artifact\'s own remote from this project\'s local edits. '
          + 'Requires a confirmationToken from preview_contribution, which authorises exactly the '
          + 'diff that was previewed, once -- editing a file after previewing invalidates it. '
          + 'Refuses to force over a colleague\'s merged change, and refuses while a previous '
          + 'pull request from this project is still open. The PR body records that an agent '
          + 'assembled the diff.',
        inputSchema: {
          cwd: cwdSchema,
          id: z.string().min(1).describe('The artifact id, matching the preview'),
          confirmationToken: z
            .string()
            .min(1)
            .describe('From preview_contribution. Single-use, and tied to the exact previewed diff.'),
        },
        annotations: annotationsFor('contribute_artifact'),
      },
      async ({ cwd, id, confirmationToken }) => {
        try {
          const result = await contributePort.contribute({ cwd, id, token: confirmationToken });
          return json({
            ...result,
            // A warning on SUCCESS, not a failure: the PR really did open, but
            // local reads will see this unmerged branch as the remote's state
            // until something fetches.
            ...(result.cacheResetWarning
              ? { warning: result.cacheResetWarning }
              : {}),
          });
        } catch (error) {
          return failure(error);
        }
      },
    );
  }

  return server;
}

function summarise(snapshot: { entries: CatalogListEntry[]; skipped: { remoteName: string; path: string; reason: string }[] }) {
  const byKind: Record<string, number> = {};
  const byRemote: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const entry of snapshot.entries) {
    byKind[entry.manifest.kind] = (byKind[entry.manifest.kind] ?? 0) + 1;
    byRemote[entry.remoteName] = (byRemote[entry.remoteName] ?? 0) + 1;
    byStatus[entry.localStatus] = (byStatus[entry.localStatus] ?? 0) + 1;
  }
  return {
    total: snapshot.entries.length,
    byKind,
    byRemote,
    byStatus,
    // The path, not just a count. `reason` alone never identifies which file
    // is broken, so a bare count is unactionable against a 230-artifact remote.
    skipped: snapshot.skipped.map((s) => ({
      remote: s.remoteName,
      path: s.path,
      reason: s.reason,
    })),
  };
}

/** Connects the server to stdio and returns once the transport closes. */
export async function runMcpServer(deps: McpServerDeps): Promise<void> {
  await buildMcpServer(deps).connect(new StdioServerTransport());
}
