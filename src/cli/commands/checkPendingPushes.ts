import { Command } from 'commander';
import { resolvePendingPushes } from '../../engine/sync/sync';

/**
 * CLI counterpart to the sidecar's `sync.resolvePendingPushes` RPC -- a
 * real CLI/sidecar parity gap this closes. Before this, only the app could
 * ever learn whether a pushed edit's PR was merged, rejected, or is still
 * open; a CLI-only user who pushed an edit had no way to find out (a
 * merged PR's `pendingPr` would just sit stuck in the lockfile forever).
 */
export function registerCheckPendingPushesCommand(program: Command): void {
  program
    .command('check-pending-pushes')
    .description(
      'Check GitHub for the real current state of every pushed edit still awaiting PR resolution '
        + '(open/merged/closed) -- resyncs local state for anything merged',
    )
    .action(async () => {
      const results = await resolvePendingPushes(process.cwd());
      if (results.length === 0) {
        console.log('No pending pushes to check.');
        return;
      }
      for (const result of results) {
        const outcome = result.merged ? 'merged' : result.state === 'open' ? 'still open' : 'closed (not merged)';
        console.log(`${result.id} (${result.remote}): PR #${result.prNumber} -- ${outcome} -- ${result.prUrl}`);
      }
    });
}
