import * as path from 'path';
import { Command } from 'commander';
import { readAdoptionProfile } from '../../engine/adopt/profile';
import { AdoptionPlan } from '../../engine/adopt/planAdoption';
import { mirrorAndAdopt, planMirrorAndAdopt } from '../../engine/adopt/mirrorAndAdopt';

/**
 * The command that makes adoption something a person can run.
 *
 * Until this existed, `mirrorAndAdopt` -- the function that turns a client's
 * synced SharePoint folder into a catalog -- had no callers outside the test
 * suite. The whole client-shaped direction was proven end to end and reachable
 * by nobody.
 *
 * WHY `--dry-run` IS THE ENGINE'S PLAN, NOT THIS FILE'S
 *
 * `planMirrorAndAdopt` runs the same staging and the same plan code the real
 * run does, on the same tree, and then puts the cache back. An earlier version
 * of this command rebuilt the plan by hand in a temp directory; it worked, and
 * it was a second code path that could drift from the first -- a preview that
 * lies about the thing it previews is worse than no preview. This file only
 * prints.
 *
 * WHY THIS IS CLI-ONLY
 *
 * Not on the MCP server, deliberately. An agent-callable tool that opens a
 * pull request containing a client's entire folder is a far larger
 * authorisation surface than v1 needs. A person runs this, once per client,
 * having read the dry run.
 */

interface AdoptFlags {
  profile: string;
  dryRun?: boolean;
}

function describeCandidates(plan: AdoptionPlan): string[] {
  const lines: string[] = [];
  const idWidth = Math.max(...plan.candidates.map((c) => c.id.length), 2);
  const kindWidth = Math.max(...plan.candidates.map((c) => c.manifest.kind.length), 4);
  for (const c of plan.candidates) {
    lines.push(
      `  ${c.id.padEnd(idWidth)}  ${c.manifest.kind.padEnd(kindWidth)}  `
        + `${c.sourcePath} -> ${c.manifest.install_target}`
        + (c.descriptionGuessed ? '  (description derived)' : ''),
    );
  }
  return lines;
}

function describeSkipped(plan: AdoptionPlan, verb: string): string[] {
  if (plan.skipped.length === 0) return [];
  return [
    '',
    `${plan.skipped.length} file(s) ${verb} copied but not adopted:`,
    ...plan.skipped.map((s) => `  - ${s.sourcePath} -- ${s.reason}`),
  ];
}

export function registerAdoptCommand(program: Command): void {
  program
    .command('adopt <folder>')
    .description(
      'Mirror a folder -- typically a synced SharePoint, OneDrive or Drive library -- into a git '
        + 'catalog and propose its files as artifacts, in one pull request. Decisions about kind, '
        + 'install target and tags come from the profile, per folder, never guessed.',
    )
    .requiredOption(
      '--profile <file>',
      'YAML adoption profile: the remote to propose into, the owner, and one rule per folder '
        + 'saying what its files are and where they install',
    )
    .option(
      '--dry-run',
      'Show what would be adopted and stop. No branch is made and no pull request is opened; '
        + 'the catalog cache is used as a workbench and put back afterwards',
    )
    .action(async (folder: string, flags: AdoptFlags) => {
      const profile = readAdoptionProfile(flags.profile);
      const remoteName = profile.remote;
      const sourceFolder = path.resolve(folder);
      const progress = (_stage: string, message: string): void => {
        console.log(message);
      };

      if (flags.dryRun) {
        const { sourceLabel, mirror, plan } = await planMirrorAndAdopt(sourceFolder, profile, remoteName, progress);

        console.log('');
        console.log(
          `Would adopt ${plan.candidates.length} artifact(s) from "${sourceLabel}" into "${remoteName}", `
            + `copying ${mirror.written.length} file(s):`,
        );
        console.log('');
        for (const line of describeCandidates(plan)) console.log(line);

        const guessed = plan.candidates.filter((c) => c.descriptionGuessed);
        if (guessed.length > 0) {
          console.log('');
          console.log(
            `${guessed.length} description(s) would be derived from the file's first heading `
              + 'rather than declared -- worth reading before you open the pull request:',
          );
          for (const c of guessed) console.log(`  - ${c.id}: "${c.manifest.description}"`);
        }
        for (const line of describeSkipped(plan, 'would be')) console.log(line);
        if (mirror.unreadable.length > 0) {
          console.log('');
          console.log(`${mirror.unreadable.length} file(s) could not be read (not downloaded yet?):`);
          for (const f of mirror.unreadable) console.log(`  - ${f}`);
        }
        console.log('');
        console.log('Nothing was written. Drop --dry-run to open the pull request.');
        return;
      }

      const result = await mirrorAndAdopt(sourceFolder, profile, remoteName, progress);

      console.log(`Opened PR #${result.prNumber}: ${result.prUrl} (branch ${result.branch})`);
      console.log(
        `${result.mirrored} file(s) copied, ${result.adopted} adopted, `
          + `${result.notAdopted} copied but not adopted.`,
      );
      if (result.unreadable.length > 0) {
        console.log(`${result.unreadable.length} file(s) could not be read -- see the pull request body.`);
      }
    });
}
