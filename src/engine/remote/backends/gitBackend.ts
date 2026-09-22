import * as fs from 'fs';
import * as path from 'path';
import { cloneTo, fetchAndReset } from '../../git/git';
import { RemoteBackend } from './types';

/**
 * The backend DeliveryOS has always had, now behind the port rather than wired
 * into `remoteCache`.
 *
 * Every line here is the existing behaviour moved, not changed -- including the
 * `FETCH_HEAD`-then-`.git` fallback in `lastChangedAt`, which is why its comment
 * came with it.
 */
export const gitBackend: RemoteBackend = {
  kind: 'git',

  capabilities: {
    // A branch, a commit and a pull request that can later be asked whether it
    // was merged. This is the only backend that can express a proposal.
    opensPullRequests: true,
    hasVersionHistory: true,
    // `fetchAndReset` is a single `checkout -B` plus `reset --hard` under the
    // cache lock, so a reader either sees the old tree or the new one.
    supportsAtomicWrite: true,
  },

  materialize(source, dest) {
    return cloneTo(source, dest);
  },

  refresh(dest) {
    return fetchAndReset(dest);
  },

  /**
   * Derived from the clone rather than recorded anywhere, because git already
   * keeps it: `git fetch` rewrites `.git/FETCH_HEAD` every time, so its mtime IS
   * the last-fetch time. A fresh `clone` does not always write that file, so the
   * `.git` directory itself is the fallback -- for a never-refreshed remote,
   * "when it was cloned" is the right answer anyway.
   */
  lastChangedAt(dest) {
    const gitDir = path.join(dest, '.git');
    for (const candidate of [path.join(gitDir, 'FETCH_HEAD'), gitDir]) {
      try {
        return fs.statSync(candidate).mtime;
      } catch {
        // Try the next candidate. A missing FETCH_HEAD is normal on a fresh
        // clone; a missing .git means there is no usable cache at all, which the
        // final `undefined` reports honestly.
      }
    }
    return undefined;
  },
};
