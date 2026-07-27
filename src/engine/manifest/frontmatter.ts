/**
 * Best-effort extraction of a `description:` field from a loose YAML
 * frontmatter block (`---\n...\n---` at the top of a file) -- used by
 * `deliveryos scan` to pre-fill a guessed description for a discovered
 * `.claude/agents/<id>.md` or `.claude/skills/<id>/SKILL.md` file.
 *
 * Deliberately NOT a full YAML parse: real agent/skill files in the wild
 * routinely have a free-text `description:` containing an unquoted colon
 * (e.g. "Default perspective: Luhmann"), which breaks strict YAML parsing
 * of the whole frontmatter block even though the file is otherwise a
 * perfectly normal, intentional format. This scans line-by-line for just
 * the `description:` key, handling both the inline (`description: text`)
 * and block-scalar (`description: >-` / `description: |-` followed by
 * indented continuation lines) forms -- the two forms actually seen across
 * the source agent/skill files this was built against. Returns undefined
 * if there's no frontmatter block or no `description:` key at all (the
 * caller/UI must then ask the user to fill it in -- this is a guess, not a
 * guarantee).
 */
export function guessDescriptionFromFrontmatter(content: string): string | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return undefined;
  }

  const lines = match[1].split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.startsWith('description:'));
  if (startIndex === -1) {
    return undefined;
  }

  const first = lines[startIndex];
  const inlineValue = first.slice('description:'.length).trim();
  if (inlineValue.length > 0 && !/^[>|][-+]?$/.test(inlineValue)) {
    return inlineValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }

  // Block scalar (`>-`/`|-`/`>`/`|`): every following line indented more
  // than the key itself is part of the value, joined with spaces (folded
  // style -- good enough for a one-line guessed description preview).
  const blockLines: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (/^\s+\S/.test(lines[i])) {
      blockLines.push(lines[i].trim());
    } else {
      break;
    }
  }
  return blockLines.length > 0 ? blockLines.join(' ') : undefined;
}
