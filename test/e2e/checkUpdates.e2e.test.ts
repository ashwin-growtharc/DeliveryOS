import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import simpleGit from 'simple-git';
import { createTestRemote, teardownTestRemote, TEST_ARTIFACTS } from '../fixtures/testRemote';
import { rmDirWithRetry } from '../../src/engine/execHelpers';

// Thin CLI-wiring smoke test for `check-updates --apply` -- the underlying
// engine function (applyAvailableUpdates) already has thorough direct
// coverage in test/e2e/applyUpdate.e2e.test.ts; this only confirms the CLI
// flag actually reaches it and prints something sensible, via the real CLI
// subprocess (same tsx-driven pattern as pull.e2e.test.ts's own runCli).

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TSX_CLI = require.resolve('tsx/cli');
const CLI_ENTRY = path.join(REPO_ROOT, 'src', 'index.ts');

function runCli(args: string[], cwd: string, deliveryOsHome: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, DELIVERYOS_HOME: deliveryOsHome },
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

describe('check-updates --apply e2e (CLI)', () => {
  let fixtureRemoteDir: string;
  let deliveryOsHome: string;
  let scratchCwd: string;

  beforeAll(async () => {
    fixtureRemoteDir = await createTestRemote();
    deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-check-updates-cli-home-'));
    scratchCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-check-updates-cli-cwd-'));
  }, 30_000);

  afterAll(async () => {
    await teardownTestRemote(fixtureRemoteDir);
    await rmDirWithRetry(deliveryOsHome);
    await rmDirWithRetry(scratchCwd);
  });

  it('pulls an artifact, bumps it upstream, then `check-updates --apply` actually updates it via the real CLI', async () => {
    const addResult = runCli(['remote', 'add', fixtureRemoteDir, '--name', 'cli-apply-remote'], scratchCwd, deliveryOsHome);
    expect(addResult.status).toBe(0);

    const artifact = TEST_ARTIFACTS.find((a) => a.id === 'welcome-template')!;
    const pullResult = runCli(['pull', artifact.id], scratchCwd, deliveryOsHome);
    expect(pullResult.status).toBe(0);

    const manifestPath = path.join(fixtureRemoteDir, 'artifacts', artifact.id, 'manifest.yaml');
    const original = fs.readFileSync(manifestPath, 'utf-8');
    fs.writeFileSync(manifestPath, original.replace(/^version: .*$/m, 'version: 3.0.0'), 'utf-8');
    fs.writeFileSync(
      path.join(fixtureRemoteDir, 'artifacts', artifact.id, 'payload', 'README.md'),
      '# welcome-template\n\nUpdated via CLI test.\n',
      'utf-8',
    );
    const git = simpleGit(fixtureRemoteDir);
    await git.add(['artifacts/welcome-template']);
    await git.commit('bump for CLI --apply test');

    const checkResult = runCli(['check-updates'], scratchCwd, deliveryOsHome);
    expect(checkResult.status).toBe(0);
    expect(checkResult.stdout).toContain('1.0.0 -> 3.0.0');

    const applyResult = runCli(['check-updates', '--apply'], scratchCwd, deliveryOsHome);
    expect(applyResult.status).toBe(0);
    expect(applyResult.stdout).toContain('updated 1.0.0 -> 3.0.0');

    const installTarget = path.join(scratchCwd, artifact.installTarget);
    expect(fs.readFileSync(path.join(installTarget, 'README.md'), 'utf-8')).toContain('Updated via CLI test.');

    // A second --apply run has nothing left to do.
    const secondApply = runCli(['check-updates', '--apply'], scratchCwd, deliveryOsHome);
    expect(secondApply.status).toBe(0);
    expect(secondApply.stdout).toContain('No updates available.');
  }, 30_000);

  // The scoping half. `applyAvailableUpdates` has always accepted an `onlyId`;
  // the CLI simply never passed one, so `--apply` was project-wide and nothing
  // else. The sidecar's `artifact.applyUpdate` REQUIRES an id and updates
  // exactly one -- same engine function, opposite blast radius, and the
  // capability manifest could not see it because both surfaces declared the
  // operation with matching risk flags. They differed in granularity.
  //
  // The assertion that matters is the NEGATIVE one: scoping is only real if the
  // artifact you did not name is still sitting there un-updated afterwards. A
  // test that only checks the named artifact moved would pass just as happily
  // against the old project-wide behaviour.
  it('updates only the artifact you name, and leaves the other one alone', async () => {
    const other = TEST_ARTIFACTS.find((a) => a.id === 'lint-config')!;
    expect(runCli(['pull', other.id], scratchCwd, deliveryOsHome).status).toBe(0);

    // Bump BOTH upstream, so a project-wide apply and a scoped one produce
    // visibly different end states.
    const git = simpleGit(fixtureRemoteDir);
    for (const [id, version, body] of [
      ['welcome-template', '4.0.0', 'Should NOT be applied by a scoped run.'],
      ['lint-config', '4.0.0', 'Should be applied by the scoped run.'],
    ]) {
      const dir = path.join(fixtureRemoteDir, 'artifacts', id);
      const manifestPath = path.join(dir, 'manifest.yaml');
      fs.writeFileSync(
        manifestPath,
        fs.readFileSync(manifestPath, 'utf-8').replace(/^version: .*$/m, `version: ${version}`),
        'utf-8',
      );
      fs.writeFileSync(path.join(dir, 'payload', 'README.md'), `# ${id}

${body}
`, 'utf-8');
      await git.add([`artifacts/${id}`]);
    }
    await git.commit('bump both for the scoped-apply test');

    // Both are genuinely stale before the scoped run -- otherwise the negative
    // assertion below would pass for the wrong reason.
    const before = runCli(['check-updates'], scratchCwd, deliveryOsHome);
    expect(before.stdout).toContain('welcome-template');
    expect(before.stdout).toContain('lint-config');

    const scoped = runCli(['check-updates', other.id, '--apply'], scratchCwd, deliveryOsHome);
    expect(scoped.status).toBe(0);
    expect(scoped.stdout).toContain('updated 1.0.0 -> 4.0.0');
    expect(scoped.stdout, 'a scoped apply must not touch the artifact it was not given')
      .not.toContain('welcome-template');

    expect(
      fs.readFileSync(path.join(scratchCwd, other.installTarget, 'README.md'), 'utf-8'),
    ).toContain('Should be applied by the scoped run.');

    const untouched = path.join(scratchCwd, TEST_ARTIFACTS.find((a) => a.id === 'welcome-template')!.installTarget);
    expect(
      fs.readFileSync(path.join(untouched, 'README.md'), 'utf-8'),
      'the unnamed artifact must still be on its old content',
    ).not.toContain('Should NOT be applied by a scoped run.');

    // And it is still reported as stale, so the scoped run did not quietly
    // consume the update it declined to apply.
    const after = runCli(['check-updates'], scratchCwd, deliveryOsHome);
    expect(after.stdout).toContain('welcome-template');
    expect(after.stdout).not.toContain('lint-config');
  }, 60_000);

  // Before the id existed there was nothing to typo. Now there is, and the
  // wrong answer here is the dangerous one: reporting "No updates available."
  // for an artifact that is not installed is reassurance about something that
  // was never checked -- the silent-coercion shape AGENTS.md names, and worse
  // on an agent surface where it gets relayed as fact.
  it('refuses a name it has not installed, rather than reporting it up to date', () => {
    const result = runCli(['check-updates', 'never-installed-here'], scratchCwd, deliveryOsHome);
    expect(result.status, 'a name that resolves to nothing is not a success').toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain('"never-installed-here" is not installed in this project');
    expect(output, 'must not read as a clean bill of health').not.toContain('up to date');
    expect(output, 'must not read as a clean bill of health').not.toContain('No updates available.');
  }, 30_000);
});
