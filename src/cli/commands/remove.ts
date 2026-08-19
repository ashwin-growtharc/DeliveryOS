import { Command } from 'commander';
import { removeArtifact } from '../../engine/pull/removeArtifact';

export function registerRemoveCommand(program: Command): void {
  program
    .command('remove <id>')
    .description('Remove a previously-pulled artifact from the current project')
    .action(async (id: string) => {
      const result = await removeArtifact(process.cwd(), id);

      console.log(`Removed "${id}":`);
      console.log(`  Install directory: ${result.removedInstallTarget ? 'deleted' : 'was already gone'}`);
      if (result.removedWiredFiles.length > 0) {
        console.log(`  Wired files deleted: ${result.removedWiredFiles.join(', ')}`);
      }
      console.log(`  Pristine snapshot: ${result.removedPristineSnapshot ? 'deleted' : 'was already gone'}`);
      console.log('  Lockfile entry: removed');

      // Deliberately its own separate, hard-to-miss section -- these are the
      // two things `removeArtifact` never touches automatically, so a
      // person must not assume either one is handled just because the rest
      // of the removal succeeded.
      if (result.filesNeedingManualReview.length > 0 || result.envParamsStillSet.length > 0) {
        console.log('');
        console.log('Needs your attention -- not touched automatically:');
        if (result.filesNeedingManualReview.length > 0) {
          console.log(
            `  Files that existed before this artifact was pulled (or were AI-merged since) -- `
              + `review and remove by hand if you no longer want them: ${result.filesNeedingManualReview.join(', ')}`,
          );
        }
        if (result.envParamsStillSet.length > 0) {
          console.log(
            `  .env.local still has value(s) for: ${result.envParamsStillSet.join(', ')} -- left in place `
              + `in case another artifact shares them; remove manually if no longer needed.`,
          );
        }
      }
    });
}
