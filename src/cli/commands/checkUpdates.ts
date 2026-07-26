import { Command } from 'commander';
import { checkForUpdates } from '../../engine/sync/sync';

export function registerCheckUpdatesCommand(program: Command): void {
  program
    .command('check-updates')
    .description('Check registered remotes for newer versions of artifacts pulled into the current project')
    .action(async () => {
      const updates = await checkForUpdates(process.cwd());
      if (updates.length === 0) {
        console.log('No updates available.');
        return;
      }
      for (const update of updates) {
        console.log(
          `${update.id} (${update.remote}): ${update.installedVersion} -> ${update.availableVersion}`,
        );
      }
    });
}
