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
