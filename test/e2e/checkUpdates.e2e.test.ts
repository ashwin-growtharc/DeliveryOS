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
});
