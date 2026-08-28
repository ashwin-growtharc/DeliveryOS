import { pullArtifact, PullResult, ProgressCallback } from './pull';
import { resolveWiringActions } from './wiring';
import { applyDeterministicWiring, AppliedWiringResult } from './applyWiring';
import { runProjectBuild, BuildVerificationResult } from './verifyBuild';
import { readLockfile, upsertEntry } from '../lockfile/lockfile';

export interface AutoWireResult {
  pullResult: PullResult;
  wiring: AppliedWiringResult;
  build: BuildVerificationResult;
}

/**
 * Phase 10 item 1: "deterministic apply-and-test on Pull, no agent
 * involved yet." Deliberately a separate function, not a change to
 * `pullArtifact` itself -- that function's own behavior (Tier 2 wiring
 * never auto-applied) stays exactly as Phase 7 left it, so every existing
 * test and the plain `pullArtifact` call underneath `--no-wire` keep
 * working unchanged. This wraps it: pulls exactly as before, then (only
 * when the artifact declares `wiring_actions`) applies whatever's safely
 * auto-appliable and runs the target project's own real build to confirm
 * it still works.
 *
 * Phase 18: this is now the CLI's own DEFAULT `deliveryos pull` path too,
 * not just the app's Pull button -- `--no-wire` is the opt-out for
 * scripted/CI use that wants the old plain-copy-only behavior. An artifact
 * with no `wiring_actions` behaves identically either way (the early
 * return below is a no-op), so this default change is invisible to every
 * artifact kind except `backend-plugin`.
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

  // Records which files THIS pull created fresh (Phase 13's uninstall gap)
  // -- a second, separate lockfile write rather than folding it into
  // pullArtifact's own upsertEntry call above, since applyDeterministicWiring
  // only ever runs here, not in pullArtifact itself. Re-reads the entry
  // pullArtifact just wrote (rather than reconstructing one from scratch)
  // so any other field it already carries (installTarget, a pre-existing
  // pendingPr) survives untouched -- same "spread the existing entry, only
  // override the one field this call cares about" convention
  // resolvePendingPushes already uses in sync.ts. Skipped entirely when
  // wiring created nothing, so an artifact with wiring_actions that all
  // resolved to needsReview never gets a pointless second write.
  if (wiring.applied.length > 0) {
    const lockfile = readLockfile(cwd);
    const entry = lockfile.entries.find((e) => e.id === pullResult.manifest.id);
    if (entry) {
      await upsertEntry(cwd, { ...entry, wiredFiles: wiring.applied });
    }
  }

  onProgress?.('build', 'Verifying the project still builds...');
  const build = await runProjectBuild(cwd);

  return { pullResult, wiring, build };
}
