import { Command } from 'commander';
import { pullArtifact } from '../../engine/pull/pull';

export function registerPullCommand(program: Command): void {
  program
    .command('pull <id>')
    .description('Pull an artifact by id into the current project')
    .option('-r, --remote <name>', 'Disambiguate which remote to pull the artifact from')
    .action((id: string, options: { remote?: string }) => {
      const result = pullArtifact(id, options.remote, process.cwd());
      if (result.postInstallOutput && result.postInstallOutput.trim().length > 0) {
        console.log(result.postInstallOutput.trimEnd());
      }
      console.log(`Pulled "${result.manifest.id}" -> ${result.installTarget}`);
    });
}
