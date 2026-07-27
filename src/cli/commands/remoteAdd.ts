import * as fs from 'fs';
import { Command } from 'commander';
import {
  addRemoteEntry,
  findRemote,
  removeRemoteEntry,
  deriveNameFromUrl,
} from '../../engine/remote/remoteRegistry';
import { cloneRemote, cachePath } from '../../engine/remote/remoteCache';
import { RemoteRegistryError } from '../../engine/errors';

export async function runRemoteAdd(gitUrl: string, nameOption: string | undefined): Promise<void> {
  const name = nameOption ?? deriveNameFromUrl(gitUrl);

  // Check for an existing registration before cloning anything, so a
  // duplicate name fails fast without corrupting the existing entry or
  // leaving behind a stray clone.
  if (findRemote(name)) {
    throw new RemoteRegistryError(`A remote named "${name}" is already registered`);
  }

  const dest = await cloneRemote(name, gitUrl);
  addRemoteEntry({ name, url: gitUrl, addedAt: new Date().toISOString() });

  console.log(`Added remote "${name}" (${gitUrl}) -> ${dest}`);
}

/** Removes a remote's registry entry and deletes its local cache clone.
 * Deliberately doesn't touch any project's lockfile/pulled files -- those
 * are per-project and stay on disk exactly as pulled; only the ability to
 * pull/push against this remote again (until it's re-added) goes away.
 * The cache directory not existing at all (e.g. it was already deleted by
 * hand) is not an error -- there's simply nothing extra to clean up. */
export function runRemoteRemove(name: string): void {
  removeRemoteEntry(name); // throws RemoteRegistryError if not registered
  const dest = cachePath(name);
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  console.log(`Removed remote "${name}"`);
}

export function registerRemoteCommand(program: Command): void {
  const remote = program.command('remote').description('Manage registered git remotes');

  remote
    .command('add <git-url>')
    .description('Register a git remote and clone it into the local cache')
    .option('-n, --name <name>', 'Name to register the remote under')
    .action(async (gitUrl: string, options: { name?: string }) => {
      await runRemoteAdd(gitUrl, options.name);
    });

  remote
    .command('remove <name>')
    .description("Unregister a remote and delete its local cache clone (doesn't touch any project's pulled files)")
    .action((name: string) => {
      runRemoteRemove(name);
    });
}

// Re-export for convenience where only the cache path is needed.
export { cachePath };
