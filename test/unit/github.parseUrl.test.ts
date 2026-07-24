import { describe, it, expect } from 'vitest';
import { parseGithubUrl } from '../../src/engine/github/github';
import { UnsupportedRemoteError } from '../../src/engine/errors';

describe('parseGithubUrl', () => {
  it('parses an SSH URL with a .git suffix', () => {
    expect(parseGithubUrl('git@github.com:owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses an SSH URL without a .git suffix', () => {
    expect(parseGithubUrl('git@github.com:owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses an HTTPS URL without a .git suffix', () => {
    expect(parseGithubUrl('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses an HTTPS URL with a .git suffix', () => {
    expect(parseGithubUrl('https://github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses owner/repo names containing hyphens and dots', () => {
    expect(parseGithubUrl('https://github.com/my-org/my.repo-name.git')).toEqual({
      owner: 'my-org',
      repo: 'my.repo-name',
    });
  });

  it('throws UnsupportedRemoteError for a non-GitHub HTTPS URL', () => {
    expect(() => parseGithubUrl('https://gitlab.com/owner/repo')).toThrow(
      UnsupportedRemoteError,
    );
  });

  it('throws UnsupportedRemoteError for a bare local filesystem path', () => {
    expect(() => parseGithubUrl('/some/local/path')).toThrow(UnsupportedRemoteError);
  });

  it('throws UnsupportedRemoteError for a non-GitHub SSH-style URL', () => {
    expect(() => parseGithubUrl('git@gitlab.com:owner/repo.git')).toThrow(
      UnsupportedRemoteError,
    );
  });
});
