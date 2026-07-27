import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createTestRemote, teardownTestRemote, TEST_ARTIFACTS } from '../fixtures/testRemote';

// This e2e test drives the CLI as a real subprocess (via `tsx src/index.ts`)
// rather than in-process, since that's closer to how a real user invokes
// `deliveryos`. We use tsx's programmatic CLI entry point directly (instead
// of shelling out to the `tsx`/`deliveryos` bin shims) so the test doesn't
// depend on a prior `npm run build` and stays cross-platform (no reliance on
// POSIX shebangs or Windows .cmd shims).
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TSX_CLI = require.resolve('tsx/cli');
const CLI_ENTRY = path.join(REPO_ROOT, 'src', 'index.ts');

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string, deliveryOsHome: string): CliResult {
  const result = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, DELIVERYOS_HOME: deliveryOsHome },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

interface CatalogJsonEntry {
  id: string;
  kind: string;
  version: string;
  remote: string;
  description: string;
}

interface LockFileJson {
  version: 1;
  entries: { id: string; version: string; remote: string }[];
}

describe('pull e2e', () => {
  let fixtureRemoteDir: string;
  let deliveryOsHome: string;
  let scratchCwd: string;

  beforeAll(async () => {
    fixtureRemoteDir = await createTestRemote();
    deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-e2e-home-'));
    scratchCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-e2e-cwd-'));
  }, 30_000);

  afterAll(async () => {
    await teardownTestRemote(fixtureRemoteDir);
    fs.rmSync(deliveryOsHome, { recursive: true, force: true });
    fs.rmSync(scratchCwd, { recursive: true, force: true });
  });

  it('registers the test remote', () => {
    const result = runCli(
      ['remote', 'add', fixtureRemoteDir, '--name', 'test-remote'],
      scratchCwd,
      deliveryOsHome,
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Added remote "test-remote"');

    const registryPath = path.join(deliveryOsHome, 'remotes.json');
    expect(fs.existsSync(registryPath)).toBe(true);
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    expect(registry.remotes).toHaveLength(1);
    expect(registry.remotes[0].name).toBe('test-remote');
    expect(registry.remotes[0].url).toBe(fixtureRemoteDir);
  }, 30_000);

  it('lists all 3 seeded artifacts via --json', () => {
    const result = runCli(['list', '--json'], scratchCwd, deliveryOsHome);

    expect(result.status).toBe(0);
    const entries = JSON.parse(result.stdout) as CatalogJsonEntry[];
    expect(entries).toHaveLength(3);

    for (const artifact of TEST_ARTIFACTS) {
      const entry = entries.find((e) => e.id === artifact.id);
      expect(entry, `expected catalog entry for ${artifact.id}`).toBeDefined();
      expect(entry?.kind).toBe(artifact.kind);
      expect(entry?.version).toBe('1.0.0');
      expect(entry?.remote).toBe('test-remote');
    }
  });

  it('pulls the artifact with post_install and runs it', () => {
    const artifact = TEST_ARTIFACTS.find((a) => a.hasPostInstall);
    if (!artifact) throw new Error('fixture must have one artifact with post_install');

    const result = runCli(['pull', artifact.id], scratchCwd, deliveryOsHome);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const installTarget = path.join(scratchCwd, artifact.installTarget);
    expect(result.stdout).toContain(`Pulled "${artifact.id}"`);
    expect(fs.existsSync(path.join(installTarget, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(installTarget, '.post_install_ran'))).toBe(true);
    // Captured via stdio:'pipe' (not 'inherit', which would corrupt the
    // sidecar's NDJSON stream) and surfaced explicitly by the CLI -- this
    // locks in that the capture-and-resurface path actually works, not just
    // that the side-effecting marker file got written.
    expect(result.stdout).toContain(`post_install ran for ${artifact.id}`);

    const lockfile = JSON.parse(
      fs.readFileSync(path.join(scratchCwd, '.deliveryos', 'lock.json'), 'utf-8'),
    ) as LockFileJson;
    const entry = lockfile.entries.find((e) => e.id === artifact.id);
    expect(entry).toEqual({ id: artifact.id, version: '1.0.0', remote: 'test-remote' });
  });

  it('pulls an artifact without post_install', () => {
    const artifact = TEST_ARTIFACTS.find((a) => !a.hasPostInstall);
    if (!artifact) throw new Error('fixture must have an artifact without post_install');

    const result = runCli(['pull', artifact.id], scratchCwd, deliveryOsHome);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const installTarget = path.join(scratchCwd, artifact.installTarget);
    expect(fs.existsSync(path.join(installTarget, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(installTarget, '.post_install_ran'))).toBe(false);
  });

  it('re-pulling the same id upserts the lockfile instead of duplicating', () => {
    const artifact = TEST_ARTIFACTS.find((a) => a.hasPostInstall);
    if (!artifact) throw new Error('fixture must have one artifact with post_install');

    const result = runCli(['pull', artifact.id], scratchCwd, deliveryOsHome);
    expect(result.status).toBe(0);

    const lockfile = JSON.parse(
      fs.readFileSync(path.join(scratchCwd, '.deliveryos', 'lock.json'), 'utf-8'),
    ) as LockFileJson;
    const matches = lockfile.entries.filter((e) => e.id === artifact.id);
    expect(matches).toHaveLength(1);

    // The other two artifacts pulled in previous steps should still be present.
    expect(lockfile.entries.length).toBe(TEST_ARTIFACTS.length - 1);
  });

  it('hard-errors when pulling a nonexistent id', () => {
    const result = runCli(['pull', 'nonexistent-id'], scratchCwd, deliveryOsHome);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('nonexistent-id');
  });

  it('remote remove unregisters a remote and deletes its cache clone via the real CLI, without disturbing test-remote', () => {
    // A separate remote name, not the shared `test-remote` every other test
    // in this file depends on -- this scenario shouldn't disturb it.
    const addResult = runCli(
      ['remote', 'add', fixtureRemoteDir, '--name', 'test-remote-to-remove'],
      scratchCwd,
      deliveryOsHome,
    );
    expect(addResult.status).toBe(0);

    const cachePath = path.join(deliveryOsHome, 'remotes', 'test-remote-to-remove');
    expect(fs.existsSync(cachePath)).toBe(true);

    const removeResult = runCli(
      ['remote', 'remove', 'test-remote-to-remove'],
      scratchCwd,
      deliveryOsHome,
    );
    expect(removeResult.stderr).toBe('');
    expect(removeResult.status).toBe(0);
    expect(removeResult.stdout).toContain('Removed remote "test-remote-to-remove"');
    expect(fs.existsSync(cachePath)).toBe(false);

    const registry = JSON.parse(
      fs.readFileSync(path.join(deliveryOsHome, 'remotes.json'), 'utf-8'),
    ) as { remotes: { name: string }[] };
    expect(registry.remotes.find((r) => r.name === 'test-remote-to-remove')).toBeUndefined();
    // The original test-remote every earlier test in this file relies on is untouched.
    expect(registry.remotes.find((r) => r.name === 'test-remote')).toBeDefined();
  });

  it('remote remove on an unregistered name hard-errors cleanly via the real CLI', () => {
    const result = runCli(['remote', 'remove', 'never-registered'], scratchCwd, deliveryOsHome);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('never-registered');
  });
});
