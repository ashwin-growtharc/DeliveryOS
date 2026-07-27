import { Command } from 'commander';
import { scanForNewArtifacts } from '../../engine/scan/scan';

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description(
      'Scan .claude/agents, .claude/skills, .claude/commands, and .claude/rules for content not '
        + 'yet tracked or already in --remote, and print a ready-to-edit `push --new` command for each',
    )
    .requiredOption('-r, --remote <name>', 'Remote to check candidates against')
    .action(async (options: { remote: string }) => {
      const candidates = await scanForNewArtifacts(process.cwd(), options.remote);

      if (candidates.length === 0) {
        console.log('No new content found in .claude/agents, .claude/skills, .claude/commands, or .claude/rules.');
        return;
      }

      console.log(
        `Found ${candidates.length} candidate(s) not yet tracked or in "${options.remote}":\n`,
      );
      for (const candidate of candidates) {
        const description = candidate.description ?? 'TODO: no description found, add one';
        console.log(`[${candidate.kind}] ${candidate.id}`);
        console.log(`  Description (guessed): ${description}`);
        console.log(`  Install target: ${candidate.installTarget}`);
        console.log(
          `  Propose with:\n    deliveryos push ${candidate.id} --new --remote ${options.remote} `
            + `--path "${candidate.payloadPath}" --kind ${candidate.kind} --owner <you> `
            + `--description "${description}" --install-target "${candidate.installTarget}"`,
        );
        console.log('');
      }
    });
}
