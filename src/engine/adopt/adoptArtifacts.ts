import { GithubClient } from '../github/github';
import { AdoptionPlan } from './planAdoption';
import { ProgressCallback } from '../pull/pull';
import { withAdoptionStaging, commitAdoption } from './adoptionStaging';

/**
 * Commits an adoption plan over a client's OWN git repository as one change.
 *
 * This is the manifests-only shape: the files are already in the repository,
 * so the pull request adds N small YAML files and not one byte of content.
 * That is the difference between a change somebody can read and one they
 * rubber-stamp, and it is the entire point of `payload_path`.
 *
 * For a synced folder that is not a repository, see `mirrorAndAdopt`, which
 * copies the tree in first and then does exactly this. Both run through
 * `adoptionStaging`, so the lock, the reset, the commit and the cleanup are
 * written once.
 */

export interface AdoptionResult {
  branch: string;
  prUrl: string;
  prNumber: number;
  adopted: number;
}

/** The pull-request body: one table, not N sections. A reviewer needs to see
 * the shape of the change and spot the wrong rows, and twenty headings hide
 * both. */
function buildAdoptionPr(plan: AdoptionPlan): { title: string; body: string } {
  const rows = plan.candidates
    .map(
      (c) =>
        `| \`${c.id}\` | ${c.manifest.kind} | \`${c.sourcePath}\` | \`${c.manifest.install_target}\` |`
        + `${c.descriptionGuessed ? ' derived |' : ' from the file |'}`,
    )
    .join('\n');

  const guessed = plan.candidates.filter((c) => c.descriptionGuessed);

  const body = [
    `Registers ${plan.candidates.length} existing file(s) as artifacts.`,
    '',
    '**No content is moved or copied.** Each manifest points at the file where it',
    'already lives, via `payload_path`, so editing the original keeps working.',
    '',
    '| id | kind | file | installs to | description |',
    '|---|---|---|---|---|',
    rows,
    '',
    ...(guessed.length > 0
      ? [
        `### ${guessed.length} description(s) were derived, not declared`,
        '',
        'These came from the file\'s first heading because it declares no',
        '`description:` of its own. Worth reading before merging -- a heading is a',
        'title, and a description is meant to help somebody choose.',
        '',
        ...guessed.map((c) => `- \`${c.id}\` — "${c.manifest.description}"`),
        '',
      ]
      : []),
    ...(plan.skipped.length > 0
      ? [
        `### ${plan.skipped.length} file(s) were skipped`,
        '',
        ...plan.skipped.map((s) => `- \`${s.sourcePath}\` — ${s.reason}`),
        '',
      ]
      : []),
  ].join('\n');

  return { title: `Adopt ${plan.candidates.length} artifact(s)`, body };
}

export async function adoptArtifacts(
  plan: AdoptionPlan,
  remoteName: string,
  onProgress?: ProgressCallback,
  injectedClient?: GithubClient,
): Promise<AdoptionResult> {
  return withAdoptionStaging(remoteName, onProgress, injectedClient, async (ctx) => {
    const committed = await commitAdoption({ ctx, plan, pr: buildAdoptionPr(plan), onProgress });
    return {
      branch: committed.branch,
      prUrl: committed.prUrl,
      prNumber: committed.prNumber,
      adopted: plan.candidates.length,
    };
  });
}
