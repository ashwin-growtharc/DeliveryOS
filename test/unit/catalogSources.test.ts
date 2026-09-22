import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { ManifestSchema } from '../../src/engine/manifest/schema';

/**
 * Guards the artifacts authored in `catalog-sources/` before anyone proposes
 * them to a real catalog.
 *
 * WHAT THIS CAN AND CANNOT CHECK
 *
 * The interviewer's actual behaviour depends on a model following prose, and
 * no test asserts that. What a test CAN assert is the contract underneath it:
 * a manifest that a catalog would accept, and an `interview:` block an agent
 * can actually read. Both are mechanical, and both are the kind of thing that
 * breaks silently -- a manifest with one bad field is not rejected loudly, it
 * makes `discoverManifests` skip the artifact, and a template whose frontmatter
 * does not parse simply produces an interview with no questions in it.
 *
 * The 210-artifact import is the precedent: it needed two whole-catalog
 * corrections afterwards, one of them for 134 files. Catching a malformed
 * artifact here costs nothing; catching it after it is in a shared catalog
 * costs a remediation pull request.
 */

const SOURCES = path.resolve(__dirname, '..', '..', 'catalog-sources');

function sourceIds(): string[] {
  return fs
    .readdirSync(SOURCES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** The frontmatter shape a template declares. Deliberately loose: the engine
 * never reads this, an agent does, so the test asserts only what the method
 * file promises to find. */
interface InterviewFrontmatter {
  document?: string;
  output?: string;
  interview?: Array<{ ask?: unknown; options?: unknown }>;
}

function readFrontmatter(file: string): InterviewFrontmatter | undefined {
  const match = fs.readFileSync(file, 'utf-8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? (parseYaml(match[1]) as InterviewFrontmatter) : undefined;
}

describe('artifacts authored in catalog-sources', () => {
  it('has at least one, so this file cannot pass by testing nothing', () => {
    // The anti-vacuity guard. A glob-driven suite over an empty directory is
    // green and meaningless, and this one would silently become that the moment
    // the directory moved or was renamed.
    expect(sourceIds().length).toBeGreaterThan(0);
  });

  for (const id of sourceIds()) {
    describe(id, () => {
      const dir = path.join(SOURCES, id);

      it('has a manifest a catalog would accept', () => {
        const raw = fs.readFileSync(path.join(dir, 'manifest.yaml'), 'utf-8');
        const parsed = ManifestSchema.safeParse(parseYaml(raw));
        // Report the real issues rather than a bare "expected true" -- a
        // schema failure names the field, and that is the whole value.
        const problems = parsed.success
          ? []
          : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
        expect(problems).toEqual([]);
      });

      it('has an id matching its directory, which the catalog requires', () => {
        // `discoverManifests` skips any artifact whose manifest id differs from
        // its folder name -- silently, as a skipped entry rather than an error.
        const manifest = parseYaml(fs.readFileSync(path.join(dir, 'manifest.yaml'), 'utf-8'));
        expect((manifest as { id: string }).id).toBe(id);
      });

      it('ships a payload with something in it', () => {
        const payload = path.join(dir, 'payload');
        expect(fs.existsSync(payload), `${id} has no payload/`).toBe(true);
        expect(fs.readdirSync(payload).length).toBeGreaterThan(0);
      });
    });
  }
});

describe('templates that declare an interview', () => {
  /** Every markdown file under any source payload that carries an `interview:`
   * block. Found by reading, not by a hardcoded list, so a template added later
   * is covered without touching this file. */
  function templatesWithInterviews(): Array<{ id: string; file: string; fm: InterviewFrontmatter }> {
    const found: Array<{ id: string; file: string; fm: InterviewFrontmatter }> = [];
    for (const id of sourceIds()) {
      const payload = path.join(SOURCES, id, 'payload');
      if (!fs.existsSync(payload)) continue;
      for (const name of fs.readdirSync(payload)) {
        if (!name.endsWith('.md')) continue;
        const file = path.join(payload, name);
        const fm = readFrontmatter(file);
        if (fm?.interview) found.push({ id, file, fm });
      }
    }
    return found;
  }

  it('finds at least one, or this whole block is decorative', () => {
    expect(templatesWithInterviews().length).toBeGreaterThan(0);
  });

  for (const { id, file, fm } of templatesWithInterviews()) {
    describe(`${id} / ${path.basename(file)}`, () => {
      it('declares where the finished document goes', () => {
        // Without this the method has to invent a filename, and the rule that
        // matters most -- write to the project, never into the artifact's own
        // folder -- has nothing concrete to point at.
        expect(typeof fm.output).toBe('string');
        expect((fm.output ?? '').length).toBeGreaterThan(0);
      });

      it('writes its output OUTSIDE the artifact folder', () => {
        // The confidentiality rule, made mechanical. A finished document
        // written into the installed artifact reads as a local edit, and
        // contributing an artifact publishes it to a shared catalog -- with a
        // real client's details in it.
        const output = fm.output ?? '';
        expect(output.startsWith('/'), 'must be relative to the project').toBe(false);
        expect(output.includes('..'), 'must not climb out of the project').toBe(false);
        expect(output.startsWith(id), 'must not be written into its own install target').toBe(false);
      });

      it('asks real questions', () => {
        const questions = fm.interview ?? [];
        expect(questions.length).toBeGreaterThan(0);
        for (const q of questions) {
          expect(typeof q.ask, JSON.stringify(q)).toBe('string');
          expect(String(q.ask).trim().length).toBeGreaterThan(0);
        }
      });

      it('gives every option list at least two choices', () => {
        // A single-option list is not a choice, it is a leading question -- and
        // the method file tells the agent to offer options as a prompt rather
        // than a menu, which only makes sense with more than one.
        for (const q of fm.interview ?? []) {
          if (q.options === undefined) continue;
          expect(Array.isArray(q.options), String(q.ask)).toBe(true);
          expect((q.options as unknown[]).length, String(q.ask)).toBeGreaterThan(1);
        }
      });
    });
  }
});
