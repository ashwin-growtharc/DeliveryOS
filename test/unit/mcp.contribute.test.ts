import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../../src/mcp/server';
import { createContributionTokens } from '../../src/mcp/contributionToken';
import type { DeliveryOsContributePort, DeliveryOsReadPort } from '../../src/mcp/ports';
import type { PushPlan } from '../../src/engine/push/planPush';

/**
 * The contribution surface -- the only tool here whose mistakes land on other
 * people's work rather than the caller's.
 *
 * Every interesting case is failure-shaped. A push that works is easy; a push
 * that refuses at the right moments is the entire design. The refusals under
 * test use the REAL token implementation, so what is asserted is production
 * behaviour rather than a fake's approximation of it -- only the push itself
 * is stubbed.
 */

const CWD = 'C:/proj';
const ID = 'risk-register';

/** Read port stub. The contribution tools never touch it; it exists only
 * because `buildMcpServer` requires one. */
const readPort: DeliveryOsReadPort = {
  listCatalog: () => ({ entries: [], skipped: [] }),
  refreshCatalog: async () => ({ entries: [], skipped: [] }),
  readArtifact: () => {
    throw new Error('not used by these tests');
  },
  readPayloadFile: () => {
    throw new Error('not used by these tests');
  },
};

function fakeContributePort(opts: { pendingPr?: boolean; pushFails?: boolean } = {}) {
  const tokens = createContributionTokens();
  const pushes: string[] = [];

  const currentPlan = (): PushPlan => ({
    id: ID,
    remoteName: 'arcos',
    mode: 'edit',
    installTarget: 'C:/proj/x',
    changedFiles: [{ relPath: 'README.md', status: 'modified' }],
    previousVersion: '1.0.0',
    newVersion: '1.0.1',
    stale: false,
    ...(opts.pendingPr ? { pendingPr: { number: 7, url: 'https://example.invalid/pr/7' } } : {}),
  });

  const port: DeliveryOsContributePort = {
    preview: ({ cwd }) => {
      const plan = currentPlan();
      return { plan, token: tokens.mint(cwd, plan) };
    },
    contribute: async ({ cwd, token }) => {
      const plan = currentPlan();

      // Refused before the token is spent, because this one is recoverable by
      // resolving the open PR -- unlike a spent token, which costs a preview.
      if (plan.pendingPr) {
        throw new Error(
          `"${ID}" already has pull request #${plan.pendingPr.number} open from this project. `
            + 'Run `deliveryos check-pending-pushes` first.',
        );
      }

      // Consumed BEFORE the attempt, so a failure burns it too.
      const rejection = tokens.consume(token, cwd, plan);
      if (rejection === 'already-used') throw new Error('This preview has already been used.');
      if (rejection === 'mismatch') throw new Error('This token does not match the project.');

      if (opts.pushFails) throw new Error('pulls.create failed after the branch was pushed');

      pushes.push(token);
      return { url: 'https://example.invalid/pr/1', number: 1, branch: 'deliveryos/x/1' };
    },
  };

  return { port, pushes };
}

async function connect(contributePort?: DeliveryOsContributePort) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer({ port: readPort, contributePort, version: '9.9.9' });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { text: string }[])[0].text;
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* refusals are plain messages */
  }
  return { isError: res.isError === true, text, data };
}

describe('contributing back over MCP', () => {
  it('exposes nothing at all when no contribute port is supplied', async () => {
    // Opt-in, like the config port. A server built without one cannot publish
    // anything, and that is the default shape.
    const { client, close } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('preview_contribution');
    expect(names).not.toContain('contribute_artifact');
    await close();
  });

  it('shows the exact file list before anything is published', async () => {
    // The control this whole design turns on. docs/agent-surface-plan.md:379:
    // "An agent pushing a filled-in risk register would publish client data to
    // a shared repo." Push is all-or-nothing over the pulled folder, so the
    // answer is making the file list visible first -- not trusting the caller.
    const { port } = fakeContributePort();
    const { client, close } = await connect(port);

    const res = await call(client, 'preview_contribution', { cwd: CWD, id: ID });
    expect(res.data.files).toEqual([{ status: 'modified', path: 'README.md' }]);
    expect(res.data.versionBump).toBe('1.0.0 -> 1.0.1');
    expect(res.data.confirmationToken).toBeTruthy();
    await close();
  });

  it('refuses to contribute without a token from a preview', async () => {
    const { port, pushes } = fakeContributePort();
    const { client, close } = await connect(port);

    const res = await call(client, 'contribute_artifact', {
      cwd: CWD,
      id: ID,
      confirmationToken: 'made-up',
    });
    expect(res.isError).toBe(true);
    expect(pushes, 'nothing may be published on a bad token').toEqual([]);
    await close();
  });

  it('refuses a second contribution with the same token', async () => {
    // "The diff has not changed" is not a reason to allow a second push.
    const { port, pushes } = fakeContributePort();
    const { client, close } = await connect(port);

    const preview = await call(client, 'preview_contribution', { cwd: CWD, id: ID });
    const args = { cwd: CWD, id: ID, confirmationToken: preview.data.confirmationToken as string };

    expect((await call(client, 'contribute_artifact', args)).isError).toBe(false);

    const second = await call(client, 'contribute_artifact', args);
    expect(second.isError).toBe(true);
    expect(second.text).toContain('already been used');
    expect(pushes).toHaveLength(1);
    await close();
  });

  it('burns the token even when the push FAILS -- the orphaned-branch case', async () => {
    // The case the whole consume-before-attempt ordering exists for.
    // `pushBranch` succeeding and `pulls.create` then failing leaves a branch
    // on the shared remote that NOTHING deletes (push.ts:753 -> :756, and
    // git.ts:76-82 documents the leftover as expected). No `pendingPr` is
    // written either, because that happens only after the PR opens. Agents
    // retry by default; consuming after success would fan out branches.
    const { port } = fakeContributePort({ pushFails: true });
    const { client, close } = await connect(port);

    const preview = await call(client, 'preview_contribution', { cwd: CWD, id: ID });
    const args = { cwd: CWD, id: ID, confirmationToken: preview.data.confirmationToken as string };

    const first = await call(client, 'contribute_artifact', args);
    expect(first.isError).toBe(true);

    const retry = await call(client, 'contribute_artifact', args);
    expect(retry.isError).toBe(true);
    expect(
      retry.text,
      'a retry must be refused as spent, not re-attempted -- otherwise it makes a second branch',
    ).toContain('already been used');
    await close();
  });

  it('refuses while a previous pull request from this project is still open', async () => {
    // Not politeness. An open `pendingPr` is read at push.ts:624 as
    // `hasOwnPushInFlight` and DISABLES the stale-push guard for the next
    // push -- so contributing on top of one removes a safety check rather
    // than queueing behind it.
    const { port, pushes } = fakeContributePort({ pendingPr: true });
    const { client, close } = await connect(port);

    const preview = await call(client, 'preview_contribution', { cwd: CWD, id: ID });
    expect(preview.data.pendingPr).not.toBeNull();

    const res = await call(client, 'contribute_artifact', {
      cwd: CWD,
      id: ID,
      confirmationToken: preview.data.confirmationToken as string,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('check-pending-pushes');
    expect(pushes).toEqual([]);
    await close();
  });

  it('offers no way to force', async () => {
    // Not "refuses force" -- there is no parameter for it, so it cannot be
    // asked for. push.ts:653-658 records that the desktop app has no force
    // affordance because "a one-click force over a colleague's merged change
    // is exactly the operation that should stay hard". An MCP tool is a
    // one-click affordance.
    const { port } = fakeContributePort();
    const { client, close } = await connect(port);

    const tool = (await client.listTools()).tools.find((t) => t.name === 'contribute_artifact');
    expect(Object.keys(tool?.inputSchema?.properties ?? {}).sort()).toEqual([
      'confirmationToken',
      'cwd',
      'id',
    ]);
    await close();
  });

  it('annotates both tools as writes, so a client prompts', async () => {
    // Even the preview: it is declared against `artifact.push`, which mutates.
    // Annotating it read-only would be convenient and would misstate which
    // capability it belongs to.
    const { port } = fakeContributePort();
    const { client, close } = await connect(port);

    const byName = Object.fromEntries(
      (await client.listTools()).tools.map((t) => [t.name, t.annotations]),
    );
    expect((byName.preview_contribution as { readOnlyHint?: boolean })?.readOnlyHint).toBe(false);
    expect((byName.contribute_artifact as { readOnlyHint?: boolean })?.readOnlyHint).toBe(false);
    await close();
  });
});
