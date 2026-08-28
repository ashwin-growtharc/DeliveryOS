import * as fs from 'fs';

/**
 * Shared by every place that shells out via `execSync`/`exec` and needs to
 * tell apart "the tool ran and found a real problem" from "the tool isn't
 * on PATH at all" -- previously duplicated near-identically in `pull.ts`
 * (post_install) and `verifyBuild.ts` (build verification); consolidated
 * here once a third caller (`applyUpdate.ts`) needed the same check rather
 * than adding a third copy.
 */
export function isExecError(
  err: unknown,
): err is Error & { stdout?: Buffer; stderr?: Buffer; code?: string; killed?: boolean } {
  return err instanceof Error;
}

/** Detects "the command's own tool isn't installed / isn't on PATH at all"
 * as distinct from "the tool ran and found a real problem" -- confirmed
 * empirically (not assumed from docs): on Windows, `exec`/`execSync` route
 * through cmd.exe, so a missing tool never throws a Node-level ENOENT; it's
 * the shell itself reporting an ordinary-looking non-zero exit with this
 * wording. POSIX shells' "command not found" is included for parity, though
 * not directly exercised on this project's own (Windows) dev machine. */
export function isToolNotFoundError(text: string): boolean {
  return /is not recognized as an internal or external command/i.test(text)
    || /command not found/i.test(text)
    || /:\s*not found\s*$/im.test(text);
}

/**
 * Deletes `dir`, retrying on a real, confirmed Windows race: a killed
 * process's real grandchild can keep running independently for a while
 * after the timeout that killed its immediate shell wrapper, still holding
 * a lock on `dir` right as this tries to delete it. Plain `fs.rmSync`'s own
 * `maxRetries` does not reliably retry this specific EPERM/EBUSY.
 *
 * Previously duplicated near-identically across `removeArtifact.ts` (a real
 * production fix) and two test files' own cleanup helpers; consolidated
 * here once a third copy was about to be added rather than letting a future
 * fix to the retry budget (like this one) require remembering three places.
 *
 * Default budget widened from an earlier ~3s (30 attempts x 100ms) to ~30s:
 * found via review to be too short for the actual scenario it exists to
 * handle -- a `post_remove` command killed near its own multi-minute
 * timeout can plausibly hold a lock for several more seconds, not
 * fractions of one. Still bounded, not infinite; throws the final error if
 * every attempt fails -- a caller that must never let a stuck delete block
 * a larger operation (see `removeArtifact.ts`'s own post_remove-triggered
 * call) should catch this itself and degrade to a warning, the same way
 * `runPostRemoveCommand`'s own failures already do.
 */
export async function rmDirWithRetry(dir: string, maxAttempts = 100, delayMs = 300): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt === maxAttempts || (code !== 'EPERM' && code !== 'EBUSY')) {
        throw err;
      }
      await new Promise((resolve) => { setTimeout(resolve, delayMs); });
    }
  }
}
