import { Command } from 'commander';
import { listRemotes } from '../../engine/remote/remoteRegistry';
import { addRemote, removeRemote } from '../../engine/remote/manageRemotes';

export async function runRemoteAdd(gitUrl: string, nameOption: string | undefined): Promise<void> {
  // Orchestration lives in `engine/remote/manageRemotes.ts` -- it was
  // duplicated here and in the sidecar, and the sidecar's copy said so.
  const { name, url, dest } = await addRemote(gitUrl, nameOption);
  console.log(`Added remote "${name}" (${url}) -> ${dest}`);
}

/** Removes a remote's registry entry and deletes its local cache clone.
 * Deliberately doesn't touch any project's lockfile/pulled files -- those
 * are per-project and stay on disk exactly as pulled; only the ability to
 * pull/push against this remote again (until it's re-added) goes away.
 * The cache directory not existing at all (e.g. it was already deleted by
 * hand) is not an error -- there's simply nothing extra to clean up. */
export async function runRemoteRemove(name: string): Promise<void> {
  await removeRemote(name); // throws RemoteRegistryError if not registered
  console.log(`Removed remote "${name}"`);
}

/** Prints every registered remote -- the CLI's only prior way to see this
 * was reading `~/.deliveryos/remotes.json` by hand, even though the
 * sidecar's own `remote.list` RPC has always had this (a real CLI/sidecar
 * parity gap: the app can list its own remotes, a CLI-only user couldn't). */
export function runRemoteList(json: boolean): void {
  const remotes = listRemotes();
  if (json) {
    console.log(JSON.stringify(remotes));
    return;
  }
  if (remotes.length === 0) {
    console.log('No remotes registered.');
    return;
  }
  for (const remote of remotes) {
    console.log(`${remote.name}  ${remote.url}  (added ${remote.addedAt})`);
  }
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
    .action(async (name: string) => {
      await runRemoteRemove(name);
    });

  remote
    .command('list')
    .description('List every registered remote')
    .option('--json', 'Output as JSON instead of a human-readable listing')
    .action((options: { json?: boolean }) => {
      runRemoteList(Boolean(options.json));
    });
}
