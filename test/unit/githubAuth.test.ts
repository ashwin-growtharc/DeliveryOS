import { describe, it, expect, vi, beforeEach } from 'vitest';

// getGithubToken shells out to the ambient `gh` CLI -- mocked here the same
// way runClaudeSubprocess.test.ts mocks `child_process`, since a real `gh`
// invocation depends on this machine's own auth state (not hermetic/
// repeatable) and every real e2e test in this repo explicitly stubs this
// function out rather than exercising it for real (see
// test/e2e/push.cliFlags.e2e.test.ts's own `getGithubToken: () => 'fake-token...'`
// override) -- meaning none of this function's 3 real branches were ever
// actually run anywhere before this file.
const execFileSyncMock = vi.fn();
vi.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

const { getGithubToken } = await import('../../src/engine/github/githubAuth');
const { GithubAuthError } = await import('../../src/engine/errors');

beforeEach(() => {
  execFileSyncMock.mockReset();
});

describe('getGithubToken', () => {
  it('returns the trimmed token on success', () => {
    execFileSyncMock.mockReturnValue('ghp_realtoken123\n');
    expect(getGithubToken()).toBe('ghp_realtoken123');
  });

  it('calls "gh auth token" via execFileSync with array args (never a shell string)', () => {
    execFileSyncMock.mockReturnValue('token');
    getGithubToken();
    expect(execFileSyncMock).toHaveBeenCalledWith('gh', ['auth', 'token'], { encoding: 'utf-8' });
  });

  it('throws GithubAuthError pointing at "gh auth login" when gh is not installed / execFileSync throws', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('spawnSync gh ENOENT');
    });
    expect(() => getGithubToken()).toThrow(GithubAuthError);
    expect(() => getGithubToken()).toThrow(/gh auth login/);
  });

  it('throws GithubAuthError when gh returns an empty token (not logged in)', () => {
    execFileSyncMock.mockReturnValue('   \n');
    expect(() => getGithubToken()).toThrow(GithubAuthError);
    expect(() => getGithubToken()).toThrow(/empty token/);
  });
});
