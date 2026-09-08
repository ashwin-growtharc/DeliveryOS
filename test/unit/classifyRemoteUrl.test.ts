import { describe, it, expect } from 'vitest';
import { classifyRemoteUrl } from '../../src/engine/remote/classifyRemoteUrl';
import { parseGithubUrl } from '../../src/engine/github/github';
import { remoteCachePath } from '../../src/engine/paths';
import { DeliveryOsError } from '../../src/engine/errors';

/**
 * "The client will send us a link" is the scenario these guard.
 *
 * Until now the first thing in DeliveryOS to look at a URL was `git clone`, so
 * a pasted SharePoint link produced git's own stderr -- accurate, and no help.
 * These tests pin the refusals that replaced that, and, more importantly, pin
 * the URLs that must NOT be refused.
 *
 * WHY THE "STILL ACCEPTED" BLOCK IS THE LOAD-BEARING ONE
 *
 * The risk here is asymmetric. Missing a non-git URL costs a confusing error
 * message, which is what already happened. Wrongly refusing a real git URL
 * breaks a working customer setup. `git clone` accepts GitLab, Bitbucket,
 * Azure DevOps, self-hosted hosts on bare hostnames, `ssh://`, `git://`,
 * `file://`, Windows drive paths and plain local directories -- and the entire
 * e2e suite depends on that last one.
 *
 * So the classifier is a denylist, against this codebase's usual habit, and
 * the tests are weighted the same way: a handful of positive refusals, and a
 * long list of things that must keep working.
 */

describe('classifying a URL a client might paste', () => {
  it('refuses cloud storage links, naming the service and what to do instead', () => {
    const cases: Array<[string, string]> = [
      ['https://contoso.sharepoint.com/sites/HR/Shared%20Documents', 'SharePoint'],
      ['https://1drv.ms/f/s!AbCdEf', 'OneDrive'],
      ['https://onedrive.live.com/redir?resid=123', 'OneDrive'],
      ['https://drive.google.com/drive/folders/1AbCdEf', 'Google Drive'],
      ['https://www.dropbox.com/sh/abc123/AAA', 'Dropbox'],
    ];

    for (const [url, service] of cases) {
      const verdict = classifyRemoteUrl(url);
      expect(verdict.supported, url).toBe(false);
      if (verdict.supported) continue;
      // The service is named, because "unsupported URL" tells nobody anything.
      expect(verdict.reason, url).toContain(service);
      // And the advice is present, which is the whole reason this exists.
      expect(verdict.reason, url).toContain('sync client');
      expect(verdict.reason, url).toContain('remote add');
    }
  });

  it('refuses a link to a folder INSIDE a repo, and hands back the repo URL', () => {
    // The shape you get by copying a browser URL while looking at a folder --
    // which is exactly how someone sends "the link to our artifacts".
    const verdict = classifyRemoteUrl('https://github.com/acme/artifacts/tree/main/skills');
    expect(verdict.supported).toBe(false);
    if (verdict.supported) return;
    // Not just a refusal: the corrected URL, so it can be copied.
    expect(verdict.reason).toContain('https://github.com/acme/artifacts');
    expect(verdict.reason).not.toContain('/tree/');
  });

  it('recognises the same mistake on GitLab and Bitbucket, which spell it differently', () => {
    // GitLab uses `/-/tree/`, Bitbucket uses `/src/`. The advice is identical,
    // so the pattern covers all three rather than special-casing github.com.
    expect(classifyRemoteUrl('https://gitlab.com/acme/artifacts/-/tree/main').supported).toBe(false);
    expect(classifyRemoteUrl('https://bitbucket.org/acme/artifacts/src/main/').supported).toBe(false);
  });

  it('gives an empty URL a message about what to type, not about path segments', () => {
    const verdict = classifyRemoteUrl('   ');
    expect(verdict.supported).toBe(false);
    if (verdict.supported) return;
    expect(verdict.reason).toContain('No URL given');
    expect(verdict.reason).toContain('deliveryos remote add');
  });

  describe('URLs that must keep working', () => {
    // This block is the point of the file. Each of these is a setup somebody
    // could have today, and refusing any of them is a regression that a
    // "helpful error message" feature has no business causing.
    const stillAccepted = [
      'https://github.com/acme/artifacts',
      'https://github.com/acme/artifacts.git',
      'git@github.com:acme/artifacts.git',
      'https://gitlab.com/acme/artifacts.git',
      'https://bitbucket.org/acme/artifacts.git',
      'https://dev.azure.com/org/project/_git/artifacts',
      'https://git.internal.acme/artifacts.git',
      'ssh://git@git.internal.acme:2222/artifacts.git',
      'git://example.invalid/artifacts.git',
      'file:///home/me/artifacts',
      'C:/Users/me/artifacts',
      'C:\\Users\\me\\artifacts',
      '/home/me/artifacts',
      './artifacts',
      '../artifacts',
      'artifacts',
    ];

    for (const url of stillAccepted) {
      it(`accepts ${url}`, () => {
        expect(classifyRemoteUrl(url).supported).toBe(true);
      });
    }

    it('accepts a repo whose own path collides with a browse verb', () => {
      // The deep-link check is a heuristic over path segments, and real
      // repositories are allowed to contain those words. A `.git` suffix is a
      // positive statement that this is a clone URL, so it wins outright...
      expect(classifyRemoteUrl('https://gitlab.com/org/src/project.git').supported).toBe(true);
      expect(classifyRemoteUrl('https://git.acme.dev/tree/planting.git').supported).toBe(true);
      // ...and `src` is only Bitbucket's browse verb, so it is not applied to
      // hosts where it is just a directory name.
      expect(classifyRemoteUrl('https://gitlab.com/org/src/project').supported).toBe(true);
    });

    it('is not fooled by a repository merely named after a cloud service', () => {
      // Matched on hostname, never on the whole string -- otherwise a genuine
      // repo called "sharepoint-migration" would be refused.
      expect(classifyRemoteUrl('https://github.com/acme/sharepoint-migration.git').supported)
        .toBe(true);
      expect(classifyRemoteUrl('git@github.com:acme/dropbox-sync.git').supported).toBe(true);
    });
  });
});

describe('parseGithubUrl and deep links', () => {
  it('refuses a repo path with extra segments instead of silently absorbing them', () => {
    // Before this, the repo group was `.+?`, so this parsed as
    // owner "acme", repo "artifacts/tree/main/skills" -- no refusal, just a
    // baffling 404 from the GitHub API much later.
    expect(() => parseGithubUrl('https://github.com/acme/artifacts/tree/main/skills')).toThrow(
      /not a recognizable github\.com URL/,
    );
    expect(() => parseGithubUrl('git@github.com:acme/artifacts/tree/main')).toThrow(
      /not a recognizable github\.com URL/,
    );
  });

  it('still parses every ordinary form', () => {
    // The counterweight: the fix tightened a regex, so the accepted shapes
    // need pinning or the next tightening breaks them silently.
    expect(parseGithubUrl('https://github.com/acme/artifacts')).toEqual({
      owner: 'acme',
      repo: 'artifacts',
    });
    expect(parseGithubUrl('https://github.com/acme/artifacts.git')).toEqual({
      owner: 'acme',
      repo: 'artifacts',
    });
    expect(parseGithubUrl('https://github.com/acme/artifacts/')).toEqual({
      owner: 'acme',
      repo: 'artifacts',
    });
    expect(parseGithubUrl('git@github.com:acme/artifacts.git')).toEqual({
      owner: 'acme',
      repo: 'artifacts',
    });
  });
});

describe('an invalid path segment is a DeliveryOS error, not a crash', () => {
  it('throws DeliveryOsError so the CLI prints a message instead of a stack', () => {
    // `src/index.ts` prints `error.message` and exits 1 for a DeliveryOsError,
    // and `err.stack` for anything else. This threw a bare Error, so
    // `deliveryos remote add ""` -- a plain typo -- printed a Node stack trace.
    expect(() => remoteCachePath('')).toThrow(DeliveryOsError);
    expect(() => remoteCachePath('')).toThrow(/Invalid remote name/);
    expect(() => remoteCachePath('../escape')).toThrow(DeliveryOsError);
  });
});
