import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { CatalogListEntry } from '../engine/catalog/catalog';
import type { DeliveryOsReadPort } from './ports';

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

/** Additive, so an artifact matching on both id and description outranks one
 * matching on either alone. Deterministic and explainable on purpose -- an
 * agent that cannot predict the ranking will just request everything. */
function score(entry: CatalogListEntry, query: string): number {
  const q = query.toLowerCase();
  const id = entry.manifest.id.toLowerCase();
  let total = 0;
  if (id === q) total += 100;
  else if (id.includes(q)) total += 60;
  if (entry.manifest.description.toLowerCase().includes(q)) total += 30;
  if (flattenTags(entry).some((t) => t.toLowerCase().includes(q))) total += 20;
  if (entry.manifest.kind.toLowerCase() === q) total += 15;
  return total;
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

export interface McpServerDeps {
  /** Required, not defaulted. Defaulting it to `createEngineReadPort()` here
   * would make this file import engine BEHAVIOUR for the sake of convenience,
   * and the convenience is worth nothing: the CLI command is the composition
   * root and is the only caller that has to know. What it buys is that
   * `src/mcp/server.ts` has no runtime dependency on the core at all. */
  port: DeliveryOsReadPort;
  /** Passed in rather than declared here. `src/cli/program.ts` owns the one
   * version literal in this codebase and `test/unit/cliVersion.test.ts` fails
   * the build when it drifts from package.json -- a second literal here would
   * be exactly the drift that test exists to prevent. */
  version: string;
}

export function buildMcpServer({ port: engine, version }: McpServerDeps): McpServer {

  const server = new McpServer(
    { name: 'deliveryos', version },
    {
      capabilities: { tools: {} },
      instructions:
        'DeliveryOS distributes versioned artifacts (skills, agents, rules, commands, '
        + 'UI components, templates, backend plugins) from git remotes into a project. '
        + 'These tools are READ-ONLY: they let you find an artifact and read what it '
        + 'contains, so you can tell the user what is available and what it would do. '
        + 'They cannot pull, push, or modify anything. That is not a dead end: '
        + 'DeliveryOS is a CLI, so to install an artifact you run its `pullCommand` '
        + '(returned by get_artifact) in a terminal, the same way a person would. '
        + 'Read the artifact first and tell the user what it will do -- especially '
        + 'its postInstall, which is a shell command that runs on their machine. '
        + 'Every tool needs `cwd`, the absolute '
        + 'path of the project being worked in, because whether an artifact is already '
        + 'installed is a property of that project, not of the machine.',
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
      annotations: { readOnlyHint: true, openWorldHint: false },
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
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ cwd, id, remote, includeDoc }) => {
      try {
        const { entry, doc } = engine.readArtifact({ cwd, id, remote });
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
    'catalog_overview',
    {
      title: 'Summarise the catalog',
      description:
        'Counts artifacts by kind, by remote and by install status, and names any manifest that '
        + 'failed to load. Use this to orient before searching -- it answers "what kinds of thing '
        + 'are available here" in one call instead of paging through hundreds of rows.',
      inputSchema: { cwd: cwdSchema, remote: remoteSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
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
      annotations: {
        // Not read-only: it mutates the local remote caches under
        // ~/.deliveryos. It touches nothing in the user's project, hence not
        // destructive, and it does reach the network, hence open-world. Stated
        // precisely because a client may gate on these.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ cwd, remote }) => {
      try {
        return json(summarise(await engine.refreshCatalog({ cwd, remote })));
      } catch (error) {
        return failure(error);
      }
    },
  );

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
