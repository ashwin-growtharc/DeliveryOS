import * as path from 'path';
import { GithubClient } from '../github/github';
import { ProgressCallback } from '../pull/pull';
import { buildCatalog } from '../catalog/catalog';
import { AdoptionProfile } from './profile';
import { planAdoption, AdoptionPlan } from './planAdoption';
import { mirrorFolder, MirrorResult } from './mirrorFolder';
import { withAdoptionStaging, commitAdoption, StagingContext } from './adoptionStaging';

/**
 * Takes a client's folder -- typically a synced SharePoint, OneDrive or Drive
 * directory -- and turns it into a usable catalog in one operation.
 *
 * WHY MIRROR AND ADOPT ARE ONE PULL REQUEST AND NOT TWO
 *
 * They could be separate: copy the files, then lay the manifests over them.
 * They are not, for two reasons.
 *
 * A mirror on its own produces a repository full of documents that DeliveryOS
 * still cannot read -- `discoverManifests` finds nothing without an
 * `artifacts/` directory. Asking somebody to review and merge that is asking
 * them to approve a change with no observable effect, which is how a review
 * becomes a rubber stamp.
 *
 * And in between the two, the catalog would be in a state that is neither the
 * old thing nor the new one. Landing both together means the repository is
 * always either "not adopted" or "adopted", never halfway.
 *
 * WHAT THIS COSTS, STATED PLAINLY
 *
 * The pull request contains content, not just manifests. That is the honest
 * difference between adopting a client's git repository -- where the files are
 * already there, and the diff really is only manifests -- and mirroring from
 * storage that cannot host a catalog. Worth knowing before opening it: this
 * diff is as large as the client's folder.
 *
 * ONE PLAN PATH FOR THE PREVIEW AND THE RUN
 *
 * `planMirrorAndAdopt` and `mirrorAndAdopt` share `planInStaging`, so a dry
 * run cannot describe a plan the real run would not commit. The dry run used
 * to mirror into an empty temp directory while the run mirrored onto the
 * cache; the two trees differed, and so could the plans.
 */

export interface MirrorAndAdoptPlan {
  sourceLabel: string;
  mirror: MirrorResult;
  plan: AdoptionPlan;
}

export interface MirrorAndAdoptResult {
  branch: string;
  prUrl: string;
  prNumber: number;
  mirrored: number;
  adopted: number;
  /** Files copied but not adopted -- no rule matched them, or they could not
   * describe themselves. They are in the repository and simply are not
   * artifacts, which is a normal outcome worth reporting rather than hiding. */
  notAdopted: number;
  unreadable: string[];
}

/**
 * Mirrors the source into the staged cache and plans against the MIRRORED
 * tree, not the source. Reading the copy is what guarantees the plan describes
 * what will actually be committed rather than what was on the client's disk a
 * moment ago -- and the copy is what drops the sync client's debris.
 */
function planInStaging(
  ctx: StagingContext,
  sourceFolder: string,
  profile: AdoptionProfile,
  onProgress?: ProgressCallback,
): MirrorAndAdoptPlan {
  const sourceLabel = path.basename(path.resolve(sourceFolder));

  onProgress?.('mirror', `Copying "${sourceLabel}"...`);
  const mirror = mirrorFolder(sourceFolder, ctx.cacheDir);

  onProgress?.('plan', 'Working out what can become an artifact...');
  const existing = buildCatalog()
    .filter((e) => e.remoteName === ctx.remoteName)
    .map((e) => e.manifest.id);
  const plan = planAdoption(ctx.cacheDir, profile, existing, ctx.remoteEntry.url, { files: mirror.written });

  return { sourceLabel, mirror, plan };
}

/**
 * What `mirrorAndAdopt` would commit, without committing it.
 *
 * Runs inside the same staging as the real thing -- the cache is mirrored into
 * and then put back on the remote's tip by the staging's `finally` -- so the
 * preview is computed by the code that would do the work, on the tree it would
 * do it to. Needs no GitHub token: the staging only reaches GitHub when a
 * caller asks to commit.
 */
export async function planMirrorAndAdopt(
  sourceFolder: string,
  profile: AdoptionProfile,
  remoteName: string,
  onProgress?: ProgressCallback,
): Promise<MirrorAndAdoptPlan> {
  return withAdoptionStaging(remoteName, onProgress, undefined, async (ctx) =>
    planInStaging(ctx, sourceFolder, profile, onProgress),
  );
}

function buildPr(
  sourceLabel: string,
  plan: AdoptionPlan,
  mirroredCount: number,
  unreadable: string[],
): { title: string; body: string } {
  const guessed = plan.candidates.filter((c) => c.descriptionGuessed);

  const body = [
    `Mirrors \`${sourceLabel}\` into this catalog and registers ${plan.candidates.length} of its`,
    'files as artifacts.',
    '',
    `**${mirroredCount} file(s) copied.** The client's own folder structure is preserved at the`,
    'repository root, and each manifest points back at a file through `payload_path` rather',
    'than duplicating it.',
    '',
    '| id | kind | file | installs to | description |',
    '|---|---|---|---|---|',
    ...plan.candidates.map(
      (c) =>
        `| \`${c.id}\` | ${c.manifest.kind} | \`${c.sourcePath}\` | \`${c.manifest.install_target}\` | `
        + `${c.descriptionGuessed ? 'derived' : 'from the file'} |`,
    ),
    '',
    ...(guessed.length > 0
      ? [
        `### ${guessed.length} description(s) were derived, not declared`,
        '',
        'Taken from the file\'s first heading, because it declares none of its own. A heading is',
        'a title; a description is meant to help somebody choose. Worth reading before merging.',
        '',
        ...guessed.map((c) => `- \`${c.id}\` — "${c.manifest.description}"`),
        '',
      ]
      : []),
    ...(plan.skipped.length > 0
      ? [
        `### ${plan.skipped.length} file(s) were copied but not adopted`,
        '',
        ...plan.skipped.map((s) => `- \`${s.sourcePath}\` — ${s.reason}`),
        '',
      ]
      : []),
    ...(unreadable.length > 0
      ? [
        `### ${unreadable.length} file(s) could not be read`,
        '',
        'If this folder syncs from the cloud, these may not be downloaded yet. Open them once',
        'in the sync client and re-run.',
        '',
        ...unreadable.map((f) => `- \`${f}\``),
        '',
      ]
      : []),
  ].join('\n');

  return { title: `Adopt ${plan.candidates.length} artifact(s) from ${sourceLabel}`, body };
}

export async function mirrorAndAdopt(
  sourceFolder: string,
  profile: AdoptionProfile,
  remoteName: string,
  onProgress?: ProgressCallback,
  injectedClient?: GithubClient,
): Promise<MirrorAndAdoptResult> {
  return withAdoptionStaging(remoteName, onProgress, injectedClient, async (ctx) => {
    const { sourceLabel, mirror, plan } = planInStaging(ctx, sourceFolder, profile, onProgress);

    const committed = await commitAdoption({
      ctx,
      plan,
      pr: buildPr(sourceLabel, plan, mirror.written.length, mirror.unreadable),
      extraPaths: mirror.written,
      onProgress,
    });

    return {
      branch: committed.branch,
      prUrl: committed.prUrl,
      prNumber: committed.prNumber,
      mirrored: mirror.written.length,
      adopted: plan.candidates.length,
      notAdopted: plan.skipped.length,
      unreadable: mirror.unreadable,
    };
  });
}
