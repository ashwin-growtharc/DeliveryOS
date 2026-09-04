import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../../src/mcp/server';
import { DeliveryOsConfigPort, DeliveryOsReadPort, CatalogSnapshot } from '../../src/mcp/ports';
import { CatalogListEntry } from '../../src/engine/catalog/catalog';
import { CAPABILITIES, Capability } from '../../src/capabilities';

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

/** A config port whose remotes start empty, so the onboarding interview has
 * something real to be interviewing ABOUT. */
function fakeConfigPort(seed: Array<{ name: string; url: string }> = []) {
  const remotes = seed.map((r) => ({ ...r, addedAt: '2026-01-01T00:00:00.000Z' }));
  return {
    port: {
      listRemotes: () => remotes,
      addRemote: async ({ url, name }: { url: string; name?: string }) => {
        const resolved = name ?? 'derived-name';
        if (remotes.some((r) => r.name === resolved)) {
          throw new Error(`A remote named "${resolved}" is already registered`);
        }
        remotes.push({ name: resolved, url, addedAt: '2026-01-01T00:00:00.000Z' });
        return { name: resolved, url, dest: `/cache/${resolved}` };
      },
    } satisfies DeliveryOsConfigPort,
    remotes,
  };
}

async function connectWithConfig(configPort: DeliveryOsConfigPort) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer({ port: fakePort(), configPort, version: '9.9.9' });
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

describe('the interrogative MCP -- onboarding, not artifact movement', () => {
  // The transcript's actual MCP vision (00:36:16): "our MCP will ask the user.
  // Hey, do you have a UI library? ... you store skills? ... So after three,
  // four questions, [initialisation] is done." It is neither pull nor push.

  it('exposes no configuration tools at all when no config port is supplied', async () => {
    // Opt-in, not opt-out. The read-only server that shipped stays exactly
    // what it was, and an embedder gets write access only by asking.
    const { client, close } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain('add_remote');
    expect(tools.map((t) => t.name)).not.toContain('list_remotes');
    await close();
  });

  it('tells an agent that nothing is configured, rather than looking like an empty catalog', async () => {
    // The distinction this exists for: "no artifacts match" and "no sources
    // are registered" look identical from search results and lead to
    // completely different advice.
    const { port } = fakeConfigPort();
    const { client, close } = await connectWithConfig(port);
    const res = await call(client, 'list_remotes', {});
    const data = JSON.parse(res.text) as { count: number; configured: boolean };
    expect(data.count).toBe(0);
    expect(data.configured).toBe(false);
    await close();
  });

  it('registers what the user names, and reports it back', async () => {
    const { port, remotes } = fakeConfigPort();
    const { client, close } = await connectWithConfig(port);

    const res = await call(client, 'add_remote', {
      url: 'https://example.invalid/ui-library',
      name: 'ui-library',
    });
    expect(res.isError).toBe(false);
    expect(remotes.map((r) => r.name)).toEqual(['ui-library']);

    const after = JSON.parse((await call(client, 'list_remotes', {})).text) as { configured: boolean };
    expect(after.configured).toBe(true);
    await close();
  });

  it('surfaces a duplicate registration as an error the agent can read', async () => {
    const { port } = fakeConfigPort([{ name: 'ui-library', url: 'https://example.invalid/ui' }]);
    const { client, close } = await connectWithConfig(port);
    const res = await call(client, 'add_remote', { url: 'https://example.invalid/other', name: 'ui-library' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('already registered');
    await close();
  });

  it('needs no project directory, which is why it could ship before install tools', async () => {
    // `remote.add` is declared `needsProjectDir: false`, so the project-root
    // authority problem that gates every install tool does not apply. Asserted
    // through the WIRE: the tool must not require a `cwd` argument.
    const { port } = fakeConfigPort();
    const { client, close } = await connectWithConfig(port);
    const { tools } = await client.listTools();
    for (const name of ['add_remote', 'list_remotes']) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, `${name} should be advertised`).toBeDefined();
      expect(tool?.inputSchema?.required ?? [], `${name} must not require cwd`).not.toContain('cwd');
    }
    await close();
  });

  it('annotates add_remote as a write, so a client prompts', async () => {
    const { port } = fakeConfigPort();
    const { client, close } = await connectWithConfig(port);
    const { tools } = await client.listTools();
    const add = tools.find((t) => t.name === 'add_remote');
    expect(add?.annotations?.readOnlyHint).toBe(false);
    expect(add?.annotations?.destructiveHint).toBe(false);
    const list = tools.find((t) => t.name === 'list_remotes');
    expect(list?.annotations?.readOnlyHint).toBe(true);
    await close();
  });
});

describe('MCP tool surface', () => {
  // Named for the COMPOSITION, not the product. `connect()` supplies the read
  // port only, so this pins what a server built from that port alone exposes.
  // The shipped server has eight tools, because `src/cli/commands/mcp.ts` also
  // supplies the config and contribute ports.
  //
  // Deliberately not called "the four read-only tools": `refresh_catalog` is
  // declared `readOnlyHint: false` -- it fetches every remote into the caches
  // under ~/.deliveryos -- so four tools here are not four read-only tools.
  it('with the read port alone, advertises exactly those four tools and no mutating one', async () => {
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

  describe('search answers questions the way they are actually asked', () => {
    // Every search test here used a SINGLE WORD, because that is what the
    // scorer was built for -- so the tests agreed with the code and both were
    // wrong. Dogfooding the tool against the real catalog found it in under a
    // minute: "reviewing a pull request" returned ZERO matches against a
    // catalog containing `code-reviewer`, `pr-review-reality-checker` and
    // `java-api-review`, because the whole phrase was matched as one substring.
    //
    // The failure mode is the worst available -- an empty result reads as an
    // answer, and an agent concludes nothing is available.

    it('finds an artifact from a multi-word question', async () => {
      const { client, close } = await connect();
      const res = await call(client, 'search_artifacts', {
        cwd: '/p',
        query: 'reviewing a diff for defects',
      });
      expect(res.data.results.map((r) => r.id)).toContain('code-review');
      await close();
    });

    it('matches a word stem, since questions do not use catalog spelling', async () => {
      // "reviewing" must reach `code-review`. Substring matching cannot do
      // this in that direction -- 'code-review'.includes('reviewing') is false.
      const { client, close } = await connect();
      const res = await call(client, 'search_artifacts', { cwd: '/p', query: 'reviewing' });
      expect(res.data.results.map((r) => r.id)).toContain('code-review');
      await close();
    });

    it('does not match a short word hiding inside a longer one', async () => {
      // The other direction, and the one that produced nonsense answers:
      // "up" is inside "lookup" and "updater", so "setting up authentication"
      // ranked documentation artifacts first. Word-level matching means a
      // fragment matches nothing.
      const { client, close } = await connect();
      const res = await call(client, 'search_artifacts', { cwd: '/p', query: 'utt' });
      expect(res.data.total, '"utt" is a fragment of "button" and must not match it').toBe(0);
      await close();
    });

    it('ranks something matching two terms above something matching one', async () => {
      // Breadth over depth. Without it, an artifact mentioning one term
      // repeatedly outranks one that actually answers the whole question.
      const { client, close } = await connect();
      const res = await call(client, 'search_artifacts', { cwd: '/p', query: 'button component' });
      expect(res.data.results[0].id).toBe('react-button');
      await close();
    });

    it('returns nothing for a query of only filler words', async () => {
      // "how do I" is not a search. Ranking the whole catalog for it would be
      // worse than saying nothing.
      const { client, close } = await connect();
      const res = await call(client, 'search_artifacts', { cwd: '/p', query: 'how do I' });
      expect(res.data.total).toBe(0);
      await close();
    });
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

  it('annotates every tool from the capability manifest, not from a second hand-typed copy', async () => {
    // Annotations decide whether a person is asked before a tool runs --
    // Anthropic's directory rules state that read-only tools may run without
    // per-call confirmation while destructive ones always prompt. So "what
    // does this operation do" must have exactly one source, or the answer can
    // differ between the manifest and the wire.
    //
    // Asserted against the DECLARATION rather than against literals, so this
    // test cannot be satisfied by editing both copies to agree while both are
    // wrong about the operation.
    const { client, close } = await connect();
    const { tools } = await client.listTools();

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      const capability = CAPABILITIES.find((c) => c.mcp?.includes(tool.name));
      expect(capability, `tool "${tool.name}" is not declared in src/capabilities.ts`).toBeDefined();
      expect(tool.annotations?.readOnlyHint, `${tool.name}.readOnlyHint`).toBe(!capability!.mutates);
      expect(tool.annotations?.destructiveHint, `${tool.name}.destructiveHint`).toBe(capability!.destructive);
      expect(tool.annotations?.openWorldHint, `${tool.name}.openWorldHint`).toBe(capability!.network);
    }
    await close();
  });

  describe('the manifest as a gate, not just a data source', () => {
    // Deriving `destructiveHint` tells a client to PROMPT. It does not stop a
    // destructive operation being exposed at all. Those are different
    // guarantees, and only the second answers "can an agent reach this".
    //
    // This is the `needsApproval` failure shape recorded in
    // docs/agent-surface-plan.md: a declared risk flag that no code refuses to
    // act on is a flag an adapter can forget to read.

    /** Temporarily reclassifies a real capability, because the gate reads the
     * live manifest -- there is no way to fake it that also proves the
     * production path. Restored in `finally` so one failure cannot poison the
     * rest of the file. */
    function reclassified(name: string, patch: Partial<Capability>, run: () => void): void {
      const capability = CAPABILITIES.find((c) => c.name === name) as Capability;
      expect(capability, `${name} must exist for this test to mean anything`).toBeDefined();

      // Restore by key, and DELETE keys the snapshot did not have.
      // `Object.assign(capability, {...before})` cannot remove a key that was
      // absent before the patch -- so patching `mcp` onto a capability that
      // had none left it there afterwards and poisoned every later test in
      // this file. The anti-vacuity test below is what caught it.
      const touched = Object.keys(patch) as (keyof Capability)[];
      const before = new Map(touched.map((k) => [k, [k in capability, capability[k]] as const]));
      Object.assign(capability, patch);
      try {
        run();
      } finally {
        for (const key of touched) {
          const [existed, value] = before.get(key)!;
          if (existed) (capability as Record<string, unknown>)[key] = value;
          else delete (capability as Record<string, unknown>)[key];
        }
      }
    }

    it('refuses to build a server exposing a destructive capability', () => {
      // `catalog.list` backs two live tools. Reclassifying it destructive is
      // the same situation as someone adding `mcp:` to `artifact.remove`,
      // which deletes an install target with no local-edit guard.
      reclassified('catalog.list', { destructive: true, mutates: true }, () => {
        expect(() => buildMcpServer({ port: fakePort(), version: '9.9.9' }))
          .toThrow(/can destroy work its caller cannot recover/);
      });
    });

    it('refuses to build a server exposing a capability that spends real money', () => {
      // Eight operations make paid model calls. An agent has no way to know it
      // is spending, and two of the eight are CLI-only -- so nobody reading
      // the sidecar would even find them.
      reclassified('catalog.list', { costsRealMoney: true }, () => {
        expect(() => buildMcpServer({ port: fakePort(), version: '9.9.9' }))
          .toThrow(/spends real money/);
      });
    });

    it('refuses a tool name claimed by two capabilities', () => {
      // With `find` instead of `filter` this passed silently: the first
      // claimant won and a risky second one inherited its clean annotations.
      reclassified('artifact.remove', { mcp: ['search_artifacts'] }, () => {
        expect(() => buildMcpServer({ port: fakePort(), version: '9.9.9' }))
          .toThrow(/claimed by more than one capability/);
      });
    });

    it('still builds normally once every reclassification is reverted', () => {
      // Anti-vacuity. If the assertions above passed because the server always
      // throws, or because a `finally` failed to restore, this fails and says so.
      expect(() => buildMcpServer({ port: fakePort(), version: '9.9.9' })).not.toThrow();
      expect(CAPABILITIES.find((c) => c.name === 'catalog.list')?.destructive).toBe(false);
      expect(CAPABILITIES.find((c) => c.name === 'artifact.remove')?.mcp).toBeUndefined();
    });

    it('allows a risky capability only when it is named, with a reason', () => {
      // `catalog.refresh` mutates (the ~/.deliveryos caches) and is the single
      // deliberate exception. Allowlisted BY CAPABILITY NAME, so renaming a
      // tool cannot inherit an exemption meant for another operation.
      const refresh = CAPABILITIES.find((c) => c.name === 'catalog.refresh');
      expect(refresh?.mutates).toBe(true);
      expect(refresh?.destructive).toBe(false);
      expect(refresh?.costsRealMoney).toBe(false);
    });
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
