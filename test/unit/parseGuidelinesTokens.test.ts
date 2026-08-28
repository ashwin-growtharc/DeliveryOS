import { describe, it, expect } from 'vitest';
import {
  extractSection,
  parseMarkdownTable,
  parseColorTokens,
  parseTypeScale,
  parseUsageRules,
  parseLayoutRules,
} from '../../src/engine/guidelines/parseGuidelinesTokens';

// Mirrors the real design-kit GUIDELINES.md's own authoring convention:
// several small tables plus comma-separated inline-code shorthand under
// "## Color tokens", and a single table under "## Type scale" -- the exact
// mixed shape parseColorTokens/parseTypeScale have to tolerate.
const SAMPLE_GUIDELINES = `# Design-kit guidelines

Some intro prose.

## Color tokens

**Warm surfaces**
| Token | Hex | Usage |
|---|---|---|
| \`surface\` | \`#FFFCF2\` | Page background |
| \`surface-tertiary\` | \`#F6F1E9\` | Inset panels |

**Status colors**
| Variant | Background | Text |
|---|---|---|
| Success | \`#DCF8E6\` | \`#236D40\` |
| Danger | \`#FFE5E0\` | \`#A2341F\` |

**Sage green** (positive/active accents): \`sage-50 #F4F9EC\`,
\`sage-100 #EAF4DB\`.

## Type scale

| Element | Font | Size | Weight |
|---|---|---|---|
| Headings | EB Garamond | 18-24px | 400 |
| Body | IBM Plex Sans | 13-14px | 400 |

## Spacing & radius scale

Not documented anywhere before this -- recovered from the app shell's own
real values, given a name here so future components have a real scale to
reach for instead of ad-hoc px values per component:

| Token | Value | Usage |
|---|---|---|
| \`radius-md\` | \`.5rem\` (8px) | Buttons, inputs, nav items -- the default |
| \`radius-lg\` | \`1rem\` (16px) | Cards, larger containers |

Spacing: use multiples of 4px (4/8/12/16/20/24/32). Component internal
padding sits at 8-12px.

## Layout grid

No fixed column-grid system in this kit -- components sit in a normal
flex/block layout, not a 12-column grid.

## Per-component usage rules

- **Button**: one primary (\`default\`) per view -- never two competing for
  attention. \`destructive\` is for the one action that actually deletes
  something.
- **Card**: \`title\` uses EB Garamond automatically -- never override its
  font inline.

## Anti-patterns

Some other section that should never leak into either parser above.
`;

describe('extractSection', () => {
  it('slices the text between a heading and the next ## heading', () => {
    const section = extractSection(SAMPLE_GUIDELINES, 'Color tokens');
    expect(section).toContain('surface-tertiary');
    expect(section).toContain('Sage green');
    expect(section).not.toContain('Type scale');
    expect(section).not.toContain('Anti-patterns');
  });

  it('returns the rest of the document when the heading is the last section', () => {
    const section = extractSection(SAMPLE_GUIDELINES, 'Anti-patterns');
    expect(section).toContain('Some other section');
  });

  it('returns an empty string when the heading does not exist', () => {
    expect(extractSection(SAMPLE_GUIDELINES, 'Motion')).toBe('');
  });
});

describe('parseMarkdownTable', () => {
  it('finds every table in a section, not just the first', () => {
    const section = extractSection(SAMPLE_GUIDELINES, 'Color tokens');
    const tables = parseMarkdownTable(section);
    expect(tables).toHaveLength(2);
    expect(tables[0].headers).toEqual(['Token', 'Hex', 'Usage']);
    expect(tables[1].headers).toEqual(['Variant', 'Background', 'Text']);
  });
});

describe('parseColorTokens', () => {
  it('extracts real hex values from ordinary two/three-column tables', () => {
    const tokens = parseColorTokens(SAMPLE_GUIDELINES);
    expect(tokens).toEqual(
      expect.arrayContaining([
        { token: 'surface', hex: '#FFFCF2' },
        { token: 'surface-tertiary', hex: '#F6F1E9' },
      ]),
    );
  });

  it('extracts BOTH hexes from a row with two color columns (e.g. background and text)', () => {
    const tokens = parseColorTokens(SAMPLE_GUIDELINES);
    expect(tokens).toEqual(
      expect.arrayContaining([
        { token: 'Success', hex: '#DCF8E6' },
        { token: 'Success', hex: '#236D40' },
        { token: 'Danger', hex: '#FFE5E0' },
        { token: 'Danger', hex: '#A2341F' },
      ]),
    );
  });

  it('extracts prose shorthand pairs like `sage-50 #F4F9EC`, not just table rows', () => {
    const tokens = parseColorTokens(SAMPLE_GUIDELINES);
    expect(tokens).toEqual(
      expect.arrayContaining([
        { token: 'sage-50', hex: '#F4F9EC' },
        { token: 'sage-100', hex: '#EAF4DB' },
      ]),
    );
  });

  it('deduplicates identical (token, hex) pairs', () => {
    const withDuplicate = `## Color tokens\n\n| Token | Hex |\n|---|---|\n| \`surface\` | \`#FFFCF2\` |\n| \`surface\` | \`#FFFCF2\` |\n`;
    expect(parseColorTokens(withDuplicate)).toEqual([{ token: 'surface', hex: '#FFFCF2' }]);
  });

  it('returns [] when there is no Color tokens section at all, never throws', () => {
    expect(parseColorTokens('# Just a title\n\nSome unrelated prose.\n')).toEqual([]);
  });

  it('returns [] for a Color tokens section with no tables or shorthand pairs', () => {
    expect(parseColorTokens('## Color tokens\n\nJust plain prose, no hex codes at all.\n')).toEqual([]);
  });
});

describe('parseTypeScale', () => {
  it('maps each row to the table\'s own real headers', () => {
    expect(parseTypeScale(SAMPLE_GUIDELINES)).toEqual([
      { Element: 'Headings', Font: 'EB Garamond', Size: '18-24px', Weight: '400' },
      { Element: 'Body', Font: 'IBM Plex Sans', Size: '13-14px', Weight: '400' },
    ]);
  });

  it('returns [] when there is no Type scale section at all, never throws', () => {
    expect(parseTypeScale('# Just a title\n\nSome unrelated prose.\n')).toEqual([]);
  });

  it('returns [] when the Type scale section has no table', () => {
    expect(parseTypeScale('## Type scale\n\nJust plain prose, no table at all.\n')).toEqual([]);
  });
});

describe('parseUsageRules', () => {
  it('keys each multi-line bullet by its bold component name, lowercased', () => {
    const rules = parseUsageRules(SAMPLE_GUIDELINES);
    expect(Object.keys(rules).sort()).toEqual(['button', 'card']);
  });

  it('joins a wrapped, multi-line bullet into one flowing sentence', () => {
    const rules = parseUsageRules(SAMPLE_GUIDELINES);
    expect(rules.button).toBe(
      "one primary (`default`) per view -- never two competing for attention. `destructive` is for the one action that actually deletes something.",
    );
  });

  it('matches component.name case-insensitively (e.g. "Button" vs "button")', () => {
    const rules = parseUsageRules(SAMPLE_GUIDELINES);
    const componentName = 'Button';
    expect(rules[componentName.toLowerCase()]).toBeDefined();
  });

  it('returns {} when there is no Per-component usage rules section at all, never throws', () => {
    expect(parseUsageRules('# Just a title\n\nSome unrelated prose.\n')).toEqual({});
  });

  it('has no entry for a component that was never documented -- graceful degrade, not a throw', () => {
    const rules = parseUsageRules(SAMPLE_GUIDELINES);
    expect(rules.skeleton).toBeUndefined();
  });
});

describe('parseLayoutRules', () => {
  it('extracts the real radius-token table, keyed by token/value/usage', () => {
    const { radiusTokens } = parseLayoutRules(SAMPLE_GUIDELINES);
    expect(radiusTokens).toEqual([
      { token: 'radius-md', value: '.5rem (8px)', usage: 'Buttons, inputs, nav items -- the default' },
      { token: 'radius-lg', value: '1rem (16px)', usage: 'Cards, larger containers' },
    ]);
  });

  it('extracts Layout grid\'s prose as layoutNote', () => {
    const { layoutNote } = parseLayoutRules(SAMPLE_GUIDELINES);
    expect(layoutNote).toContain('No fixed column-grid system');
  });

  it('extracts the trailing spacing-multiples sentence as spacingNote, not the leading recovered-from sentence', () => {
    const { spacingNote } = parseLayoutRules(SAMPLE_GUIDELINES);
    expect(spacingNote).toContain('use multiples of 4px');
    expect(spacingNote).not.toContain('recovered from');
  });

  it('returns empty notes and [] radiusTokens when neither section exists, never throws', () => {
    expect(parseLayoutRules('# Just a title\n\nSome unrelated prose.\n')).toEqual({
      layoutNote: '',
      spacingNote: '',
      radiusTokens: [],
    });
  });
});
