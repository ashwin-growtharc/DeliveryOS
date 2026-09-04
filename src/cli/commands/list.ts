import { Command } from 'commander';
import { buildCatalogWithSkipped, annotateCatalog } from '../../engine/catalog/catalog';
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
      const built = buildCatalogWithSkipped();
      const entries = annotateCatalog(built.entries, process.cwd(), options.remote);
      printCatalog(entries, Boolean(options.json));

      // A manifest that could not be loaded is reported AFTER the catalog,
      // never instead of it. One bad artifact used to throw and leave the
      // user with nothing but a validation error -- the whole catalog gone
      // because of a single file they very likely did not write.
      const skipped = built.skipped;
      if (skipped.length > 0 && !options.json) {
        process.stderr.write(
          `
${skipped.length} artifact(s) could not be loaded and were skipped:
`,
        );
        for (const entry of skipped) {
          process.stderr.write(`  [${entry.remoteName}] ${entry.path}
      ${entry.reason}
`);
        }
      }
    });
}
