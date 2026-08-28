/**
 * Best-effort, regex-based extraction of a design-kit's `GUIDELINES.md`
 * color tokens and type scale for Detail's live rendering -- NOT a real
 * markdown parser (none exists in this repo; the established convention
 * here is source-text regexes over adding a parser dependency, matching
 * e.g. `listVariantNames`). Known limitation: this assumes `GUIDELINES.md`
 * keeps roughly the shape the design-kit's own authoring convention
 * already uses (a `## Color tokens` section mixing small markdown tables
 * with comma-separated inline-code shorthand, and a `## Type scale`
 * section that's a single markdown table) -- a `GUIDELINES.md` written in
 * a wildly different style will just yield fewer/no swatches, never throw.
 */

export interface ColorToken {
  token: string;
  hex: string;
}

export interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Slices the text between `## {heading}` and the next `## ` heading (or
 * EOF) -- returns `''` if the heading isn't present at all. */
export function extractSection(markdown: string, heading: string): string {
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'm');
  const match = headingPattern.exec(markdown);
  if (!match) return '';
  const rest = markdown.slice(match.index + match[0].length);
  const nextHeading = /^##\s+/m.exec(rest);
  return nextHeading ? rest.slice(0, nextHeading.index) : rest;
}

const SEPARATOR_ROW = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

function splitRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

/** Finds every markdown table within a section of text -- `## Color
 * tokens` has several small ones (Warm surfaces, Borders, Primary,
 * Status colors), not just one. */
export function parseMarkdownTable(sectionText: string): MarkdownTable[] {
  const lines = sectionText.split('\n');
  const tables: MarkdownTable[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const next = (lines[i + 1] ?? '').trim();
    if (line.startsWith('|') && SEPARATOR_ROW.test(next)) {
      const headers = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      tables.push({ headers, rows });
      continue;
    }
    i++;
  }
  return tables;
}

function stripMarkup(cell: string): string {
  return cell.replace(/[`*]/g, '').trim();
}

const HEX_GLOBAL_PATTERN = /#[0-9A-Fa-f]{3,8}\b/g;
const SHORTHAND_PATTERN = /`?([a-z][\w-]*)\s+(#[0-9A-Fa-f]{3,8})\b/g;

/**
 * Table rows: label = first cell, and every hex found ANYWHERE in that
 * row is a real swatch (e.g. the Status-colors table has two per row --
 * background and text -- both are real, not noise). Prose shorthand like
 * `` `sage-50 #F4F9EC` `` (Sage/Sand/AI-accent are written as
 * comma-separated lists, not tables) is picked up by a second pass over
 * the section's raw text.
 */
export function parseColorTokens(markdown: string): ColorToken[] {
  const section = extractSection(markdown, 'Color tokens');
  if (!section) return [];

  const results: ColorToken[] = [];
  const seen = new Set<string>();
  const addToken = (token: string, hex: string) => {
    const key = `${token}|${hex.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ token, hex });
  };

  for (const table of parseMarkdownTable(section)) {
    for (const row of table.rows) {
      const label = stripMarkup(row[0] ?? '');
      if (!label) continue;
      for (const cell of row) {
        const hexMatches = cell.match(HEX_GLOBAL_PATTERN);
        if (hexMatches) hexMatches.forEach((hex) => addToken(label, hex));
      }
    }
  }

  let match: RegExpExecArray | null;
  while ((match = SHORTHAND_PATTERN.exec(section)) !== null) {
    addToken(match[1], match[2]);
  }

  return results;
}

/** The `## Type scale` section is always a single markdown table in this
 * kit's own authoring convention -- rows keyed by that table's own
 * headers, so a header rename doesn't require a matching code change. */
export function parseTypeScale(markdown: string): Record<string, string>[] {
  const section = extractSection(markdown, 'Type scale');
  if (!section) return [];
  const [table] = parseMarkdownTable(section);
  if (!table) return [];
  return table.rows.map((row) => {
    const record: Record<string, string> = {};
    table.headers.forEach((header, index) => {
      record[stripMarkup(header)] = stripMarkup(row[index] ?? '');
    });
    return record;
  });
}

const USAGE_BULLET_START = /^-\s+\*\*([^*]+)\*\*:\s*(.*)$/;

/**
 * `## Per-component usage rules` is a bulleted list, one multi-line bullet
 * per component (`- **Name**: rule text, wrapped across several indented
 * lines`) -- not a table, so this needs its own line-scanner rather than
 * `parseMarkdownTable`. Keyed by the bullet's own bold component name,
 * lowercased -- matches `component.name` from `listArtifactPayloadComponents`
 * case-insensitively (the same real join key confirmed against this kit's
 * own `components/` folder names, not docgen's adapter-specific
 * `displayName`). A component with no matching bullet simply has no entry
 * -- the caller renders no caption for it, the same graceful-degrade this
 * feature already uses everywhere else.
 */
export function parseUsageRules(markdown: string): Record<string, string> {
  const section = extractSection(markdown, 'Per-component usage rules');
  if (!section) return {};

  const rules: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentKey) {
      rules[currentKey] = currentLines.join(' ').replace(/\s+/g, ' ').trim();
    }
    currentKey = null;
    currentLines = [];
  };

  for (const rawLine of section.split('\n')) {
    const bulletStart = USAGE_BULLET_START.exec(rawLine);
    if (bulletStart) {
      flush();
      currentKey = bulletStart[1].trim().toLowerCase();
      currentLines = [bulletStart[2].trim()];
      continue;
    }
    const trimmed = rawLine.trim();
    if (currentKey && trimmed.length > 0) {
      currentLines.push(trimmed);
    }
  }
  flush();

  return rules;
}

export interface RadiusToken {
  token: string;
  value: string;
  usage: string;
}

export interface LayoutRules {
  layoutNote: string;
  spacingNote: string;
  radiusTokens: RadiusToken[];
}

/** Collapses whatever non-table prose sits in a section into a single
 * flowing note -- joins non-empty, non-table-row lines with a space. */
function collapseProse(sectionText: string): string {
  return sectionText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('|'))
    .join(' ')
    .trim();
}

/**
 * Combines `## Layout grid` (pure prose in this kit's real content, no
 * table) and `## Spacing & radius scale` (an intro sentence, a real
 * radius-token table, then a trailing spacing-multiples sentence) into
 * one small summary. `spacingNote` is deliberately the LAST prose block in
 * that section (the actionable "use multiples of 4px..." sentence), not
 * the section's own meta-commentary intro about where the values were
 * recovered from -- that context belongs in the doc itself, not a UI
 * summary strip.
 */
export function parseLayoutRules(markdown: string): LayoutRules {
  const layoutSection = extractSection(markdown, 'Layout grid');
  const spacingSection = extractSection(markdown, 'Spacing & radius scale');

  const [radiusTable] = parseMarkdownTable(spacingSection);
  const radiusTokens: RadiusToken[] = radiusTable
    ? radiusTable.rows.map((row) => ({
        token: stripMarkup(row[0] ?? ''),
        value: stripMarkup(row[1] ?? ''),
        usage: stripMarkup(row[2] ?? ''),
      }))
    : [];

  const proseBlocks = spacingSection
    .split(/\n\s*\n/)
    .map((block) => collapseProse(block))
    .filter((block) => block.length > 0);

  return {
    layoutNote: collapseProse(layoutSection),
    spacingNote: proseBlocks.length > 0 ? proseBlocks[proseBlocks.length - 1] : '',
    radiusTokens,
  };
}
