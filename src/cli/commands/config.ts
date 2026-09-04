import { Command } from 'commander';
import { resolveArtifact } from '../../engine/pull/pull';
import {
  applyInstallParams,
  readExistingEnvValues,
  resolveInstallParamValues,
} from '../../engine/pull/installParams';

/** Parses one or more repeated `--set KEY=VALUE` flags into a plain map.
 * Deliberately its own copy of `pull.ts`'s own `collectSetFlag` rather than
 * an imported shared helper -- two small, independent CLI-parsing reducers,
 * not a real abstraction worth introducing across command files for this. */
function collectSetFlag(value: string, previous: Record<string, string>): Record<string, string> {
  const eq = value.indexOf('=');
  if (eq <= 0) {
    throw new Error(`--set "${value}" must be in the form KEY=VALUE`);
  }
  const key = value.slice(0, eq);
  const val = value.slice(eq + 1);
  return { ...previous, [key]: val };
}

export function registerConfigCommand(program: Command): void {
  program
    .command('config <id>')
    .description(
      'Rotate/configure install_param values for an already-pulled artifact, without a re-pull',
    )
    .option('-r, --remote <name>', 'Disambiguate which remote the artifact was pulled from')
    .option(
      '--set <key=value>',
      'Provide a value for one of the artifact\'s declared install_params (e.g. --set '
        + 'AUTH_SECRET=... ). Repeatable. Written to .env.local at the project root.',
      collectSetFlag,
      {},
    )
    .action(async (id: string, options: { remote?: string; set: Record<string, string> }) => {
      const cwd = process.cwd();
      const entry = resolveArtifact(id, options.remote);
      const resolved = resolveInstallParamValues(
        entry.manifest.install_params,
        options.set,
        readExistingEnvValues(cwd),
      );
      const { gitignoreWarning, installParamWarning } = applyInstallParams(cwd, resolved.values);

      // Reports based on what was actually ASKED for this call (setKeys),
      // not whether .env.local's bytes technically changed --
      // resolveInstallParamValues always folds in already-configured
      // existing values too (see its own doc comment), so applyInstallParams
      // can perform a real (if idempotent) rewrite even with zero --set
      // flags. Claiming "nothing written" in that case would be false; the
      // honest statement is simply that no NEW value was requested.
      const setKeys = Object.keys(options.set);
      if (setKeys.length > 0) {
        console.log(`Configured "${id}" -- set ${setKeys.join(', ')} in .env.local`);
      } else {
        console.log(`Configured "${id}" -- no new value provided this call`);
      }
      if (resolved.missingRequired.length > 0) {
        console.log(
          `Still needs configuration -- missing required value(s): `
            + `${resolved.missingRequired.join(', ')}. Re-run with --set KEY=VALUE, or edit `
            + `.env.local directly.`,
        );
      }
      if (gitignoreWarning) {
        console.log(gitignoreWarning);
      }
      if (installParamWarning) {
        console.log(installParamWarning);
      }

      // Real scope boundary, not silently omitted: this only rotates the
      // value sitting in .env.local. It does NOT re-run wiring_actions, so
      // anything other than a runtime `process.env` read (e.g. a value
      // already spliced into a config file by an earlier wiring pass) won't
      // see the new value until a real update-apply path exists (Phase 13's
      // still-open "A real update-apply path" item).
      console.log(
        'Note: this does not re-run wiring_actions -- only code that reads process.env at '
          + 'runtime will see the new value.',
      );
    });
}
