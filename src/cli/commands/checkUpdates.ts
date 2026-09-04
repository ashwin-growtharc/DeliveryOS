import { Command } from 'commander';
import { checkForUpdates } from '../../engine/sync/sync';
import { applyAvailableUpdates } from '../../engine/sync/applyUpdate';
import { readLockfile } from '../../engine/lockfile/lockfile';

export function registerCheckUpdatesCommand(program: Command): void {
  program
    // `[id]` is optional, and adding it closed a real asymmetry: the sidecar's
    // `artifact.applyUpdate` has always taken an id and updated ONE artifact,
    // while this command could only ever update EVERY one. Same engine
    // function, and the engine has supported `onlyId` all along -- the CLI
    // simply never exposed the parameter, so `--apply` had no scoped form at
    // all. Without an id it still applies project-wide, which is now a choice
    // rather than the only mode.
    .command('check-updates [id]')
    .description(
      'Check registered remotes for newer versions of artifacts pulled into the current '
        + 'project. Pass an id to check or update just that one.',
    )
    .option(
      '--apply',
      'Also apply the update when nothing is in the way (re-copies the new payload, re-runs '
        + 'post_install, updates the pristine snapshot and lockfile version). Applies to EVERY '
        + 'artifact unless an id is given. An artifact with local edits is reported, never '
        + 'touched -- push the edit first, or resolve it by hand.',
    )
    .action(async (id: string | undefined, options: { apply?: boolean }) => {
      const cwd = process.cwd();

      // An id naming nothing installed is a different fact from "nothing to
      // update", and the engine cannot tell them apart: it filters the lockfile
      // by id, and an empty filter is indistinguishable from an empty result.
      // Left to the engine, a typo'd id reports "No updates available." --
      // which reads as reassurance about an artifact this project does not
      // even have.
      if (id) {
        const installed = readLockfile(cwd).entries.some((entry) => entry.id === id);
        if (!installed) {
          console.error(
            `"${id}" is not installed in this project, so there is nothing to check. `
              + 'Run `deliveryos list` to see what is installed.',
          );
          process.exitCode = 1;
          return;
        }
      }

      if (!options.apply) {
        const all = await checkForUpdates(cwd);
        const updates = id ? all.filter((u) => u.id === id) : all;
        if (updates.length === 0) {
          console.log(id ? `"${id}" is up to date.` : 'No updates available.');
          return;
        }
        for (const update of updates) {
          console.log(
            `${update.id} (${update.remote}): ${update.installedVersion} -> ${update.availableVersion}`,
          );
        }
        return;
      }

      const results = await applyAvailableUpdates(cwd, undefined, id);
      if (results.length === 0) {
        console.log(id ? `"${id}" is up to date.` : 'No updates available.');
        return;
      }
      for (const result of results) {
        if (result.applied) {
          console.log(`${result.id} (${result.remote}): updated ${result.previousVersion} -> ${result.availableVersion}`);
          // What actually changed, not just that a number moved. The refusal
          // path has always named the user's own changed files; this names the
          // ones that just overwrote their copy.
          if (result.changedFiles && result.changedFiles.length > 0) {
            const shown = result.changedFiles.slice(0, 10);
            for (const change of shown) {
              console.log(`  ${change.status}: ${change.relPath}`);
            }
            if (result.changedFiles.length > shown.length) {
              console.log(`  ...and ${result.changedFiles.length - shown.length} more`);
            }
          }
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
