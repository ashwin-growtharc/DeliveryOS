import { describe, it, expect } from 'vitest';
import { guessDescriptionFromFrontmatter } from '../../src/engine/manifest/frontmatter';

describe('guessDescriptionFromFrontmatter', () => {
  it('extracts a plain inline description', () => {
    const content = `---\nname: my-agent\ndescription: Does a thing well.\ncolor: blue\n---\n\n# Body\n`;
    expect(guessDescriptionFromFrontmatter(content)).toBe('Does a thing well.');
  });

  it('strips surrounding double or single quotes from an inline value', () => {
    expect(
      guessDescriptionFromFrontmatter('---\ndescription: "Quoted description."\n---\n'),
    ).toBe('Quoted description.');
    expect(
      guessDescriptionFromFrontmatter("---\ndescription: 'Single quoted.'\n---\n"),
    ).toBe('Single quoted.');
  });

  it('extracts a multi-line block-scalar (>-) description, joined with spaces', () => {
    const content = [
      '---',
      'name: blueprint',
      'description: >-',
      '  Turn a one-line objective into a step-by-step plan.',
      '  Includes an adversarial review gate.',
      '---',
      '',
      '# Body',
    ].join('\n');
    expect(guessDescriptionFromFrontmatter(content)).toBe(
      'Turn a one-line objective into a step-by-step plan. Includes an adversarial review gate.',
    );
  });

  it('handles a real-world description containing an unquoted colon without crashing', () => {
    // The exact class of input that breaks strict YAML parsing of the whole
    // frontmatter block (zk-steward's real description, from the
    // growtharc-ai-helpers import) -- this parser must still find it, since
    // it never attempts a full-document YAML parse.
    const content = [
      '---',
      'name: ZK Steward',
      "description: Knowledge-base steward. Default perspective: Luhmann; switches by task.",
      'color: teal',
      '---',
    ].join('\n');
    expect(guessDescriptionFromFrontmatter(content)).toBe(
      'Knowledge-base steward. Default perspective: Luhmann; switches by task.',
    );
  });

  it('returns undefined when there is no frontmatter block at all', () => {
    expect(guessDescriptionFromFrontmatter('# Just a heading\n\nSome body text.\n')).toBeUndefined();
  });

  it('returns undefined when frontmatter exists but has no description field', () => {
    expect(
      guessDescriptionFromFrontmatter('---\nname: my-agent\ncolor: blue\n---\n'),
    ).toBeUndefined();
  });
});
