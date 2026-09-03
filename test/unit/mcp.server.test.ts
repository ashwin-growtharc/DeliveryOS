import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../../src/mcp/server';
import { DeliveryOsReadPort, CatalogSnapshot } from '../../src/mcp/ports';
import { CatalogListEntry } from '../../src/engine/catalog/catalog';

/**
 * The whole tool surface, driven through a real MCP client over a real
 * transport, with the engine replaced by a fake port.
 *
 * This is what the port in `src/mcp/ports.ts` bought. `test/e2e/sidecar.e2e.test.ts`
 * had to build a 100-line subprocess harness with manual request/response
 * correlation to test the OTHER driving adapter, because that one has no seam.
 * These tests need no subprocess, no filesystem, no git remote and no fixtures,
 * and the file runs in milliseconds -- which is the difference between a
 * guardrail people keep and one they delete when it gets slow.
 */

function entry(over: Partial<CatalogListEntry['manifest']> & { id: string }, rest: Partial<CatalogListEntry> = {}): CatalogListEntry {
  return {
    remoteName: rest.remoteName ?? 'arcos',
    localStatus: rest.localStatus ?? 'not_pulled',
    installTarget: rest.installTarget ?? `.claude/skills/${over.id}`,
    ...(rest.pendingPr ? { pendingPr: rest.pendingPr } : {}),
    manifest: {
      id: over.id,
      kind: over.kind ?? 'skill',
      description: over.description ?? 'A test artifact',
      owner: over.owner ?? 'team-x',
      version: over.version ?? '1.0.0',
      source_repo: 'https://example.invalid/repo',
      install_target: `.claude/skills/${over.id}`,
      review_required: false,
      tags: over.tags ?? { roles: [], teams: [], stacks: [], componentTypes: [] },
      install_params: over.install_params ?? [],
      wiring_actions: over.wiring_actions ?? [],
      ...(over.post_install ? { post_install: over.post_install } : {}),
    },
  };
}

const CATALOG: CatalogListEntry[] = [
  entry({ id: 'code-review', description: 'Reviews a diff for defects', tags: { roles: ['engineer'], teams: [], stacks: [], componentTypes: [] } }),
  entry({ id: 'react-button', kind: 'ui-component', description: 'A button component' }, { localStatus: 'pulled' }),
  entry({ id: 'auth-prisma', kind: 'backend-plugin', description: 'Auth.js with Prisma', post_install: 'npm install @auth/prisma-adapter' }, { localStatus: 'edited_locally', remoteName: 'internal' }),
];

let refreshCalls = 0;

function fakePort(overrides: Partial<DeliveryOsReadPort> = {}): DeliveryOsReadPort {
  const snapshot = (remote?: string): CatalogSnapshot => ({
    entries: remote ? CATALOG.filter((e) => e.remoteName === remote) : CATALOG,
    skipped: [{ remoteName: 'arcos', path: 'artifacts/broken/manifest.yaml', reason: 'failed validation: version: Required' }],
  });
  return {
    listCatalog: ({ remote }) => snapshot(remote),
    refreshCatalog: async ({ remote }) => {
      refreshCalls += 1;
      return snapshot(remote);
    },
    readArtifact: ({ id }) => {
      const found = CATALOG.find((e) => e.manifest.id === id);
      if (!found) throw new Error(`No artifact with id "${id}" found in any registered remote`);
      return { entry: found, doc: { relPath: 'SKILL.md', content: '# Code Review\n\nDo the thing.', truncated: false } };
    },
    ...overrides,
  };
}

async function connect(port: DeliveryOsReadPort = fakePort()) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer({ port, version: '9.9.9' });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/** The union of every field the four tools put on the wire. A grab-bag by
 * nature -- but written out rather than typed `any`, so the tests state what
 * shape they expect and keep working the day `test/` is finally typechecked
 * (an Open item in PLAN.md). */
interface ToolJson {
  total: number;
  returned: number;
  truncated: boolean;
  results: Array<{ id: string; kind: string; remote: string; localStatus: string; installTarget: string; tags: string[] }>;
  skippedManifests: number;
  skipped: Array<{ remote: string; path: string; reason: string }>;
  byKind: Record<string, number>;
  byRemote: Record<string, number>;
  byStatus: Record<string, number>;
  postInstall: string | null;
  pullCommand: string;
  doc: { path: string; content: string; truncated: boolean } | null;
  hasDoc: boolean;
}

/** Every tool returns JSON as its single text block. */
async function call(client: Client, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string; data: ToolJson }> {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { text: string }[])[0].text;
  let data = {} as ToolJson;
  try {
    data = JSON.parse(text) as ToolJson;
  } catch {
    /* error results are plain messages, not JSON */
  }
  return { isError: res.isError === true, text, data };
}

describe('MCP tool surface', () => {
  it('advertises exactly the four read-only tools, and no mutating one', async () => {
    const { client, close } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'catalog_overview',
      'get_artifact',
      'refresh_catalog',
      'search_artifacts',
    ]);
    await close();
  });

  it('refuses a tool it never advertised, through tools/call and not merely by omission', async () => {
    // The guardrail that matters: `pull`, `push` and `remove` all write --
    // to a person's project or to a shared remote -- and the multi-user work
    // that just landed exists because those paths destroy work when two
    // actors disagree. An agent is a second actor.
    //
    // Asserted on `isError`, NOT `rejects.toThrow()`. McpServer converts an
    // unknown-tool -32602 into a RESOLVED result, so a rejection assertion
    // here would pass for the wrong reason and keep passing on the day
    // someone actually exposes `artifact_pull`.
    const { client, close } = await connect();
    for (const forbidden of ['artifact_pull', 'artifact_push', 'artifact_remove']) {
      const res = await call(client, forbidden, { cwd: '/p' });
      expect(res.isError, `${forbidden} must not be callable`).toBe(true);
      expect(res.text).toContain('not found');
    }
    await close();
  });

  it('reports a missing required argument as an error rather than guessing', async () => {
    const { client, close } = await connect();
    const res = await call(client, 'get_artifact', { cwd: '/p' });
    expect(res.isError).toBe(true);
    await close();
  });

  it('ranks an exact id match above a description-only match', async () => {
    const { client, close } = await connect();
    const res = await call(client, 'search_artifacts', { cwd: '/p', query: 'code-review' });
    expect(res.data.results[0].id).toBe('code-review');
    await close();
  });

  it('caps results and says so, instead of returning the whole catalog', async () => {
    // The live catalog is 230 artifacts. A tool that dumps all of them spends
    // the agent's context on a directory listing.
    const { client, close } = await connect();
    const res = await call(client, 'search_artifacts', { cwd: '/p', limit: 1 });
    expect(res.data.returned).toBe(1);
    expect(res.data.total).toBe(3);
    expect(res.data.truncated).toBe(true);
    await close();
  });

  it('filters by kind and by install status', async () => {
    const { client, close } = await connect();
    const byKind = await call(client, 'search_artifacts', { cwd: '/p', kind: 'backend-plugin' });
    expect(byKind.data.results.map((r) => r.id)).toEqual(['auth-prisma']);

    const byStatus = await call(client, 'search_artifacts', { cwd: '/p', status: 'pulled' });
    expect(byStatus.data.results.map((r) => r.id)).toEqual(['react-button']);
    await close();
  });

  it('tells the caller the catalog was incomplete, on search as well as on overview', async () => {
    // An agent that searched for something a broken manifest would have
    // matched must know its answer came from a partial catalog.
    const { client, close } = await connect();
    const search = await call(client, 'search_artifacts', { cwd: '/p' });
    expect(search.data.skippedManifests).toBe(1);

    const overview = await call(client, 'catalog_overview', { cwd: '/p' });
    // The path, not just a count -- `reason` alone never identifies a file.
    expect(overview.data.skipped[0].path).toBe('artifacts/broken/manifest.yaml');
    await close();
  });

  it('summarises by kind, remote and status', async () => {
    const { client, close } = await connect();
    const res = await call(client, 'catalog_overview', { cwd: '/p' });
    expect(res.data.total).toBe(3);
    expect(res.data.byKind).toEqual({ skill: 1, 'ui-component': 1, 'backend-plugin': 1 });
    expect(res.data.byStatus).toEqual({ not_pulled: 1, pulled: 1, edited_locally: 1 });
    await close();
  });

  it('exposes post_install as the command itself, not as a boolean', async () => {
    // The desktop app coerced this to `!!` in both places it touched it, so
    // nobody could see WHAT would run on their machine. An agent recommending
    // an artifact should be able to quote the command.
    const { client, close } = await connect();
    const res = await call(client, 'get_artifact', { cwd: '/p', id: 'auth-prisma' });
    expect(res.data.postInstall).toBe('npm install @auth/prisma-adapter');
    await close();
  });

  it('hands back the exact pull command, since installing is always a handoff', async () => {
    // These tools are read-only on purpose, so every install is a handoff to
    // the CLI. A handoff that hands over a half-specified command is where an
    // agent guesses at --remote and pulls the wrong artifact from the wrong
    // remote -- so the remote is always named, even when the id happens to be
    // unambiguous today.
    const { client, close } = await connect();
    const res = await call(client, 'get_artifact', { cwd: '/p', id: 'auth-prisma' });
    expect(res.data.pullCommand).toBe('deliveryos pull auth-prisma --remote internal');
    await close();
  });

  it('returns the primary document body, and omits it on request', async () => {
    const { client, close } = await connect();
    const withDoc = await call(client, 'get_artifact', { cwd: '/p', id: 'code-review' });
    expect(withDoc.data.doc.content).toContain('# Code Review');
    expect(withDoc.data.doc.path).toBe('SKILL.md');

    const without = await call(client, 'get_artifact', { cwd: '/p', id: 'code-review', includeDoc: false });
    expect(without.data.doc).toBeNull();
    // Still says one exists -- "no doc requested" and "no doc exists" are
    // different facts and an agent should not have to conflate them.
    expect(without.data.hasDoc).toBe(true);
    await close();
  });

  it('surfaces an unknown id as the engine\'s own message, not an empty result', async () => {
    const { client, close } = await connect();
    const res = await call(client, 'get_artifact', { cwd: '/p', id: 'does-not-exist' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('No artifact with id "does-not-exist"');
    await close();
  });

  it('does not touch the network on search or overview, and does on refresh', async () => {
    // `refresh_catalog` is the only tool here that can hang for seconds or
    // block on an unreachable remote. If search silently fetched, an agent
    // exploring a catalog would serialise on git.
    refreshCalls = 0;
    const { client, close } = await connect();
    await call(client, 'search_artifacts', { cwd: '/p' });
    await call(client, 'catalog_overview', { cwd: '/p' });
    expect(refreshCalls).toBe(0);

    await call(client, 'refresh_catalog', { cwd: '/p' });
    expect(refreshCalls).toBe(1);
    await close();
  });

  it('declares refresh_catalog as the one tool that is not read-only', async () => {
    const { client, close } = await connect();
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(byName.search_artifacts?.readOnlyHint).toBe(true);
    expect(byName.get_artifact?.readOnlyHint).toBe(true);
    expect(byName.catalog_overview?.readOnlyHint).toBe(true);
    // It writes to the remote caches under ~/.deliveryos and reaches the
    // network. Saying otherwise would be convenient and false.
    expect(byName.refresh_catalog?.readOnlyHint).toBe(false);
    expect(byName.refresh_catalog?.openWorldHint).toBe(true);
    await close();
  });

  it('passes cwd and remote through to the port unchanged', async () => {
    // cwd decides whether an artifact reads as installed. A tool that dropped
    // it would answer confidently about the wrong project.
    const seen: unknown[] = [];
    const port = fakePort({
      listCatalog: (input) => {
        seen.push(input);
        return { entries: [], skipped: [] };
      },
    });
    const { client, close } = await connect(port);
    await call(client, 'search_artifacts', { cwd: 'C:/work/app', remote: 'internal' });
    expect(seen).toEqual([{ cwd: 'C:/work/app', remote: 'internal' }]);
    await close();
  });
});
