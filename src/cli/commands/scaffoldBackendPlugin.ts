import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { stringify as stringifyYaml } from 'yaml';
import { detectInstallParams } from '../../engine/scan/detectInstallParams';
import { suggestWiringActions } from '../../engine/scan/suggestWiringActions';

/** Commander's own repeatable-flag accumulator pattern, same shape
 * `pull`/`config`'s own `collectSetFlag` already uses for `--set` --
 * just collecting plain strings here instead of parsing `KEY=VALUE`. */
function collectConsumerFile(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerScaffoldBackendPluginCommand(program: Command): void {
  program
    .command('scaffold-backend-plugin')
    .description(
      'Scaffold a draft for a backend-plugin manifest: detects install_params mechanically, and asks '
        + 'Claude to suggest wiring_actions by comparing the payload against real consumer files that '
        + 'already wire it in today. Writes a draft YAML file to review and copy from by hand -- never '
        + 'writes to a real manifest.yaml.',
    )
    .requiredOption('--path <dir>', 'Path to the payload being packaged')
    .option(
      '--consumer-file <path>',
      'A real file in your OWN project that already wires this payload in today (e.g. auth.ts). '
        + 'Repeatable -- give every file that performs a real integration step.',
      collectConsumerFile,
      [],
    )
    .option('--out <path>', 'Where to write the draft YAML', './wiring-actions-draft.yaml')
    .action(async (options: { path: string; consumerFile: string[]; out: string }) => {
      if (!fs.existsSync(options.path)) {
        throw new Error(`--path "${options.path}" does not exist`);
      }
      if (options.consumerFile.length === 0) {
        throw new Error(
          '--consumer-file is required at least once -- point it at a real file in your own project '
            + 'that already wires this payload in today (e.g. --consumer-file auth.ts).',
        );
      }

      const cwd = process.cwd();
      const installParams = detectInstallParams(options.path);
      const { wiringActions, skipped } = await suggestWiringActions(options.path, options.consumerFile, cwd);

      const draft: Record<string, unknown> = {};
      if (installParams.length > 0) {
        draft.install_params = installParams;
      }
      if (wiringActions.length > 0) {
        draft.wiring_actions = wiringActions;
      }

      const outPath = path.resolve(cwd, options.out);
      fs.writeFileSync(outPath, stringifyYaml(draft), 'utf-8');

      console.log(
        `Detected ${installParams.length} install_param${installParams.length === 1 ? '' : 's'} `
          + `(a payload that reads no process.env.X directly -- e.g. one whose config is read implicitly `
          + `by a library, or lives in the consuming project's own files -- genuinely detects 0; that's `
          + `expected, not a bug).`,
      );
      console.log(
        `Claude suggested ${wiringActions.length} wiring_action${wiringActions.length === 1 ? '' : 's'}`
          + (skipped.length > 0 ? `, and ${skipped.length} proposed entr${skipped.length === 1 ? 'y' : 'ies'} `
            + `didn't match the real schema and were skipped (not silently dropped -- shown below).` : '.'),
      );
      if (skipped.length > 0) {
        console.log(JSON.stringify(skipped, null, 2));
      }
      console.log(`\nDraft written to ${outPath}.`);
      console.log(
        'This is a draft, not a finished manifest -- review every targetFile and snippet yourself before '
          + 'copying anything into a real manifest.yaml. Nothing here has been applied anywhere.',
      );
    });
}
