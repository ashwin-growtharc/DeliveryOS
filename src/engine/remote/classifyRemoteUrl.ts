/**
 * Recognises URLs that are definitely NOT git remotes, so `remote add` can
 * refuse them in DeliveryOS's own words instead of handing the user git's
 * stderr.
 *
 * WHY THIS IS A DENYLIST, WHEN THIS CODEBASE PREFERS ALLOWLISTS
 *
 * Everywhere else -- `RISKY_CAPABILITIES_ALLOWED_ON_MCP`, the read-port method
 * list -- the rule is "name what is permitted". Here it is inverted, and the
 * inversion is deliberate.
 *
 * `git clone` accepts far more than github.com: GitLab, Bitbucket, Azure
 * DevOps, self-hosted GitLab on a bare hostname, `ssh://`, `git://`, `file://`,
 * a plain local directory (which the entire e2e suite depends on), and a
 * `~`-relative path. An allowlist would have to enumerate all of that, and
 * anything it missed would be a working setup that suddenly broke. The failure
 * mode of guessing wrong is therefore asymmetric: refusing a real git URL
 * breaks a customer, while missing one non-git URL just means they see git's
 * error like they do today.
 *
 * So this only ever fires on shapes that cannot possibly be a git remote, and
 * everything unrecognised falls through to git exactly as before.
 */

/** A verdict, not an exception, so the message can be unit-tested without a
 * try/catch and without touching the filesystem. */
export type RemoteUrlVerdict =
  | { supported: true }
  | { supported: false; reason: string };

/** The advice every cloud-storage refusal ends with. Kept in one place because
 * three refusals share it, and because the wording is the product here -- it is
 * the only thing standing between "a SharePoint link fails" and "a SharePoint
 * link fails and the user knows what to do". */
function syncedFolderAdvice(service: string): string {
  return (
    `That looks like a ${service} link, and DeliveryOS cannot read one directly. `
    + `${service} content reaches this machine through the sync client as an ordinary `
    + 'folder, so point DeliveryOS at that folder instead -- for example: '
    + 'deliveryos remote add "C:/Users/you/Contoso/Shared Documents/Artifacts"'
  );
}

/** Host suffixes that are unambiguously cloud storage rather than git hosting.
 * Matched against the hostname only, so a repository merely NAMED "sharepoint"
 * is unaffected. */
const CLOUD_STORAGE_HOSTS: Array<{ suffix: string; service: string }> = [
  { suffix: 'sharepoint.com', service: 'SharePoint' },
  { suffix: 'onedrive.live.com', service: 'OneDrive' },
  { suffix: '1drv.ms', service: 'OneDrive' },
  { suffix: 'drive.google.com', service: 'Google Drive' },
  { suffix: 'docs.google.com', service: 'Google Docs' },
  { suffix: 'dropbox.com', service: 'Dropbox' },
  { suffix: 'box.com', service: 'Box' },
];

/**
 * Classifies a would-be remote URL.
 *
 * Returns `{ supported: true }` for anything it does not positively recognise
 * as unsupported -- see the denylist note above.
 */
export function classifyRemoteUrl(url: string): RemoteUrlVerdict {
  const trimmed = url.trim();

  // Checked here as well as in `assertSafePathSegment`, because the message
  // matters. The path-segment guard says `Invalid remote name: ""`, which is
  // true and tells a user nothing about what they typed.
  if (trimmed.length === 0) {
    return {
      supported: false,
      reason:
        'No URL given. Pass a git URL or the path to a folder on this machine, '
        + 'for example: deliveryos remote add https://github.com/acme/artifacts',
    };
  }

  // Only http(s) URLs are inspected further. Anything else -- an SSH remote, a
  // Windows drive path, a bare hostname, `file://` -- is git's business.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { supported: true };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { supported: true };
  }

  const host = parsed.hostname.toLowerCase();

  const cloud = CLOUD_STORAGE_HOSTS.find(
    (entry) => host === entry.suffix || host.endsWith(`.${entry.suffix}`),
  );
  if (cloud) {
    return { supported: false, reason: syncedFolderAdvice(cloud.service) };
  }

  // A `.git` suffix is a positive statement that this IS a clone URL, so stop
  // here. Checked first because the deep-link patterns below are heuristics
  // over path segments, and a real repository is allowed to have a group or a
  // name that collides with one -- `https://gitlab.com/org/src/project.git`
  // has a group called `src` and must keep working.
  if (parsed.pathname.replace(/\/$/, '').toLowerCase().endsWith('.git')) {
    return { supported: true };
  }

  // A link to something INSIDE a repository rather than the repository itself.
  // This is the shape you get by copying a browser URL while looking at a
  // folder, which is exactly how a colleague hands over "the link to our
  // artifacts". `parseGithubUrl` now refuses these too, but that only runs at
  // push time -- catching it here means the remote is never registered against
  // a URL that cannot open a pull request.
  //
  // `tree` and `blob` are safe to check on any host: they are the browse verbs
  // for GitHub and (as `-/tree`) GitLab, and no clone URL contains them.
  // `src` is Bitbucket's browse verb but also a perfectly ordinary directory
  // name, so it is scoped to bitbucket hosts rather than applied everywhere.
  const browseVerbs = /\/(tree|blob|-\/tree|-\/blob)\//;
  const bitbucketBrowse = /\/src\//;
  const isBitbucket = host === 'bitbucket.org' || host.endsWith('.bitbucket.org');

  const deepLink =
    parsed.pathname.match(browseVerbs)
    ?? (isBitbucket ? parsed.pathname.match(bitbucketBrowse) : null);
  if (deepLink) {
    const repoRoot = `${parsed.origin}${parsed.pathname.slice(0, deepLink.index)}`;
    return {
      supported: false,
      reason:
        'That is a link to a folder inside a repository, not to the repository itself. '
        + `Use the repository URL instead: ${repoRoot}`,
    };
  }

  return { supported: true };
}
