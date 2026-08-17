import { Command } from 'commander';
import { resolvePayloadDir } from '../../engine/payload/payloadDir';
import { checkSourceDrift } from '../../engine/drift/checkDrift';

export function registerCheckDriftCommand(program: Command): void {
  program
    .command('check-drift <id>')
    .description(
      'Check whether the real external source an artifact was extracted from (via SOURCES.json) has '
        + 'changed since extraction',
    )
    .requiredOption('-r, --remote <name>', 'Remote the artifact belongs to')
    .requiredOption('-s, --source <path>', 'Local filesystem path to the real source root')
    .action(async (id: string, options: { remote: string; source: string }) => {
      const payloadDir = resolvePayloadDir(options.remote, id);
      const results = checkSourceDrift(payloadDir, options.source);

      const drifted = results.filter((r) => r.status === 'drifted');
      const sourceMissing = results.filter((r) => r.status === 'source-missing');
      const unchanged = results.filter((r) => r.status === 'unchanged');

      console.log(
        `${drifted.length} drifted, ${sourceMissing.length} source-missing, ${unchanged.length} unchanged `
          + `(${results.length} tracked file(s) total)\n`,
      );

      if (drifted.length > 0) {
        console.log('Drifted (real source has changed since extraction):');
        for (const r of drifted) {
          console.log(`  ${r.payloadPath}  <-  ${r.sourcePath}`);
        }
        console.log('');
      }

      if (sourceMissing.length > 0) {
        console.log('Source missing (real source file no longer exists at the given path):');
        for (const r of sourceMissing) {
          console.log(`  ${r.payloadPath}  <-  ${r.sourcePath}`);
        }
      }
    });
}
