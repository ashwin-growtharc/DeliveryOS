import { spawn } from 'child_process';

/**
 * Hands off to a REAL, interactive `claude` session -- deliberately NOT
 * `runClaudeSubprocess.ts`'s function (different semantics entirely: this
 * inherits the real terminal's stdio for a live, multi-turn back-and-forth,
 * where that one pipes a single `-p` prompt in and a single JSON envelope
 * out). No `-p`, no `--disallowedTools`, no `--output-format` -- this is
 * the exact same `claude` the user would get running it themselves by
 * hand, with Claude Code's own real permission prompts fully intact.
 *
 * This is a deliberate choice, not an oversight: an earlier design (see
 * `docs/product-roadmap-vision.md`'s own note, and `PLAN.md`'s Phase 10
 * changelog) considered giving the RESTRICTED `-p` subprocess real tool
 * access via `--allowedTools`, and walked it back after finding a real
 * Windows command-injection risk and confirming Claude Code's own
 * tool-restriction flags aren't reliably enforced. Handing off to the
 * already-trusted INTERACTIVE binary instead -- with its own permission
 * model doing the real work, not a flag DeliveryOS asks it to honor --
 * avoids reopening either problem.
 *
 * `cwd` is set to the target project on purpose (the opposite of
 * `runClaudeSubprocess`'s own choice to leave it unset) -- the entire
 * point here is operating on the real project, under the user's own
 * already-trusted permission model, not limiting a leaked-tool-call's
 * blast radius the way the restricted subprocess has to.
 *
 * `startingMessage` must be a short, fully DeliveryOS-authored constant
 * (see `buildWireContextMarkdown`'s own doc comment for why untrusted
 * manifest text is never passed here) -- this function does not sanitize
 * it for CONTENT, the same trust boundary `runClaudeSubprocess` places on
 * its own `disallowedTools` argument (a fixed, code-controlled string,
 * never caller-assembled from untrusted parts). It DOES need quoting for
 * SHELL SAFETY, though -- confirmed the hard way: `shell: true` joins
 * `command` and every element of `args` into one space-separated command
 * line before handing it to `cmd.exe` on Windows (the same real mechanism
 * `runClaudeSubprocess.ts`'s own doc comment describes), so an
 * unquoted multi-word message gets split into several separate shell
 * words -- a real test showed Claude receiving only a truncated fragment
 * ("It looks like your message got cut off"). `JSON.stringify` wraps it
 * in a single double-quoted argument cmd.exe's own argument parser
 * reassembles correctly, confirmed against a real `claude -p` call.
 */
export function launchInteractiveClaudeSession(
  cwd: string,
  startingMessage: string,
): Promise<{ exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [JSON.stringify(startingMessage)], {
      cwd,
      stdio: 'inherit',
      shell: true,
    });
    child.on('error', (err) => {
      reject(err);
    });
    child.on('exit', (exitCode) => {
      resolve({ exitCode });
    });
  });
}
