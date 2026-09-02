import { Command } from 'commander';
import { checkForUpdates } from '../../engine/sync/sync';
import { applyAvailableUpdates } from '../../engine/sync/applyUpdate';

export function registerCheckUpdatesCommand(program: Command): void {
  program
    .command('check-updates')
    .description('Check registered remotes for newer versions of artifacts pulled into the current project')
    .option(
      '--apply',
      'Also apply every update that has no local edits in the way (re-copies the new payload, re-runs '
        + 'post_install, updates the pristine snapshot and lockfile version). An artifact with local edits '
        + 'is reported, never touched -- push the edit first, or resolve it by hand.',
    )
    .action(async (options: { apply?: boolean }) => {
      if (!options.apply) {
        const updates = await checkForUpdates(process.cwd());
        if (updates.length === 0) {
          console.log('No updates available.');
          return;
        }
        for (const update of updates) {
          console.log(
            `${update.id} (${update.remote}): ${update.installedVersion} -> ${update.availableVersion}`,
          );
        }
        return;
      }

      const results = await applyAvailableUpdates(process.cwd());
      if (results.length === 0) {
        console.log('No updates available.');
        return;
      }
      for (const result of results) {
        if (result.applied) {
          console.log(`${result.id} (${result.remote}): updated ${result.previousVersion} -> ${result.availableVersion}`);
          if (result.postInstallOutput && result.postInstallOutput.trim().length > 0) {
            console.log(result.postInstallOutput.trimEnd());
          }
          if (result.note) {
            console.log(`  ${result.note}`);
          }
        } else {
          // `availableVersion` is absent when the artifact is not in the
          // catalog at all -- there is no upstream version to name, and
          // interpolating it directly printed "1.0.0 -> undefined available".
          const versions = result.availableVersion
            ? `${result.previousVersion} -> ${result.availableVersion} available`
            : `installed ${result.previousVersion}, nothing available upstream`;
          console.log(`${result.id} (${result.remote}): NOT updated (${versions}) -- ${result.reason}`);
        }
      }
    });
}
