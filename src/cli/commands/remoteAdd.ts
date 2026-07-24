import { Command } from 'commander';
import { addRemoteEntry, findRemote } from '../../engine/remote/remoteRegistry';
import { cloneRemote, cachePath } from '../../engine/remote/remoteCache';
import { RemoteRegistryError } from '../../engine/errors';

/** Derives a remote name from the last path segment of a git URL or path,
 * stripping a trailing `.git` suffix if present. */
export function deriveNameFromUrl(url: string): string {
  const normalized = url.replace(/[/\\]+$/, ''); // trim trailing slashes
  const segments = normalized.split(/[/\\]/).filter((s) => s.length > 0);
  const last = segments[segments.length - 1] ?? normalized;
  return last.endsWith('.git') ? last.slice(0, -4) : last;
}

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

export function registerRemoteCommand(program: Command): void {
  const remote = program.command('remote').description('Manage registered git remotes');

  remote
    .command('add <git-url>')
    .description('Register a git remote and clone it into the local cache')
    .option('-n, --name <name>', 'Name to register the remote under')
    .action(async (gitUrl: string, options: { name?: string }) => {
      await runRemoteAdd(gitUrl, options.name);
    });
}

// Re-export for convenience where only the cache path is needed.
export { cachePath };
