import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { buildWireContextMarkdown, resolveWireTarget } from '../../engine/pull/buildWireContext';
import { launchInteractiveClaudeSession } from '../../engine/claude/launchInteractiveClaudeSession';
import { runProjectBuild } from '../../engine/pull/verifyBuild';
import { resolveInstallParamValues, readExistingEnvValues } from '../../engine/pull/installParams';
import { wireContextPath } from '../../engine/paths';

/**
 * `deliveryos wire-with-claude <id>` -- hands off to a REAL interactive
 * `claude` session to connect an already-pulled backend-plugin to the rest
 * of this project. Named distinctly from the existing, unrelated
 * `deliveryos wiring <id>` (a read-only inspector of an artifact's
 * declared wiring_actions) -- this command does the opposite of read-only:
 * it launches a real, tool-enabled agent against the real project.
 *
 * See `launchInteractiveClaudeSession.ts`'s own doc comment for why this
 * hands off to `claude`'s own normal, already-trusted interactive
 * permission model rather than trying to grant an AI subprocess real tool
 * access itself -- that was already tried once for a different feature and
 * walked back after finding real security problems with it.
 */
export function registerWireCommand(program: Command): void {
  program
    .command('wire-with-claude <id>')
    .description(
      'Hand off to a real, interactive claude session to connect an already-pulled '
        + 'backend-plugin to the rest of this project. Requires the "claude" CLI on PATH.',
    )
    .option('-r, --remote <name>', 'Disambiguate which remote the artifact was pulled from')
    .action(async (id: string, options: { remote?: string }) => {
      const cwd = process.cwd();
      const { manifest, lockEntry } = resolveWireTarget(cwd, id, options.remote);

      if (manifest.install_params.length > 0) {
        const existing = readExistingEnvValues(cwd);
        const { missingRequired } = resolveInstallParamValues(manifest.install_params, {}, existing);
        if (missingRequired.length > 0) {
          console.log(
            `Heads up -- still missing required configuration: ${missingRequired.join(', ')}. `
              + `The wiring can proceed, but the real flow won't work until these are set `
              + `("deliveryos config ${id} --set KEY=VALUE").`,
          );
        }
      }

      const contextPath = wireContextPath(cwd, id);
      fs.mkdirSync(path.dirname(contextPath), { recursive: true });
      fs.writeFileSync(contextPath, buildWireContextMarkdown(manifest, lockEntry), 'utf-8');
      const contextRelativePath = path.relative(cwd, contextPath).split(path.sep).join('/');

      console.log(`Wrote ${contextRelativePath} -- handing off to a real claude session...`);

      const { exitCode } = await launchInteractiveClaudeSession(
        cwd,
        `Read ${contextRelativePath} and follow it exactly. Actually call the real functions `
          + `now -- don't stop at a documented seam. Confirm the build passes and the real flow `
          + `works before finishing.`,
      );

      if (exitCode !== 0) {
        console.log(`claude exited with code ${exitCode}.`);
      }

      const build = await runProjectBuild(cwd);
      if (!build.ran) {
        console.log('No build command detected -- nothing to verify.');
      } else if (build.success) {
        console.log('The build passes.');
      } else if (build.timedOut) {
        console.log(`Build check timed out. ${build.output ?? ''}`.trim());
      } else if (build.toolNotFound) {
        console.log(`Build command's tool was not found on this machine's PATH. ${build.output ?? ''}`.trim());
      } else {
        console.log(`The build is still failing. ${build.output ?? ''}`.trim());
      }
    });
}
