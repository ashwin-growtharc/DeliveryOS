import simpleGit from 'simple-git';
import * as fs from 'fs';
import { GitOperationError } from '../errors';

/**
 * Thin wrapper around simple-git. Clones `url` into `dest` (which must not
 * already exist). On failure, any partial directory created by the clone
 * attempt is removed and git's own stderr/message is bubbled up.
 */
export async function cloneTo(url: string, dest: string): Promise<void> {
  const git = simpleGit();
  try {
    await git.clone(url, dest);
  } catch (err) {
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new GitOperationError(message);
  }
}
