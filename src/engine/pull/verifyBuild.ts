import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

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
 * apply-and-test on Pull" (Phase 10 item 1). `stdio: 'pipe'` (not
 * 'inherit'), matching `pullArtifact`'s own `post_install` precedent: this
 * runs inside the Tauri sidecar, whose stdout is a newline-delimited JSON
 * stream that a build command's raw output would otherwise corrupt.
 */
export function runProjectBuild(cwd: string): BuildVerificationResult {
  const command = detectBuildCommand(cwd);
  if (!command) {
    return { ran: false };
  }

  try {
    const output = execSync(command, { cwd, stdio: 'pipe' }).toString('utf-8');
    return { ran: true, command, success: true, output };
  } catch (err) {
    const stdout = isExecError(err) ? err.stdout?.toString('utf-8') ?? '' : '';
    const stderr = isExecError(err) ? err.stderr?.toString('utf-8') ?? '' : '';
    const detail = err instanceof Error ? err.message : String(err);
    const output = [stdout, stderr].filter((s) => s.trim().length > 0).join('\n') || detail;
    return { ran: true, command, success: false, output };
  }
}
