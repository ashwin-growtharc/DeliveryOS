import { Command } from 'commander';
import { buildCatalog } from '../../engine/catalog/catalog';
import { printCatalog } from '../output';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List artifacts across all registered remotes')
    .option('-r, --remote <name>', 'Only list artifacts from this remote')
    .option('--json', 'Print JSON instead of a table')
    .action((options: { remote?: string; json?: boolean }) => {
      let entries = buildCatalog();
      if (options.remote) {
        entries = entries.filter((entry) => entry.remoteName === options.remote);
      }
      printCatalog(entries, Boolean(options.json));
    });
}
