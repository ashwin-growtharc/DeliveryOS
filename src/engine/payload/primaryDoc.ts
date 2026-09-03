import * as fs from 'fs';
import * as path from 'path';
import { resolvePayloadDir } from './payloadDir';
import { CatalogEntry } from '../catalog/catalog';

/**
 * The file a person (or an agent) should read first to understand what an
 * artifact actually is.
 *
 * This exists because `resolvePayloadDir` deliberately returns two different
 * KINDS of path, and every caller so far has had to know which it got. The
 * `payload_path` escape hatch "may name a single file or a directory"
 * (schema.ts:150-158), and in the real catalog both cases are common: most
 * `payload_path` artifacts point straight at one `.md` file, while the
 * payload-directory skills carry a `SKILL.md` inside a directory. A caller
 * that assumes "directory" reads nothing for the first group; one that
 * assumes "file" throws EISDIR on the second.
 *
 * Resolving that fork ONCE, here in the core, is what lets a driving adapter
 * (the MCP server, the CLI, the app) ask a single question -- "what does this
 * artifact say about itself?" -- without reimplementing payload layout rules.
 */

/** Read in preference order. `SKILL.md` first because it is the convention the
 * agent-asset artifacts actually use; `README.md` last because a payload that
 * has both means the README is the packaging note and the other file is the
 * content. */
const DOC_CANDIDATES = [
  'SKILL.md',
  'AGENT.md',
  'AGENTS.md',
  'RULE.md',
  'COMMAND.md',
  'index.md',
  'README.md',
];

/** Generous enough that no real artifact doc is cut (the largest in the live
 * catalog is well under this), small enough that one malformed payload cannot
 * push a multi-megabyte file through a JSON-RPC response. */
export const DEFAULT_MAX_DOC_BYTES = 64 * 1024;

export interface PrimaryDoc {
  /** Path relative to the payload root, POSIX-separated. `'.'` when the
   * payload IS a single file, so a caller can tell the two shapes apart
   * without re-statting anything. */
  relPath: string;
  content: string;
  /** True when the file was longer than `maxBytes` and `content` is a prefix.
   * Reported rather than hidden: an agent that silently gets 64KB of a 200KB
   * document will confidently answer from the half it saw. */
  truncated: boolean;
}

/** Reads at most `maxBytes` without pulling the whole file into memory first.
 * Returns null for anything that is not decodable text -- a NUL byte in the
 * prefix is the cheap, reliable binary tell, and shipping binary through a
 * JSON string produces replacement characters rather than an error. */
function readTextPrefix(filePath: string, maxBytes: number): { content: string; truncated: boolean } | null {
  const size = fs.statSync(filePath).size;
  const readLength = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(readLength);

  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, readLength, 0);
  } finally {
    fs.closeSync(fd);
  }

  if (buffer.includes(0)) return null;
  return { content: buffer.toString('utf-8'), truncated: size > readLength };
}

/**
 * Resolves and reads an artifact's primary document, or null when it has none
 * (a payload of pure code, an empty payload, a binary file).
 *
 * Never throws for the ordinary "no doc here" cases -- an agent asking about
 * 230 artifacts should not have to try/catch each one -- but a payload that
 * cannot be resolved at all (unknown id, `payload_path` escaping its remote)
 * still throws, because that is a real misconfiguration rather than an
 * absence.
 */
export function resolvePrimaryDoc(
  remoteName: string,
  id: string,
  options: { maxBytes?: number; catalog?: CatalogEntry[] } = {},
): PrimaryDoc | null {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_DOC_BYTES;
  const payloadDir = resolvePayloadDir(remoteName, id, options.catalog);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(payloadDir);
  } catch {
    // The manifest names a payload that is not on disk. That happens
    // routinely against a stale cache and is not this function's to report.
    return null;
  }

  if (stat.isFile()) {
    const read = readTextPrefix(payloadDir, maxBytes);
    return read ? { relPath: '.', content: read.content, truncated: read.truncated } : null;
  }

  if (!stat.isDirectory()) return null;

  let names: string[];
  try {
    names = fs.readdirSync(payloadDir);
  } catch {
    return null;
  }

  // Case-insensitively, because the catalog is authored on Windows and macOS
  // both and `Skill.md` is the same file to one of them and not the other.
  const byLowerName = new Map<string, string>();
  for (const name of names) byLowerName.set(name.toLowerCase(), name);

  const candidates = DOC_CANDIDATES.map((c) => byLowerName.get(c.toLowerCase())).filter(
    (n): n is string => n !== undefined,
  );

  // Falling back to a lone markdown file is what makes this work for the
  // artifacts that name their doc after themselves (`my-skill.md`) rather
  // than by convention. Only when there is exactly one -- picking arbitrarily
  // from several would be a guess presented as an answer.
  if (candidates.length === 0) {
    const markdown = names.filter((n) => n.toLowerCase().endsWith('.md'));
    if (markdown.length === 1) candidates.push(markdown[0]);
  }

  for (const name of candidates) {
    const filePath = path.join(payloadDir, name);
    try {
      if (!fs.statSync(filePath).isFile()) continue;
      const read = readTextPrefix(filePath, maxBytes);
      if (read) return { relPath: name, content: read.content, truncated: read.truncated };
    } catch {
      continue;
    }
  }

  return null;
}
