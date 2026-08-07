import * as fs from 'fs';
import * as path from 'path';

const ENTRY_FILE_CANDIDATES = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'main.ts',
  'main.js',
];

function resolveEntryFile(payloadPath: string): string | undefined {
  const stat = fs.statSync(payloadPath);
  if (stat.isFile()) {
    return payloadPath;
  }
  for (const candidate of ENTRY_FILE_CANDIDATES) {
    const fullPath = path.join(payloadPath, candidate);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  // No real, conventional entry point found -- deliberately does not fall
  // back to "just pick some file," since a leading comment on an arbitrary
  // non-entry file says nothing reliable about the artifact as a whole.
  return undefined;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function stripBlockComment(text: string): string | undefined {
  const match = text.match(/^\s*\/\*\*?([\s\S]*?)\*\//);
  if (!match) {
    return undefined;
  }
  const lines = match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines.join(' ') : undefined;
}

function stripLineComments(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const commentLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 && commentLines.length === 0) {
      continue;
    }
    if (trimmed.startsWith('//')) {
      commentLines.push(trimmed.replace(/^\/\/\s?/, ''));
    } else {
      break;
    }
  }
  return commentLines.length > 0 ? commentLines.join(' ') : undefined;
}

/**
 * Phase 10 item 3 (extended): a real, minimal description guess for kinds
 * that have neither a docgen-parsed component (`ui-component`) nor a
 * frontmatter block (the four markdown kinds) to draw from -- reads only
 * a real, conventional entry file (`index.*`/`main.*` at the payload's own
 * root, or the payload itself if it's a single file) and returns a leading
 * JSDoc-style block comment or `//` comment block's literal text, exactly
 * as written, if one sits directly above the first real code. Returns
 * `undefined` for
 * everything else (no conventional entry file found, or the entry file has
 * no leading comment) -- never invents a description from code it can't
 * attribute to something the author actually wrote.
 */
export function extractLeadingComment(payloadPath: string): string | undefined {
  const entryFile = resolveEntryFile(payloadPath);
  if (!entryFile) {
    return undefined;
  }

  let content: string;
  try {
    content = stripBom(fs.readFileSync(entryFile, 'utf-8'));
  } catch {
    return undefined;
  }

  return stripBlockComment(content) ?? stripLineComments(content);
}
