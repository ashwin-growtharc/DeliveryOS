import { Command } from 'commander';
import { buildCatalogWithSkipped, annotateCatalog } from '../../engine/catalog/catalog';
import { listRemotes } from '../../engine/remote/remoteRegistry';
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
      // Three different facts, which a single "No artifacts found." merged
      // into one. Running `list` on a fresh install is the first thing anyone
      // does, and being told the catalog is empty -- when really no source has
      // been added yet -- reads as "this tool does not work".
      const remotes = listRemotes();
      const emptyMessage = remotes.length === 0
        ? 'No remotes are configured, so there is nothing to list yet.\n'
          + '\nAdd one with:\n  deliveryos remote add <git-url>'
        : options.remote
          ? `No artifacts in remote "${options.remote}".`
          : `No artifacts found across ${remotes.length} registered remote(s). `
            + 'Run `deliveryos refresh` if you expect something to be there.';
      printCatalog(entries, Boolean(options.json), emptyMessage);

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
