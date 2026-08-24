import { Command } from 'commander';
import { pullArtifact } from '../../engine/pull/pull';
import { pullAndAutoWire } from '../../engine/pull/pullAndAutoWire';
import { buildPostInstallHealthSummary } from '../../engine/pull/postInstallHealthSummary';

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
    .option(
      '--no-wire',
      'Skip automatic wiring and the post-pull build check -- just copy the payload and '
        + 'write install_params, the same as every DeliveryOS version before this default '
        + 'changed. For scripted/CI use where nothing else in the project should be touched.',
    )
    .action(async (id: string, options: { remote?: string; set: Record<string, string>; wire: boolean }) => {
      if (!options.wire) {
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
        return;
      }

      const result = await pullAndAutoWire(id, options.remote, process.cwd(), undefined, options.set);
      const { pullResult } = result;
      if (pullResult.postInstallOutput && pullResult.postInstallOutput.trim().length > 0) {
        console.log(pullResult.postInstallOutput.trimEnd());
      }
      console.log(`Pulled "${pullResult.manifest.id}" -> ${pullResult.installTarget}`);
      if (pullResult.gitignoreWarning) {
        console.log(pullResult.gitignoreWarning);
      }
      // One coherent plain-language summary of wiring/build/missing-params,
      // same text the desktop app's own Pull toast shows -- covers
      // missingRequiredParams too, so it replaces (not supplements) the
      // separate message the --no-wire branch above prints for that.
      console.log(buildPostInstallHealthSummary(result));
    });
}
