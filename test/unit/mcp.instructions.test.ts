import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../../src/mcp/server';
import type {
  DeliveryOsConfigPort,
  DeliveryOsContributePort,
  DeliveryOsReadPort,
} from '../../src/mcp/ports';

/**
 * The server's `instructions` must describe the server that was actually built.
 *
 * This exists because it did not. The string was a single unconditional literal
 * saying "These tools are READ-ONLY ... They cannot pull, push, or modify
 * anything", and it stayed that way through `add_remote` and
 * `contribute_artifact` shipping. Unlike a stale comment, this is **runtime
 * output**: it is the first thing a connecting client reads and the one
 * statement an agent uses to decide what it may do.
 *
 * The manifest gate cannot catch it. That gate checks declarations -- every
 * tool has a capability entry, every risky one is allowlisted. Nothing checked
 * the PROSE, which made it a flag beside the handler rather than a gate inside
 * it: exactly the `needsApproval` failure shape this whole phase is built
 * around.
 *
 * Asserted in BOTH directions, because either half alone is satisfiable by
 * accident: a server that writes must say so, and a server that does not must
 * not claim it does.
 */

const readPort: DeliveryOsReadPort = {
  listCatalog: () => ({ entries: [], skipped: [] }),
  refreshCatalog: async () => ({ entries: [], skipped: [] }),
  readArtifact: () => {
    throw new Error('unused');
  },
  readPayloadFile: () => {
    throw new Error('unused');
  },
};

const configPort: DeliveryOsConfigPort = {
  listRemotes: () => [],
  addRemote: async ({ url }) => ({ name: 'x', url, dest: '/cache/x' }),
};

const contributePort: DeliveryOsContributePort = {
  preview: () => {
    throw new Error('unused');
  },
  contribute: async () => {
    throw new Error('unused');
  },
};

/** Reads the instructions off the wire, the way a client does -- not off the
 * object -- so this tests what is actually sent. */
async function instructionsOf(deps: {
  configPort?: DeliveryOsConfigPort;
  contributePort?: DeliveryOsContributePort;
}): Promise<{ text: string; tools: string[] }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer({ port: readPort, version: '9.9.9', ...deps });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const text = client.getInstructions() ?? '';
  const tools = (await client.listTools()).tools.map((t) => t.name);

  await client.close();
  await server.close();
  return { text, tools };
}

describe('the server describes the server that was built', () => {
  it('claims read-only ONLY when no writing port was supplied', async () => {
    const { text, tools } = await instructionsOf({});
    expect(text).toContain('READ-ONLY');
    expect(tools).not.toContain('add_remote');
    expect(tools).not.toContain('contribute_artifact');
  });

  it('never claims read-only once a writing port is supplied', async () => {
    // The bug, stated as an assertion. Both of these servers can write.
    for (const deps of [{ configPort }, { contributePort }, { configPort, contributePort }]) {
      const { text } = await instructionsOf(deps);
      expect(
        text,
        'the server told a client it is read-only while holding a tool that writes',
      ).not.toContain('READ-ONLY');
      expect(text).not.toContain('cannot install, contribute, or modify anything');
    }
  });

  it('names every writing tool it exposes, and names no tool it does not', async () => {
    // Both directions. Either half alone can pass by accident -- prose that
    // mentions everything always satisfies the first, and prose that mentions
    // nothing always satisfies the second.
    const cases = [
      { deps: {}, writes: [] as string[] },
      { deps: { configPort }, writes: ['add_remote'] },
      { deps: { contributePort }, writes: ['contribute_artifact'] },
      { deps: { configPort, contributePort }, writes: ['add_remote', 'contribute_artifact'] },
    ];

    for (const { deps, writes } of cases) {
      const { text, tools } = await instructionsOf(deps);
      for (const name of writes) {
        expect(tools, `${name} should be exposed for this composition`).toContain(name);
        expect(text, `instructions must name the writing tool ${name}`).toContain(name);
      }
      for (const absent of ['add_remote', 'contribute_artifact'].filter((n) => !writes.includes(n))) {
        expect(
          text,
          `instructions mention ${absent}, which this server does not expose`,
        ).not.toContain(absent);
      }
    }
  });

  it('always says installing happens through the CLI, since no composition installs', async () => {
    // The one claim that is true of every shape: there is no install tool, and
    // an agent that does not know that will look for one.
    for (const deps of [{}, { configPort }, { contributePort }, { configPort, contributePort }]) {
      const { text, tools } = await instructionsOf(deps);
      expect(text).toContain('There is no install tool here');
      expect(tools.some((t) => t.includes('pull') || t.includes('install'))).toBe(false);
    }
  });

  it('tells an agent to preview before contributing, whenever it can contribute', async () => {
    // The disclosure the contribution flow rests on. If the instructions do not
    // say it, the tool description is the only place it appears -- and an agent
    // that has already decided to push may never read that far.
    const { text } = await instructionsOf({ contributePort });
    expect(text).toContain('preview_contribution');
    expect(text.indexOf('preview_contribution')).toBeLessThan(text.indexOf('contribute_artifact'));
    expect(text).toContain('client details');
  });
});
