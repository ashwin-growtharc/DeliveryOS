import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface BuildVerificationResult {
  /** False when no build command could be detected at all -- not a
   * failure, just nothing to verify (e.g. a non-Node project, or a
   * package.json with no "build" script). */
  ran: boolean;
  command?: string;
  success?: boolean;
  output?: string;
}

function isExecError(err: unknown): err is Error & { stdout?: Buffer; stderr?: Buffer } {
  return err instanceof Error;
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
export async function runProjectBuild(cwd: string): Promise<BuildVerificationResult> {
  const command = detectBuildCommand(cwd);
  if (!command) {
    return { ran: false };
  }

  try {
    const { stdout } = await execAsync(command, { cwd });
    return { ran: true, command, success: true, output: stdout };
  } catch (err) {
    const stdout = isExecError(err) ? err.stdout?.toString('utf-8') ?? '' : '';
    const stderr = isExecError(err) ? err.stderr?.toString('utf-8') ?? '' : '';
    const detail = err instanceof Error ? err.message : String(err);
    const output = [stdout, stderr].filter((s) => s.trim().length > 0).join('\n') || detail;
    return { ran: true, command, success: false, output };
  }
}
