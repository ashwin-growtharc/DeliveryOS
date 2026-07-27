import { Command } from 'commander';
import { pushArtifact, PushOptions } from '../../engine/push/push';

/** Splits a comma-separated --roles/--teams/--stacks flag into trimmed,
 * lowercased values -- lowercased so "python" and "Python" pushed on
 * different occasions land under the same tag, not two distinct ones (the
 * app's Browse view groups artifacts by these tags case-insensitively; this
 * keeps the underlying manifest data itself canonical rather than relying
 * solely on the app-side matching to paper over inconsistent casing). */
function parseList(value?: string): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export interface PushCommandFlags {
  remote?: string;
  new?: boolean;
  path?: string;
  kind?: string;
  owner?: string;
  description?: string;
  installTarget?: string;
  artifactVersion?: string;
  reviewRequired?: boolean;
  roles?: string;
  teams?: string;
  stacks?: string;
  postInstall?: string;
}

/** Maps raw commander flags onto the engine's PushOptions shape. Validation
 * of which flags are required for which mode is left to `pushArtifact`
 * itself (see push.ts) -- this is purely a mechanical translation. */
export function toPushOptions(flags: PushCommandFlags): PushOptions {
  return {
    remote: flags.remote,
    isNew: Boolean(flags.new),
    payloadPath: flags.path,
    kind: flags.kind,
    owner: flags.owner,
    description: flags.description,
    installTarget: flags.installTarget,
    version: flags.artifactVersion,
    reviewRequired: Boolean(flags.reviewRequired),
    roles: parseList(flags.roles),
    teams: parseList(flags.teams),
    stacks: parseList(flags.stacks),
    postInstall: flags.postInstall,
  };
}

export function registerPushCommand(program: Command): void {
  program
    .command('push <id>')
    .description(
      'Push a local edit as a GitHub PR (edit mode), or propose a brand-new artifact with --new',
    )
    .option('-r, --remote <name>', 'Remote to push against (required with --new)')
    .option('--new', 'Propose a brand-new artifact instead of pushing an edit to a tracked one')
    .option('--path <dir>', 'Path to the new artifact\'s payload directory (--new only)')
    .option('--kind <kind>', 'Artifact kind (--new only)')
    .option('--owner <owner>', 'Artifact owner (--new only)')
    .option('--description <text>', 'Artifact description (--new only)')
    .option('--install-target <path>', 'Install target path (--new only; defaults to <id>)')
    .option(
      '--artifact-version <semver>',
      'Artifact version (--new only; defaults to 1.0.0). Named --artifact-version rather ' +
        'than --version to avoid colliding with the CLI\'s own top-level -V/--version flag.',
    )
    .option('--review-required', 'Mark the new artifact as requiring review (--new only)')
    .option('--roles <list>', 'Comma-separated roles tag (--new only)')
    .option('--teams <list>', 'Comma-separated teams tag (--new only)')
    .option('--stacks <list>', 'Comma-separated stacks tag (--new only)')
    .option(
      '--post-install <cmd>',
      'Shell command to run in install_target after a pull (--new only; e.g. "npm install", '
        + '"pip install -e \\".[dev]\\""). Omit if the project needs no setup step.',
    )
    .action(async (id: string, flags: PushCommandFlags) => {
      const options = toPushOptions(flags);
      const result = await pushArtifact(id, options, process.cwd());
      console.log(`Opened PR #${result.number}: ${result.url} (branch ${result.branch})`);
    });
}
