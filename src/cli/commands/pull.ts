import { Command } from 'commander';
import { pullArtifact, resolveArtifact } from '../../engine/pull/pull';
import { pullAndAutoWire } from '../../engine/pull/pullAndAutoWire';
import { buildPostInstallHealthSummary } from '../../engine/pull/postInstallHealthSummary';

/** Parses one or more repeated `--set KEY=VALUE` flags into a plain map --
 * Commander's own `collect` pattern (an accumulator reducer, not a single
 * default) is what makes `--set` repeatable at all. A malformed entry
 * (missing `=`, or an empty key) is a real usage error, not silently
 * dropped -- surfaced immediately so a typo doesn't quietly result in a
 * required install_param still being reported as missing. */
function collectSetFlag(value: string, previous: Record<string, string>): Record<string, string> {
  const eq = value.indexOf('=');
  if (eq <= 0) {
    throw new Error(`--set "${value}" must be in the form KEY=VALUE`);
  }
  const key = value.slice(0, eq);
  const val = value.slice(eq + 1);
  return { ...previous, [key]: val };
}

export function registerPullCommand(program: Command): void {
  program
    .command('pull <id>')
    .description('Pull an artifact by id into the current project')
    .option('-r, --remote <name>', 'Disambiguate which remote to pull the artifact from')
    .option(
      '--set <key=value>',
      'Provide a value for one of the artifact\'s declared install_params (e.g. --set '
        + 'AUTH_SECRET=... ). Repeatable. Written to .env.local at the project root, never '
        + 'into the artifact\'s own install_target.',
      collectSetFlag,
      {},
    )
    // The old text claimed this left the project untouched ("just copy the
    // payload and write install_params ... where nothing else in the project
    // should be touched"). That was wrong, and dangerously so: this branch
    // calls pullArtifact, which runs the manifest's post_install
    // unconditionally -- an arbitrary shell command, with the project root in
    // its environment. The flag only ever opted out of the wiring/build step.
    // See the characterization test in test/e2e/pull.e2e.test.ts, which pins
    // the current behaviour so changing it stays a deliberate decision.
    .option(
      '--no-wire',
      'Skip automatic wiring and the post-pull build check, the same as every DeliveryOS '
        + 'version before this default changed. The payload is still copied, install_params '
        + 'are still written to .env.local, and the artifact\'s own post_install command is '
        + 'still run -- this flag opts out of the wiring/build step only.',
    )
    .option(
      '--force',
      'Discard local edits to this artifact and take the current upstream version. Refused by '
        + 'default: pulling copies the payload over your files wholesale, so on an artifact you '
        + 'have edited that is silent data loss. Forcing also re-fetches the remote first, so you '
        + 'are trading your edits for what is actually upstream, not for a stale local cache.',
    )
    .action(async (id: string, options: { remote?: string; set: Record<string, string>; wire: boolean; force?: boolean }) => {
      // Resolved once up front (cheap -- reads the already-cloned remote,
      // no network) purely to decide WHICH path to take: pullAndAutoWire
      // is worth its extra build-verify step only when there's actually
      // something to wire. Without this check, an artifact with no
      // wiring_actions (every kind except backend-plugin, and even some
      // backend-plugins) would still go through pullAndAutoWire, which
      // skips running the build at all in that case (nothing to verify
      // against, by its own design) -- but the health summary can't tell
      // "skipped" apart from "no build script exists", so it would print
      // the latter even for a project with a perfectly real build script.
      // Matches the app's own established `hasWiring` gate for the exact
      // same reason (see app.js's Pull-button dispatch).
      const { manifest } = resolveArtifact(id, options.remote);
      const hasWiring = manifest.wiring_actions.length > 0;

      // Named before it runs, not after. `post_install` is an arbitrary shell
      // command with the project root in its environment, and it was the one
      // side effect shown nowhere -- the wiring snippets and install_params it
      // sits beside have always been fully visible in both the CLI and the app.
      // Printed rather than gated: this matches how `deliveryos wiring` shows
      // snippets, and adding a prompt would change what every existing script
      // does.
      if (manifest.post_install) {
        console.log(`This artifact runs a command after installing: ${manifest.post_install}`);
      }

      if (!options.wire || !hasWiring) {
        const result = await pullArtifact(id, options.remote, process.cwd(), undefined, options.set, { force: options.force });
        if (result.postInstallOutput && result.postInstallOutput.trim().length > 0) {
          console.log(result.postInstallOutput.trimEnd());
        }
        console.log(`Pulled "${result.manifest.id}" -> ${result.installTarget}`);
        if (result.missingRequiredParams.length > 0) {
          console.log(
            `Still needs configuration -- missing required value(s): `
              + `${result.missingRequiredParams.join(', ')}. Re-run with `
              + `--set KEY=VALUE, or edit .env.local directly.`,
          );
        }
        if (result.gitignoreWarning) {
          console.log(result.gitignoreWarning);
        }
        if (result.installParamWarning) {
          console.log(result.installParamWarning);
        }
        return;
      }

      const result = await pullAndAutoWire(id, options.remote, process.cwd(), undefined, options.set, options.force);
      const { pullResult } = result;
      if (pullResult.postInstallOutput && pullResult.postInstallOutput.trim().length > 0) {
        console.log(pullResult.postInstallOutput.trimEnd());
      }
      console.log(`Pulled "${pullResult.manifest.id}" -> ${pullResult.installTarget}`);
      if (pullResult.gitignoreWarning) {
        console.log(pullResult.gitignoreWarning);
      }
      if (pullResult.installParamWarning) {
        console.log(pullResult.installParamWarning);
      }
      // One coherent plain-language summary of wiring/build/missing-params,
      // same text the desktop app's own Pull toast shows -- covers
      // missingRequiredParams too, so it replaces (not supplements) the
      // separate message the --no-wire branch above prints for that.
      console.log(buildPostInstallHealthSummary(result));
    });
}
