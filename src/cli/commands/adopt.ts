import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { readAdoptionProfile } from '../../engine/adopt/profile';
import { planAdoption, AdoptionPlan } from '../../engine/adopt/planAdoption';
import { mirrorFolder } from '../../engine/adopt/mirrorFolder';
import { mirrorAndAdopt, resolveAdoptionTarget } from '../../engine/adopt/mirrorAndAdopt';
import { buildCatalog } from '../../engine/catalog/catalog';
import { AdoptionPlanError } from '../../engine/errors';

/**
 * The command that makes adoption something a person can run.
 *
 * Until this existed, `mirrorAndAdopt` -- the function that turns a client's
 * synced SharePoint folder into a catalog -- had no callers outside the test
 * suite. The whole client-shaped direction was proven end to end and reachable
 * by nobody.
 *
 * WHY `--dry-run` GOES THROUGH THE SAME MIRROR
 *
 * A dry run could plan against the source folder directly. It does not: it
 * mirrors into a temporary directory and plans against THAT, exactly as the
 * real run plans against the mirrored tree in the cache. The mirror is what
 * drops the sync client's debris, so planning against the raw folder would
 * show `~$escalation.md` as a candidate the real run would never produce -- a
 * preview that lies about the thing it previews.
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
  remote?: string;
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
      'YAML adoption profile: the remote, the owner, and one rule per folder saying what its files '
        + 'are and where they install',
    )
    .option(
      '-r, --remote <name>',
      'Catalog to propose into. Defaults to the profile\'s own `remote`; if both are given they '
        + 'must agree',
    )
    .option(
      '--dry-run',
      'Show what would be adopted and stop. Nothing is copied into the catalog, no branch is made, '
        + 'no pull request is opened',
    )
    .action(async (folder: string, flags: AdoptFlags) => {
      const profile = readAdoptionProfile(flags.profile);

      // Two places can name the remote. Silently preferring one would let a
      // person adopt into the wrong catalog while looking at a profile that
      // says otherwise.
      if (flags.remote && flags.remote !== profile.remote) {
        throw new AdoptionPlanError(
          `--remote says "${flags.remote}" but the profile says "${profile.remote}". `
            + 'Change one so they agree.',
        );
      }
      const remoteName = flags.remote ?? profile.remote;
      const sourceFolder = path.resolve(folder);
      const sourceLabel = path.basename(sourceFolder);

      if (flags.dryRun) {
        // Same target check as the real run, so a dry run against a folder
        // library refuses with the same sentence rather than previewing a PR
        // that could never open.
        const target = resolveAdoptionTarget(remoteName);
        const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-adopt-dry-run-'));
        try {
          const mirror = mirrorFolder(sourceFolder, staging);
          const existing = buildCatalog()
            .filter((e) => e.remoteName === remoteName)
            .map((e) => e.manifest.id);
          const plan = planAdoption(staging, profile, existing, target.url);

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
        } finally {
          fs.rmSync(staging, { recursive: true, force: true });
        }
        return;
      }

      const result = await mirrorAndAdopt(sourceFolder, profile, remoteName, (_stage, message) => {
        console.log(message);
      });

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
