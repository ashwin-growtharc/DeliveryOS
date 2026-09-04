import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../../src/mcp/server';
import type { DeliveryOsReadPort } from '../../src/mcp/ports';
import type { CatalogListEntry } from '../../src/engine/catalog/catalog';

/**
 * A RANKING EVAL, not a unit test of a function.
 *
 * Ranking cannot be verified by reading the scorer -- three plausible fixes were
 * proposed for the defect this file exists to pin, and measurement refuted all
 * three: whole-query substring matching, IDF over metadata, and IDF over bodies.
 * That is not bad luck, it is what ranking work is like without an eval. This
 * file is the more durable artifact of the two; the scorer is replaceable.
 *
 * THE DEFECT
 *
 * The scorer indexed id, description, tags and kind -- never the artifact's
 * primary document. Measured against the real 230-artifact catalog:
 *
 *     term         df(description)   df(body)
 *     stale                      0          9
 *     comments                   0          2
 *     claims                     0          4
 *     drift                      0         10
 *
 * So a query using the words that actually carry the intent matched nothing,
 * while artifacts sharing an incidental token ranked top. `email-code-auth` --
 * a passwordless-login plugin -- ranked 2nd for "catch stale comments that no
 * longer match the code", because it contains the token `code`.
 *
 * THE FIXTURE
 *
 * Synthetic, and shaped to reproduce that exactly: three artifacts whose
 * DESCRIPTIONS carry a mid-frequency term, and one whose description does not
 * but whose BODY does. Hermetic on purpose -- an eval that depends on the live
 * catalog changes meaning every time someone pushes an artifact.
 */

function entry(
  over: { id: string; kind?: string; description: string },
  remoteName = 'arcos',
): CatalogListEntry {
  return {
    remoteName,
    localStatus: 'not_pulled',
    installTarget: `.claude/skills/${over.id}`,
    manifest: {
      id: over.id,
      kind: over.kind ?? 'skill',
      description: over.description,
      owner: 'team-x',
      version: '1.0.0',
      source_repo: 'https://example.invalid/repo',
      install_target: `.claude/skills/${over.id}`,
      review_required: false,
      tags: { roles: [], teams: [], stacks: [], componentTypes: [] },
      install_params: [],
      wiring_actions: [],
    },
  } as unknown as CatalogListEntry;
}

/** Mirrors the real shape: `documentation` is mid-frequency in descriptions
 * (df 7 of 230), while `stale` appears in none of them and in 9 bodies. */
const CATALOG: CatalogListEntry[] = [
  entry({ id: 'document-generator', kind: 'agent', description: 'Generates documentation as PDFs and slide decks' }),
  entry({ id: 'docs-lookup', description: 'Fetches library documentation on demand' }),
  entry({ id: 'doc-updater', kind: 'agent', description: 'Regenerates documentation codemaps after a change' }),
  // The genuine match for the motivating query. Its description says none of
  // the words a person would search with; its body says all of them.
  entry({ id: 'regression-testing', description: 'Testing strategies for AI-assisted development' }),
  entry({ id: 'friction-log', kind: 'doc', description: 'A weekly format for capturing what slowed an engagement down' }),
  entry({ id: 'architecture-decision-records', description: 'Capture why an architectural choice was made, and what was rejected' }),
];

/** Only `regression-testing` has a body, and only it contains the rare terms. */
const BODIES: Record<string, string> = {
  'regression-testing': [
    '# Regression testing for AI-assisted work',
    '',
    'Catch stale comments that no longer match the code they describe.',
    'Verify that claims in documentation are still true after a refactor.',
  ].join('\n'),
};

function port(): DeliveryOsReadPort {
  const snapshot = () => ({ entries: CATALOG, skipped: [] });
  return {
    listCatalog: () => snapshot(),
    refreshCatalog: async () => snapshot(),
    readArtifact: () => {
      throw new Error('not used by this eval');
    },
    readPayloadFile: () => ({ kind: 'not-found', message: 'not used by this eval' }),
    readSearchableText: ({ id }) => BODIES[id],
  };
}

async function search(query: string, limit = 5): Promise<string[]> {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer({ port: port(), version: '9.9.9' });
  const client = new Client({ name: 'eval', version: '1.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const res = await client.callTool({
    name: 'search_artifacts',
    arguments: { cwd: 'C:/proj', query, limit },
  });
  const text = (res.content as { text: string }[])[0].text;
  await client.close();
  await server.close();
  const data = JSON.parse(text) as { results: { id: string }[] };
  return data.results.map((r) => r.id);
}

describe('search ranking', () => {
  // ---------------------------------------------------------------- REGRESSION
  // These two pass today and MUST keep passing. They are the counterweight:
  // the real danger of indexing bodies is that it floods results and buries
  // precise description matches. Without these, raising the body weight until
  // the case below goes green would look like success.

  it('still ranks a precise description match first (regression guard)', async () => {
    const ids = await search('track what slowed the team down each week');
    expect(ids.slice(0, 3)).toContain('friction-log');
  });

  it('still ranks a second precise description match first (regression guard)', async () => {
    const ids = await search('record why we chose this architecture');
    expect(ids.slice(0, 3)).toContain('architecture-decision-records');
  });

  // ------------------------------------------------------------------ THE FIX
  // The property being bought, stated at its narrowest: an artifact whose only
  // match is in its body becomes FINDABLE AT ALL. Not "ranks first" -- see the
  // ceiling below for why that is a different and unreachable claim.

  it('finds an artifact whose only match is in its body', async () => {
    const ids = await search('catch stale comments that no longer match the code');
    expect(
      ids,
      'regression-testing says "stale comments" only in its body; nothing else in '
      + 'the fixture says it anywhere',
    ).toContain('regression-testing');
  });

  it('does not invent matches for a term that appears nowhere at all', async () => {
    // Anti-vacuity. Without this, a body scorer that returned every artifact
    // would satisfy the test above and be useless.
    const ids = await search('kubernetes helm chart rollout');
    expect(ids).not.toContain('regression-testing');
  });
});

/**
 * THE CEILING -- recorded, deliberately not asserted.
 *
 * The query that REVEALED this defect is not the query that validates the fix,
 * and conflating those is how a constant creeps upward until a row goes green.
 *
 * For "verify claims in documentation are still true, catch stale comments",
 * `regression-testing` ranked 5th against the live catalog, below three
 * documentation-WRITING tools. Body indexing does not fix that, and should not:
 * those three match `documentation` in their descriptions legitimately, and
 * presence-only cannot outrank a real metadata match without breaking the two
 * regression guards above.
 *
 * Why IDF does not rescue it either, since that is the obvious next idea:
 * `documentation` is df 7 of 230 in metadata (RARE -- so IDF would boost the
 * wrong results), and df 17 of 99 in bodies against `stale` at df 9, a
 * separation of only 1.36x. Both measured. Do not retry it.
 *
 * The honest limit: this matches "stale" to a document containing "stale". A
 * query phrased entirely in synonyms the catalog never uses will still miss.
 * That is the ceiling of lexical matching, and calling this semantic search
 * would be wrong.
 */
