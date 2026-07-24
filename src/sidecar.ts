#!/usr/bin/env node
/**
 * Sidecar entry point for the Phase 3 Node SEA / (eventual) Tauri-sidecar
 * spike. This is a SEPARATE process entry point from `src/index.ts` -- it
 * is never wired into `src/cli/program.ts`, and it must never call
 * `console.log`/`console.error` directly the way the CLI commands do,
 * because stdout here is a line-delimited JSON protocol that a host
 * process (eventually the Tauri shell) parses one line at a time. Any
 * stray non-JSON line would corrupt that stream.
 *
 * Protocol: the host writes one JSON object per line to stdin:
 *   { "id": string, "command": string, "args"?: object }
 * and this process writes exactly one JSON object per line to stdout in
 * response:
 *   { "id": string, "ok": true, "result": <value> }
 *   { "id": string, "ok": false, "error": { "type": string, "message": string } }
 *
 * The process keeps reading/responding to further lines until stdin
 * closes (EOF), at which point it exits cleanly.
 */
import * as readline from 'readline';
import { buildCatalog } from './engine/catalog/catalog';

interface SidecarRequest {
  id: string;
  command: string;
  args?: Record<string, unknown>;
}

interface SidecarSuccessResponse {
  id: string | null;
  ok: true;
  result: unknown;
}

interface SidecarErrorResponse {
  id: string | null;
  ok: false;
  error: { type: string; message: string };
}

type SidecarResponse = SidecarSuccessResponse | SidecarErrorResponse;

type CommandHandler = (args: Record<string, unknown>) => unknown;

/**
 * Command map. For this spike, only `catalog.list` is a real command --
 * everything else falls through to the "unknown command" error path
 * below rather than being special-cased.
 */
const commands: Record<string, CommandHandler> = {
  'catalog.list': (args) => {
    const entries = buildCatalog();
    const remote = args.remote;
    if (typeof remote === 'string' && remote.length > 0) {
      return entries.filter((entry) => entry.remoteName === remote);
    }
    return entries;
  },
};

/**
 * Writes a single response line. Uses plain `JSON.stringify` with no
 * pretty-printing arguments -- this is load-bearing: it guarantees the
 * entire response (including any embedded `\n` inside a string field,
 * e.g. a multi-line artifact description) is escaped onto one physical
 * line, so the host's line-based reader never sees a response split
 * across multiple lines.
 */
function writeResponse(response: SidecarResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

function errorInfo(err: unknown): { type: string; message: string } {
  if (err instanceof Error) {
    return { type: err.name, message: err.message };
  }
  return { type: 'Error', message: String(err) };
}

function handleLine(line: string): void {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return;
  }

  let request: SidecarRequest;
  try {
    request = JSON.parse(trimmed) as SidecarRequest;
  } catch (err) {
    // No `id` could be recovered from unparseable input, so respond with
    // id: null rather than crashing the process or dropping the line
    // silently.
    writeResponse({ id: null, ok: false, error: errorInfo(err) });
    return;
  }

  const { id, command, args } = request;

  try {
    const handler = commands[command];
    if (!handler) {
      throw new Error(`Unknown command "${String(command)}"`);
    }
    const result = handler(args ?? {});
    writeResponse({ id, ok: true, result });
  } catch (err) {
    writeResponse({ id, ok: false, error: errorInfo(err) });
  }
}

function main(): void {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', handleLine);
  rl.on('close', () => {
    process.exit(0);
  });
}

main();
