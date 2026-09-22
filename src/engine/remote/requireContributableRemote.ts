import { findRemote, RemoteEntry } from './remoteRegistry';
import { backendFor } from './backends';
import { parseGithubUrl } from '../github/github';
import { RemoteRegistryError, UnsupportedRemoteError } from '../errors';

/**
 * The one answer to "can this remote take a contribution?"
 *
 * Four places asked it, three different ways. `push` checked the backend's
 * `opensPullRequests` capability with one message; `mirrorAndAdopt` checked the
 * same flag with a different message; `planPush` called `parseGithubUrl` purely
 * for its throw, so a *preview* against a folder library failed with "not a
 * recognizable github.com URL" -- the exact unhelpful message the capability
 * flag was introduced to replace, and the exact plan/apply disagreement
 * `planPush`'s own comment says it exists to prevent. `adoptArtifacts` never
 * checked the flag at all.
 *
 * Two checks, in this order, because they answer different questions:
 *
 * 1. Can this KIND of remote hold a proposal at all? A folder cannot: there is
 *    nowhere for a change to sit while the original stays untouched, and
 *    nothing that can later be asked whether it was merged. That is the
 *    capability check, and its message names the real problem.
 * 2. Can DeliveryOS open a pull request on THIS host? Today that means
 *    github.com; `parseGithubUrl` refuses anything else, and also yields the
 *    owner and repo every caller goes on to need.
 *
 * Returns the entry alongside owner/repo so callers make one call, not three.
 */
export interface ContributableRemote {
  entry: RemoteEntry;
  owner: string;
  repo: string;
}

export function requireContributableRemote(remoteName: string): ContributableRemote {
  const entry = findRemote(remoteName);
  if (!entry) {
    throw new RemoteRegistryError(`No remote named "${remoteName}" is registered`);
  }

  const backend = backendFor(entry.backend);
  if (!backend.capabilities.opensPullRequests) {
    throw new UnsupportedRemoteError(
      `"${remoteName}" is a ${backend.kind} library and cannot receive a mirror or a contribution -- `
        + 'a change needs somewhere it can be reviewed before it lands, and a folder has no such place. '
        + 'Reading from it and installing out of it work.',
    );
  }

  const { owner, repo } = parseGithubUrl(entry.url);
  return { entry, owner, repo };
}
