import { pullArtifact, PullResult, ProgressCallback } from './pull';
import { resolveWiringActions } from './wiring';
import { applyDeterministicWiring, AppliedWiringResult } from './applyWiring';
import { runProjectBuild, BuildVerificationResult } from './verifyBuild';

export interface AutoWireResult {
  pullResult: PullResult;
  wiring: AppliedWiringResult;
  build: BuildVerificationResult;
}

/**
 * Phase 10 item 1: "deterministic apply-and-test on Pull, no agent
 * involved yet." Deliberately a separate function, not a change to
 * `pullArtifact` itself -- that function's own default behavior (Tier 2
 * wiring never auto-applied) stays exactly as Phase 7 left it, since the
 * CLI's `deliveryos pull` and every existing test depend on that. This
 * wraps it: pulls exactly as before, then (only when the artifact
 * declares `wiring_actions`) applies whatever's safely auto-appliable and
 * runs the target project's own real build to confirm it still works --
 * the app's own Pull button is the one thing that opts into this, via a
 * dedicated sidecar command, never the default path.
 */
export async function pullAndAutoWire(
  id: string,
  remoteName: string | undefined,
  cwd: string,
  onProgress?: ProgressCallback,
  providedValues: Record<string, string> = {},
): Promise<AutoWireResult> {
  const pullResult = await pullArtifact(id, remoteName, cwd, onProgress, providedValues);

  if (pullResult.manifest.wiring_actions.length === 0) {
    return {
      pullResult,
      wiring: { applied: [], needsReview: [] },
      build: { ran: false },
    };
  }

  onProgress?.('wiring', 'Applying automatic wiring...');
  const resolved = resolveWiringActions(pullResult.manifest.wiring_actions, cwd);
  const wiring = applyDeterministicWiring(resolved, cwd);

  onProgress?.('build', 'Verifying the project still builds...');
  const build = runProjectBuild(cwd);

  return { pullResult, wiring, build };
}
