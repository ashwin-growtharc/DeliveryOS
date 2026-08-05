import { Command } from 'commander';
import { resolveArtifact } from '../../engine/pull/pull';
import { resolveWiringActions } from '../../engine/pull/wiring';
import { printWiringActions } from '../output';

export function registerWiringCommand(program: Command): void {
  program
    .command('wiring <id>')
    .description(
      'Show an artifact\'s declared Tier-2 wiring suggestions, resolved against the current '
        + 'project (which target files already exist vs. need creating). Read-only -- never '
        + 'writes or modifies anything.',
    )
    .option('-r, --remote <name>', 'Disambiguate which remote to resolve the artifact from')
    .option('--json', 'Print JSON instead of a human-readable listing')
    .action((id: string, options: { remote?: string; json?: boolean }) => {
      const entry = resolveArtifact(id, options.remote);
      const resolved = resolveWiringActions(entry.manifest.wiring_actions, process.cwd());
      printWiringActions(resolved, Boolean(options.json));
    });
}
