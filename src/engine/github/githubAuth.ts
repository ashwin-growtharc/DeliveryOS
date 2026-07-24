import { execFileSync } from 'child_process';
import { GithubAuthError } from '../errors';

/**
 * Obtains a GitHub token from the ambient `gh` CLI -- no custom auth flow,
 * no stored credentials of our own. Uses `execFileSync` (array args, not a
 * shell string) so nothing here is vulnerable to shell injection.
 *
 * Throws GithubAuthError (pointing the user at `gh auth login`) if `gh`
 * isn't installed, isn't logged in, or otherwise fails to produce a token.
 */
export function getGithubToken(): string {
  let output: string;
  try {
    output = execFileSync('gh', ['auth', 'token'], { encoding: 'utf-8' });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new GithubAuthError(
      `Failed to get a GitHub token via "gh auth token": ${detail}. Run "gh auth login" and try again.`,
    );
  }

  const token = output.trim();
  if (token.length === 0) {
    throw new GithubAuthError(
      '"gh auth token" returned an empty token. Run "gh auth login" and try again.',
    );
  }

  return token;
}
