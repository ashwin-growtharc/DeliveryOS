import { Command } from 'commander';
import { pushArtifact, PushOptions } from '../../engine/push/push';
import { VersionBumpKind, parseBumpKind as parseSharedBumpKind } from '../../engine/manifest/version';

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
  componentTypes?: string;
  postInstall?: string;
  bump?: string;
}

/** Thin CLI wrapper over the shared `parseBumpKind` (version.ts) -- same
 * validation the sidecar's `artifact.push` handler now also runs, just
 * re-worded here with the `--bump` flag name Commander users actually
 * typed, since the shared function's own message (reused by both callers)
 * can't assume it was reached via a CLI flag at all. Commander has no
 * built-in enum-option validation, so an invalid value (a typo, e.g.
 * `--bump pathc`) would otherwise silently fall through to `pushArtifact`'s
 * own `options.bump ?? 'patch'` default as a plain string. Fails loudly
 * here instead, before any network/git work starts. */
function parseBumpKind(value?: string): VersionBumpKind | undefined {
  try {
    return parseSharedBumpKind(value);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`--${detail}`);
  }
}

/** Maps raw commander flags onto the engine's PushOptions shape. Validation
 * of which flags are required for which mode is left to `pushArtifact`
 * itself (see push.ts) -- this is purely a mechanical translation.
 *
 * `--description`/`--roles`/`--teams`/`--stacks` are dual-purpose: with
 * `--new` they seed the brand-new manifest, same as always. Without `--new`,
 * passing any of them now means a metadata-only edit (no `--path`/payload
 * touched at all) -- previously these flags were silently ignored outside
 * `--new`, so routing them into `metadataEdit` here is a pure addition, not
 * a behavior change for any existing script. */
export function toPushOptions(flags: PushCommandFlags): PushOptions {
  const isNew = Boolean(flags.new);
  const roles = parseList(flags.roles);
  const teams = parseList(flags.teams);
  const stacks = parseList(flags.stacks);
  const componentTypes = parseList(flags.componentTypes);
  const hasMetadataEdit =
    !isNew && (flags.description !== undefined || roles !== undefined || teams !== undefined || stacks !== undefined || componentTypes !== undefined);

  return {
    remote: flags.remote,
    isNew,
    payloadPath: flags.path,
    kind: flags.kind,
    owner: flags.owner,
    description: isNew ? flags.description : undefined,
    installTarget: flags.installTarget,
    version: flags.artifactVersion,
    reviewRequired: Boolean(flags.reviewRequired),
    roles: isNew ? roles : undefined,
    teams: isNew ? teams : undefined,
    stacks: isNew ? stacks : undefined,
    componentTypes: isNew ? componentTypes : undefined,
    postInstall: flags.postInstall,
    metadataEdit: hasMetadataEdit
      ? { description: flags.description, roles, teams, stacks, componentTypes }
      : undefined,
    bump: parseBumpKind(flags.bump),
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
    .option(
      '--description <text>',
      'Artifact description. With --new, seeds the new manifest. Without --new, edits the '
        + 'description on an already-tracked artifact\'s manifest (no payload/content touched).',
    )
    .option('--install-target <path>', 'Install target path (--new only; defaults to <id>)')
    .option(
      '--artifact-version <semver>',
      'Artifact version (--new only; defaults to 1.0.0). Named --artifact-version rather ' +
        'than --version to avoid colliding with the CLI\'s own top-level -V/--version flag.',
    )
    .option('--review-required', 'Mark the new artifact as requiring review (--new only)')
    .option(
      '--roles <list>',
      'Comma-separated roles tag. With --new, seeds the new manifest; without --new, edits '
        + 'an already-tracked artifact\'s roles tag.',
    )
    .option(
      '--teams <list>',
      'Comma-separated teams tag. With --new, seeds the new manifest; without --new, edits '
        + 'an already-tracked artifact\'s teams tag.',
    )
    .option(
      '--stacks <list>',
      'Comma-separated stacks tag. With --new, seeds the new manifest; without --new, edits '
        + 'an already-tracked artifact\'s stacks tag.',
    )
    .option(
      '--component-types <list>',
      'Comma-separated component-category tag (e.g. "button,card"), for kind: ui-component '
        + 'artifacts. With --new, seeds the new manifest; without --new, edits an '
        + 'already-tracked artifact\'s componentTypes tag.',
    )
    .option(
      '--post-install <cmd>',
      'Shell command to run in install_target after a pull (--new only; e.g. "npm install", '
        + '"pip install -e \\".[dev]\\""). Omit if the project needs no setup step.',
    )
    .option(
      '--bump <patch|minor|major>',
      'Size of the version bump for a payload edit push (--new/metadata-only edits ignore '
        + 'this entirely). Defaults to "patch" -- a real payload change always bumps the '
        + 'version, this only lets you choose a bigger bump than the default.',
    )
    .action(async (id: string, flags: PushCommandFlags) => {
      const options = toPushOptions(flags);
      const result = await pushArtifact(id, options, process.cwd());
      console.log(`Opened PR #${result.number}: ${result.url} (branch ${result.branch})`);
      // Printed after the success line, never instead of it -- the PR really
      // did open. Same posture as pull's own gitignoreWarning.
      if (result.cacheResetWarning) {
        console.log(result.cacheResetWarning);
      }
    });
}
