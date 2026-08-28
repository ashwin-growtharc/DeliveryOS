import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { isExecError, isToolNotFoundError } from '../execHelpers';
import { POST_INSTALL_MAX_BUFFER_BYTES } from './pull';

const execAsync = promisify(exec);

// Real Next.js/webpack-shaped builds commonly finish in low tens of
// seconds to a couple of minutes even cold; 5 minutes gives genuine
// headroom above that without letting a truly stuck command (waiting on
// interactive stdin, an infinite loop, a hung network call) tie up this
// process indefinitely -- see `runProjectBuild`'s own doc comment for why
// a hang here is worse than in a normal terminal (it blocks the sidecar's
// event loop for every other in-flight command too).
export const BUILD_VERIFY_TIMEOUT_MS = 5 * 60 * 1000;

export interface BuildVerificationResult {
  /** False when no build command could be detected at all -- not a
   * failure, just nothing to verify (e.g. a non-Node project, or a
   * package.json with no "build" script). */
  ran: boolean;
  command?: string;
  success?: boolean;
  output?: string;
  /** True when the command was killed for running past the timeout
   * (`BUILD_VERIFY_TIMEOUT_MS`, or a caller-supplied override) rather than
   * genuinely finishing and reporting a real compile problem -- lets a
   * caller tell "this looks stuck/hung" apart from "the code doesn't
   * build." `success` is still `false` alongside this, and `output` still
   * carries a clear human-readable explanation either way. */
  timedOut?: boolean;
  /** True when the detected build command's own underlying tool (e.g.
   * `npm`) isn't installed or isn't on this machine's PATH at all, as
   * opposed to the tool running and finding a real compile error -- lets a
   * caller tell "this machine can't run the check" apart from "the code
   * doesn't build." `success` is still `false` alongside this, and
   * `output` still carries a clear human-readable explanation either
   * way. */
  toolNotFound?: boolean;
}

/**
 * Detects the real command to verify a project still builds after wiring
 * gets applied -- the smallest real heuristic that matches this project's
 * own proven target ecosystem (Next.js/Node): a `package.json` with a
 * `"build"` script means `npm run build`. Deliberately does NOT try to
 * detect yarn/pnpm (matching whichever lockfile is present) for this first
 * slice -- every real target project this whole effort has been proven
 * against used npm; broadening this is a real, small, separate addition
 * for whenever a non-npm project actually needs it, not a gap to guess at
 * now. Returns undefined (not an error) for anything else -- a project
 * with no detectable build command is a normal, expected outcome, not a
 * failure.
 */
export function detectBuildCommand(cwd: string): string | undefined {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return undefined;
  }

  let pkg: unknown;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return undefined;
  }

  if (
    pkg
    && typeof pkg === 'object'
    && 'scripts' in pkg
    && pkg.scripts
    && typeof pkg.scripts === 'object'
    && 'build' in pkg.scripts
    && typeof (pkg.scripts as Record<string, unknown>).build === 'string'
  ) {
    return 'npm run build';
  }

  return undefined;
}

/**
 * Runs the detected build command for real, in `cwd`, and reports whether
 * it actually passed -- this is the "-and-test" half of "deterministic
 * apply-and-test on Pull" (Phase 10 item 1).
 *
 * Async (`exec`, promisified), not `execSync` -- the sidecar
 * (`src/sidecar.ts`) is a single Node process explicitly designed to
 * handle overlapping requests concurrently (`handleLine` is fired without
 * being awaited per line); a synchronous, blocking build command here
 * would freeze that whole process, and every other in-flight or new
 * command, for the build's entire duration. `exec` keeps the event loop
 * free for that whole time instead, matching the same fix applied to
 * `suggestMetadata`'s own subprocess call for the identical reason. Also
 * still never lets the build's raw output touch the sidecar's own
 * stdout (which is a newline-delimited JSON stream a build command's
 * output would otherwise corrupt) -- `exec` always captures child
 * stdout/stderr via pipes to produce its own `stdout`/`stderr` strings,
 * the same effective behavior `execSync`'s explicit `stdio: 'pipe'` had
 * to spell out.
 */
export async function runProjectBuild(
  cwd: string,
  timeoutMs: number = BUILD_VERIFY_TIMEOUT_MS,
): Promise<BuildVerificationResult> {
  const command = detectBuildCommand(cwd);
  if (!command) {
    return { ran: false };
  }

  try {
    // maxBuffer: Node's 1 MB default kills the child with ENOBUFS when a
    // build prints more than that, and this function reports the result as
    // an ordinary build FAILURE -- so a merely verbose build looked exactly
    // like a broken one. Same 10 MB ceiling every other shelled-out command
    // in the engine uses.
    const { stdout } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: POST_INSTALL_MAX_BUFFER_BYTES,
    });
    return { ran: true, command, success: true, output: stdout };
  } catch (err) {
    const stdout = isExecError(err) ? err.stdout?.toString('utf-8') ?? '' : '';
    const stderr = isExecError(err) ? err.stderr?.toString('utf-8') ?? '' : '';
    const detail = err instanceof Error ? err.message : String(err);
    const output = [stdout, stderr].filter((s) => s.trim().length > 0).join('\n') || detail;

    // Confirmed empirically: a promisified `exec` killed for exceeding its
    // `timeout` reports no distinct error code (`err.code` is `null`) --
    // `killed: true` is the only reliable signal it was Node's own timeout
    // that ended the process, not the command exiting on its own.
    if (isExecError(err) && err.killed) {
      return {
        ran: true,
        command,
        success: false,
        timedOut: true,
        output: `Build command timed out after ${timeoutMs}ms (still running/hung, no compile result was produced)\n${output}`,
      };
    }

    if (isToolNotFoundError(output)) {
      return {
        ran: true,
        command,
        success: false,
        toolNotFound: true,
        output: `Build command's tool was not found on this machine's PATH:\n${output}`,
      };
    }

    return { ran: true, command, success: false, output };
  }
}
