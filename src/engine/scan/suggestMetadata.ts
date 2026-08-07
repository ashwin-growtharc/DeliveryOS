import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { SuggestionError } from '../errors';

const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|prisma|md)$/;
const MAX_SOURCE_CHARS = 8000;

// A real, verified-empirically list of every built-in tool name visible in
// a `claude -p` session (obtained by directly asking a real invocation to
// list them), used as a best-effort `--disallowedTools` denylist.
//
// **Not a hard sandbox -- confirmed by direct testing, not assumed.**
// `--allowedTools ''` does nothing at all (a real test asking a session
// with it set to run `echo` via Bash still ran it). `--disallowedTools`
// naming tools explicitly blocked Bash on two of three real attempts, but
// on one attempt (this same list) it still ran Bash anyway. This is
// accepted as a real, known limitation, not silently assumed to work:
// DeliveryOS's own engine already runs arbitrary trusted shell commands on
// this same machine under the same user (`verifyBuild.ts`, real `git`
// pushes), so a suggestion call occasionally retaining more tool access
// than intended isn't a new class of risk here, just an imperfect one --
// stated plainly rather than presented as an enforced boundary it isn't.
const DISALLOWED_TOOLS = [
  'Agent', 'Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit',
  'Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch', 'Artifact',
  'AskUserQuestion', 'ReportFindings', 'ScheduleWakeup',
  'ShareOnboardingGuide', 'Skill', 'ToolSearch', 'TaskCreate',
  'TaskUpdate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop',
  'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree', 'ExitWorktree',
  'Monitor', 'PushNotification', 'RemoteTrigger', 'SendMessage',
  'CronCreate', 'CronDelete', 'CronList', 'DesignSync',
].join(',');

export interface SuggestedMetadata {
  description?: string;
  componentTypes?: string[];
}

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listSourceFiles(fullPath));
    } else if (SOURCE_FILE_PATTERN.test(entry.name)) {
      found.push(fullPath);
    }
  }
  return found;
}

/** Reads a payload's real source, concatenated file-by-file up to
 * `MAX_SOURCE_CHARS` total -- capped so a large payload doesn't blow up
 * the prompt, not because any individual file is untrusted. */
function readPayloadSource(payloadPath: string): string {
  const stat = fs.statSync(payloadPath);
  const files = stat.isFile() ? [payloadPath] : listSourceFiles(payloadPath);

  let combined = '';
  for (const file of files) {
    if (combined.length >= MAX_SOURCE_CHARS) {
      break;
    }
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    combined += `\n--- ${path.basename(file)} ---\n${content}`;
  }
  return combined.slice(0, MAX_SOURCE_CHARS);
}

/**
 * Builds the prompt asking for a strict-JSON suggestion. Exported (not
 * just used internally) so it's directly unit-testable without spawning a
 * real subprocess.
 */
export function buildSuggestionPrompt(source: string, kind: string): string {
  return [
    `You are looking at the real source code of a "${kind}" artifact being`,
    'proposed for a shared catalog. Based only on what the code actually',
    'does, respond with STRICT JSON and nothing else (no markdown fence, no',
    'commentary) in exactly this shape:',
    '{"description": "one sentence describing what this does", "componentTypes": ["short-lowercase-tag", ...]}',
    '',
    'componentTypes should be short, lowercase, hyphenated tags describing',
    'what kind of thing this is (examples already in real use: "button",',
    '"form", "container", "effect", "animation", "text-effect"). Use 0-3',
    'tags. If you genuinely cannot tell what something is for, use an empty',
    'string for description or an empty array for componentTypes rather',
    'than guessing something not supported by the code.',
    '',
    '--- SOURCE ---',
    source,
  ].join('\n');
}

interface ClaudeJsonEnvelope {
  is_error?: boolean;
  result?: string;
}

/**
 * Parses `claude --output-format json`'s own envelope (real shape,
 * confirmed empirically: `{"type":"result","is_error":bool,"result":"<text>",...}`),
 * then parses the model's own `result` text as the requested JSON shape --
 * stripping a possible ```` ```json ```` fence first, since models don't
 * always honor "no markdown fence" perfectly. Never throws on a
 * malformed/partial shape; missing fields just come back `undefined`.
 * Exported for direct unit testing without a real subprocess call.
 */
export function parseSuggestionResponse(raw: string): SuggestedMetadata {
  let envelope: ClaudeJsonEnvelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new SuggestionError('claude did not return valid JSON output');
  }

  if (envelope.is_error) {
    throw new SuggestionError(`claude returned an error: ${envelope.result ?? 'unknown error'}`);
  }

  const text = (envelope.result ?? '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenced ? fenced[1].trim() : text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new SuggestionError(`claude's response was not valid JSON: ${text.slice(0, 200)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }
  const obj = parsed as Record<string, unknown>;

  return {
    description: typeof obj.description === 'string' && obj.description.trim().length > 0
      ? obj.description.trim()
      : undefined,
    componentTypes: Array.isArray(obj.componentTypes)
      ? obj.componentTypes.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      : undefined,
  };
}

/**
 * Phase 10 item 3, "Suggest with Claude": the first AI-invoking capability
 * in Add New's autofill -- everything else (`detectArtifactMetadata`) is
 * pure static analysis. Only called on an explicit user click (never
 * automatically on payload pick, unlike the deterministic detectors),
 * since this costs real latency and a real API call.
 *
 * Deliberately does NOT pass `--bare`: it looks like the minimal-mode
 * flag meant for fast/scripted use, but a real test showed it breaks
 * authentication outright in this environment (`--bare` skips keychain
 * reads per `claude --help`, so a nested invocation can't find real
 * credentials -- confirmed via a real failed call: "Not logged in").
 *
 * Two more real, tested findings shaped the exact `execFileSync` call
 * below, not assumptions:
 * - On Windows, a global npm install of `claude` is a `.cmd` shim, not a
 *   raw `.exe`. `execFileSync('claude', ...)` without `shell: true` fails
 *   with `ENOENT` (can't resolve `.cmd` without going through a shell);
 *   Node's own Windows `.cmd`/`.bat` handling requires `shell: true` (a
 *   direct attempt at `execFileSync('claude.cmd', ...)` without it fails
 *   too, with `EINVAL`). So `shell: true` is required here, not optional.
 * - `shell: true` means argv elements get concatenated into a shell
 *   command line, not passed as discrete, safely-separated arguments --
 *   a real command-injection risk if the (arbitrary, payload-derived)
 *   prompt text were one of those elements. The actual fix: the prompt
 *   never appears in argv at all -- it's written to the child's stdin via
 *   the `input` option instead (confirmed empirically: `claude -p` reads
 *   the prompt from stdin when piped, no inline text argument needed).
 *   Only fixed, hardcoded strings this code controls (`-p`,
 *   `--disallowedTools`, `DISALLOWED_TOOLS`, `--output-format`, `json`)
 *   ever go through the shell-concatenated argv.
 */
export function suggestMetadata(payloadPath: string, kind: string): SuggestedMetadata {
  const source = readPayloadSource(payloadPath);
  const prompt = buildSuggestionPrompt(source, kind);

  let output: string;
  try {
    output = execFileSync(
      'claude',
      ['-p', '--disallowedTools', DISALLOWED_TOOLS, '--output-format', 'json'],
      { encoding: 'utf-8', timeout: 45_000, input: prompt, shell: true },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SuggestionError(`Failed to run "claude" for a suggestion: ${detail}`);
  }

  return parseSuggestionResponse(output);
}
