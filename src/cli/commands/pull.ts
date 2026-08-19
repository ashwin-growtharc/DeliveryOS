import { Command } from 'commander';
import { pullArtifact } from '../../engine/pull/pull';

/** Parses one or more repeated `--set KEY=VALUE` flags into a plain map --
 * Commander's own `collect` pattern (an accumulator reducer, not a single
 * default) is what makes `--set` repeatable at all. A malformed entry
 * (missing `=`, or an empty key) is a real usage error, not silently
 * dropped -- surfaced immediately so a typo doesn't quietly result in a
 * required install_param still being reported as missing. */
function collectSetFlag(value: string, previous: Record<string, string>): Record<string, string> {
  const eq = value.indexOf('=');
  if (eq <= 0) {
    throw new Error(`--set "${value}" must be in the form KEY=VALUE`);
  }
  const key = value.slice(0, eq);
  const val = value.slice(eq + 1);
  return { ...previous, [key]: val };
}

export function registerPullCommand(program: Command): void {
  program
    .command('pull <id>')
    .description('Pull an artifact by id into the current project')
    .option('-r, --remote <name>', 'Disambiguate which remote to pull the artifact from')
    .option(
      '--set <key=value>',
      'Provide a value for one of the artifact\'s declared install_params (e.g. --set '
        + 'AUTH_SECRET=... ). Repeatable. Written to .env.local at the project root, never '
        + 'into the artifact\'s own install_target.',
      collectSetFlag,
      {},
    )
    .action(async (id: string, options: { remote?: string; set: Record<string, string> }) => {
      const result = await pullArtifact(id, options.remote, process.cwd(), undefined, options.set);
      if (result.postInstallOutput && result.postInstallOutput.trim().length > 0) {
        console.log(result.postInstallOutput.trimEnd());
      }
      console.log(`Pulled "${result.manifest.id}" -> ${result.installTarget}`);
      if (result.missingRequiredParams.length > 0) {
        console.log(
          `Still needs configuration -- missing required value(s): `
            + `${result.missingRequiredParams.join(', ')}. Re-run with `
            + `--set KEY=VALUE, or edit .env.local directly.`,
        );
      }
      if (result.gitignoreWarning) {
        console.log(result.gitignoreWarning);
      }
    });
}
