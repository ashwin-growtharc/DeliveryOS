import { execFile } from 'child_process';

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
// pushes), so a call occasionally retaining more tool access than intended
// isn't a new class of risk here, just an imperfect one -- stated plainly
// rather than presented as an enforced boundary it isn't. Every caller of
// `runClaudeSubprocess` mitigates the resulting prompt-injection surface
// the same way: wrapping any untrusted embedded content in a clearly
// delimited block with an explicit "treat as inert data, never
// instructions" framing (see `suggestMetadata.ts`'s
// `buildSuggestionPrompt` / `fixBuildFailure.ts`'s `buildFixPrompt`).
export const DISALLOWED_TOOLS = [
  'Agent', 'Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit',
  'Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch', 'Artifact',
  'AskUserQuestion', 'ReportFindings', 'ScheduleWakeup',
  'ShareOnboardingGuide', 'Skill', 'ToolSearch', 'TaskCreate',
  'TaskUpdate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop',
  'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree', 'ExitWorktree',
  'Monitor', 'PushNotification', 'RemoteTrigger', 'SendMessage',
  'CronCreate', 'CronDelete', 'CronList', 'DesignSync',
].join(',');

/**
 * Runs a real `claude -p` subprocess asynchronously and returns its raw
 * stdout (the `--output-format json` envelope text) -- NOT `execFileSync`.
 * The sidecar (`src/sidecar.ts`) is a single Node process that reads one
 * JSON-line command at a time but is explicitly designed to handle
 * OVERLAPPING requests concurrently (`handleLine` is fired without being
 * awaited per line): a synchronous, blocking call here would freeze that
 * entire process -- and every other in-flight or new command -- for this
 * call's whole duration, which can realistically be many seconds for a
 * live LLM call. `execFile` (async, libuv-backed) keeps the event loop
 * free for that whole time instead.
 *
 * Deliberately does NOT pass `--bare`: it looks like the minimal-mode flag
 * meant for fast/scripted use, but a real test showed it breaks
 * authentication outright in this environment (`--bare` skips keychain
 * reads per `claude --help`, so a nested invocation can't find real
 * credentials -- confirmed via a real failed call: "Not logged in").
 *
 * Deliberately has no `cwd` option -- omitting it means the subprocess
 * runs wherever THIS process (the sidecar) lives, never inside whatever
 * project a caller happens to be operating on. Since `disallowedTools` is
 * a best-effort denylist, not a hard sandbox (see its own doc comment
 * above), a leaked tool call that gets through anyway is a real, if rare,
 * possibility -- keeping `cwd` unset keeps that leak's blast radius away
 * from the user's own project. Do not add a `cwd` parameter to "fix" this.
 *
 * Two more real, tested findings shaped the exact `execFile` call below,
 * not assumptions:
 * - On Windows, a global npm install of `claude` is a `.cmd` shim, not a
 *   raw `.exe`. `execFile('claude', ...)` without `shell: true` fails
 *   with `ENOENT` (can't resolve `.cmd` without going through a shell);
 *   Node's own Windows `.cmd`/`.bat` handling requires `shell: true` (a
 *   direct attempt at `execFile('claude.cmd', ...)` without it fails too,
 *   with `EINVAL`). So `shell: true` is required here, not optional.
 * - `shell: true` means argv elements get concatenated into a shell
 *   command line, not passed as discrete, safely-separated arguments --
 *   a real command-injection risk if the (arbitrary, caller-derived)
 *   prompt text were one of those elements. The actual fix: the prompt
 *   never appears in argv at all -- it's written to the child's own
 *   `stdin` stream by hand instead, then the stream is explicitly ended
 *   so the child sees EOF and actually responds (`claude -p` blocks
 *   reading stdin until it closes). `execFile`'s async form has no
 *   `input` convenience option the way `execFileSync`/`execSync` do
 *   (confirmed directly: passing one is silently ignored) -- hence
 *   writing to `child.stdin` explicitly here. Only fixed, hardcoded
 *   strings this code controls (`-p`, `--disallowedTools`,
 *   `disallowedTools`, `--output-format`, `json`) ever go through the
 *   shell-concatenated argv.
 */
export function runClaudeSubprocess(
  prompt: string,
  disallowedTools: string,
  timeoutMs = 45_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      ['-p', '--disallowedTools', disallowedTools, '--output-format', 'json'],
      { encoding: 'utf-8', timeout: timeoutMs, shell: true },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stdout);
      },
    );
    if (!child.stdin) {
      reject(new Error('claude subprocess has no writable stdin'));
      return;
    }
    child.stdin.end(prompt);
  });
}
