import { Command } from 'commander';
import { buildCatalog, annotateCatalog } from '../../engine/catalog/catalog';
import { printCatalog } from '../output';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List artifacts across all registered remotes')
    .option('-r, --remote <name>', 'Only list artifacts from this remote')
    .option('--json', 'Print JSON instead of a table')
    .action((options: { remote?: string; json?: boolean }) => {
      // annotateCatalog (shared with the sidecar's catalog.list/refresh)
      // also computes each entry's real pulled/edited/not-pulled state
      // against the CURRENT directory's own lockfile -- a real CLI/sidecar
      // parity gap this closes: the app's Browse view has always shown
      // this over the exact same catalog data, but `deliveryos list`
      // never had it at all.
      const entries = annotateCatalog(buildCatalog(), process.cwd(), options.remote);
      printCatalog(entries, Boolean(options.json));
    });
}
