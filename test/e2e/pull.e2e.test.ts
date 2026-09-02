import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  createTestRemote,
  createTestRemoteWithInstallParamsArtifact,
  createTestRemoteWithSignedArtifact,
  teardownTestRemote,
  TEST_ARTIFACTS,
  INSTALL_PARAMS_ARTIFACT,
  SIGNED_ARTIFACT,
} from '../fixtures/testRemote';
import { rmDirWithRetry } from '../../src/engine/execHelpers';

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
  entries: { id: string; version: string; remote: string; installTarget?: string }[];
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
    await rmDirWithRetry(deliveryOsHome);
    await rmDirWithRetry(scratchCwd);
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
    // Real regression test: this artifact declares no wiring_actions, so
    // pull must take the plain pullArtifact path, never pullAndAutoWire --
    // which would otherwise skip the build check (nothing to verify
    // against, by its own design when there's no wiring to apply) and
    // print a FALSE "no build command was found" for a project that might
    // have a perfectly real one, since the health summary can't tell
    // "we didn't check" apart from "there's genuinely nothing to check."
    expect(result.stdout).not.toContain('no build command');
    expect(result.stdout).not.toContain('Wiring was applied');

    const lockfile = JSON.parse(
      fs.readFileSync(path.join(scratchCwd, '.deliveryos', 'lock.json'), 'utf-8'),
    ) as LockFileJson;
    const entry = lockfile.entries.find((e) => e.id === artifact.id);
    // installTarget (Phase 13's uninstall groundwork) is now recorded
    // alongside id/version/remote -- the real resolved path pullArtifact
    // just copied the payload into.
    expect(entry).toEqual({
      id: artifact.id,
      version: '1.0.0',
      remote: 'test-remote',
      installTarget,
    });
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

  it('list --json reports localStatus reflecting real pulled vs. not-pulled state -- a real CLI/sidecar parity gap this closes (the app\'s own Browse view has always shown this over the same catalog data)', () => {
    const result = runCli(['list', '--json'], scratchCwd, deliveryOsHome);
    expect(result.status).toBe(0);
    const entries = JSON.parse(result.stdout) as (CatalogJsonEntry & { localStatus: string })[];

    // Only the 2 artifacts actually pulled by the two preceding tests are
    // 'pulled' -- the 3rd, never pulled in this file, must still read
    // 'not_pulled'.
    const pulledSoFar = [
      TEST_ARTIFACTS.find((a) => a.hasPostInstall)!.id,
      TEST_ARTIFACTS.find((a) => !a.hasPostInstall)!.id,
    ];
    for (const id of pulledSoFar) {
      expect(entries.find((e) => e.id === id)?.localStatus, `expected "${id}" to be pulled`).toBe('pulled');
    }
    const neverPulled = TEST_ARTIFACTS.find((a) => !pulledSoFar.includes(a.id));
    if (neverPulled) {
      expect(entries.find((e) => e.id === neverPulled.id)?.localStatus).toBe('not_pulled');
    }
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

  it('check-pending-pushes reports nothing to check for a project with no pushed edits -- a real CLI/sidecar parity gap this closes (the sidecar\'s own sync.resolvePendingPushes RPC has always had this; the underlying engine function is already covered end to end in test/e2e/sync.resolvePendingPushes.test.ts, so this only confirms the CLI wiring)', () => {
    const result = runCli(['check-pending-pushes'], scratchCwd, deliveryOsHome);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No pending pushes to check.');
  });

  it('remote list shows a registered remote via --json, and via the real CLI (a real CLI/sidecar parity gap this closes -- the sidecar\'s own remote.list RPC has always had this)', () => {
    const jsonResult = runCli(['remote', 'list', '--json'], scratchCwd, deliveryOsHome);
    expect(jsonResult.status).toBe(0);
    const remotes = JSON.parse(jsonResult.stdout) as { name: string; url: string }[];
    expect(remotes.find((r) => r.name === 'test-remote')?.url).toBe(fixtureRemoteDir);

    const humanResult = runCli(['remote', 'list'], scratchCwd, deliveryOsHome);
    expect(humanResult.status).toBe(0);
    expect(humanResult.stdout).toContain('test-remote');
    expect(humanResult.stdout).toContain(fixtureRemoteDir);
  });

  describe('install_params (Phase 7)', () => {
    it('list --json includes tags/installTarget/installParams/signed (Phase 8 item 4) -- enough to judge fit and trust without pulling first', async () => {
      const remoteDir = await createTestRemoteWithInstallParamsArtifact();
      // Deliberately its OWN isolated DELIVERYOS_HOME, not the shared one --
      // registering a second remote carrying the same fixture artifact id
      // under the shared home would make every OTHER unscoped pull in this
      // file genuinely ambiguous (the exact regression already documented
      // elsewhere in this file).
      const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-e2e-list-json-fields-home-'));
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-e2e-list-json-fields-'));
      try {
        const addResult = runCli(
          ['remote', 'add', remoteDir, '--name', 'list-json-fields-remote'],
          cwd,
          isolatedHome,
        );
        expect(addResult.status).toBe(0);

        const result = runCli(['list', '--json', '--remote', 'list-json-fields-remote'], cwd, isolatedHome);
        expect(result.status).toBe(0);

        interface ExtendedEntry extends CatalogJsonEntry {
          tags: { stacks: string[] };
          installTarget: string;
          installParams: { key: string; secret: boolean; required: boolean; hasDefault: boolean }[];
          signed: boolean;
        }
        const entries = JSON.parse(result.stdout) as ExtendedEntry[];
        const entry = entries.find((e) => e.id === INSTALL_PARAMS_ARTIFACT.id)!;

        expect(entry.installTarget).toBe(INSTALL_PARAMS_ARTIFACT.installTarget);
        expect(entry.signed).toBe(false); // this fixture declares no signature
        expect(entry.installParams).toEqual([
          { key: 'AUTH_SECRET', secret: true, required: true, hasDefault: false },
          { key: 'AUTH_URL', secret: false, required: true, hasDefault: true },
          { key: 'DATABASE_URL', secret: true, required: true, hasDefault: false },
        ]);
      } finally {
        await teardownTestRemote(remoteDir);
        await rmDirWithRetry(isolatedHome);
        await rmDirWithRetry(cwd);
      }
    }, 30_000);

    let paramsRemoteDir: string;
    let paramsCwd: string;

    beforeAll(async () => {
      paramsRemoteDir = await createTestRemoteWithInstallParamsArtifact();
      paramsCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-e2e-install-params-cwd-'));
      const addResult = runCli(
        ['remote', 'add', paramsRemoteDir, '--name', 'install-params-remote'],
        paramsCwd,
        deliveryOsHome,
      );
      expect(addResult.status).toBe(0);
    }, 30_000);

    afterAll(async () => {
      await teardownTestRemote(paramsRemoteDir);
      await rmDirWithRetry(paramsCwd);
    });

    it('--set (repeated) writes real values to .env.local, and reports nothing missing once every required param is covered', () => {
      const result = runCli(
        [
          'pull', INSTALL_PARAMS_ARTIFACT.id,
          '--set', 'AUTH_SECRET=real-secret-value',
          '--set', 'DATABASE_URL=postgres://real-db',
        ],
        paramsCwd,
        deliveryOsHome,
      );

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain('still needed for');

      // Phase 18: pull now defaults to auto-wiring -- this fixture's two
      // wiring_actions both target files that don't exist yet in this fresh
      // cwd, so both get written automatically, and the health summary
      // says so.
      expect(result.stdout).toContain('Wiring was applied automatically to 2 files.');
      expect(fs.existsSync(path.join(paramsCwd, 'auth.ts'))).toBe(true);
      expect(fs.existsSync(path.join(paramsCwd, 'middleware.ts'))).toBe(true);

      const envContent = fs.readFileSync(path.join(paramsCwd, '.env.local'), 'utf-8');
      expect(envContent).toContain('AUTH_SECRET=real-secret-value');
      expect(envContent).toContain('DATABASE_URL=postgres://real-db');
      // AUTH_URL was never passed via --set, but the manifest declares a
      // default for it -- applied automatically, not left missing.
      expect(envContent).toContain('AUTH_URL=http://localhost:3000');

      // The real point of putting this here, not just install_target: a
      // secret value must never end up inside the artifact's own
      // pristine snapshot.
      const pristineDir = path.join(
        paramsCwd, '.deliveryos', 'pristine', INSTALL_PARAMS_ARTIFACT.id,
      );
      expect(fs.existsSync(path.join(pristineDir, '.env.local'))).toBe(false);
      const installTargetDir = path.join(paramsCwd, INSTALL_PARAMS_ARTIFACT.installTarget);
      expect(fs.existsSync(path.join(installTargetDir, '.env.local'))).toBe(false);
    });

    it('also generates .env.example placeholders (Tier 1 of the wiring agent, item 6) -- derived from install_params, never containing the real secret values just configured', () => {
      const exampleContent = fs.readFileSync(path.join(paramsCwd, '.env.example'), 'utf-8');
      // Secret params always get a blank placeholder, regardless of the
      // real value --set just configured in .env.local moments ago.
      expect(exampleContent).toContain('AUTH_SECRET=\n');
      expect(exampleContent).toContain('DATABASE_URL=\n');
      expect(exampleContent).not.toContain('real-secret-value');
      expect(exampleContent).not.toContain('postgres://real-db');
      // The non-secret param's own default IS used as the placeholder.
      expect(exampleContent).toContain('AUTH_URL=http://localhost:3000');

      const installTargetDir = path.join(paramsCwd, INSTALL_PARAMS_ARTIFACT.installTarget);
      expect(fs.existsSync(path.join(installTargetDir, '.env.example'))).toBe(false);
    });

    it('pulling with a required param genuinely unfilled (no --set, no default) still succeeds, and reports it as missing rather than failing the whole pull', async () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-e2e-install-params-missing-'));
      try {
        const addResult = runCli(
          ['remote', 'add', paramsRemoteDir, '--name', 'install-params-remote-missing'],
          cwd,
          deliveryOsHome,
        );
        expect(addResult.status).toBe(0);

        // --remote is required here (not just a nicety): registering a
        // second remote name for this artifact, anywhere in the same
        // shared DELIVERYOS_HOME this whole file's tests run under, makes
        // an unscoped pull by id genuinely ambiguous -- resolveArtifact's
        // own real, correct behavior, not a bug this test should paper
        // over with a fresh DELIVERYOS_HOME instead.
        const result = runCli(
          ['pull', INSTALL_PARAMS_ARTIFACT.id, '--remote', 'install-params-remote-missing'],
          cwd,
          deliveryOsHome,
        );

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`Pulled "${INSTALL_PARAMS_ARTIFACT.id}"`);
        expect(result.stdout).toContain('still needed for');
        expect(result.stdout).toContain('AUTH_SECRET');
        expect(result.stdout).toContain('DATABASE_URL');

        // AUTH_URL's own default still gets applied even though nothing
        // else was configured.
        const envContent = fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8');
        expect(envContent).toBe('AUTH_URL=http://localhost:3000\n');
      } finally {
        await rmDirWithRetry(cwd);
      }
    });

    it('--no-wire skips auto-wiring entirely, matching every DeliveryOS version before Phase 19 -- for scripted/CI use', async () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-e2e-install-params-nowire-'));
      try {
        const addResult = runCli(
          ['remote', 'add', paramsRemoteDir, '--name', 'install-params-remote-nowire'],
          cwd,
          deliveryOsHome,
        );
        expect(addResult.status).toBe(0);

        const result = runCli(
          [
            'pull', INSTALL_PARAMS_ARTIFACT.id,
            '--remote', 'install-params-remote-nowire',
            '--no-wire',
            '--set', 'AUTH_SECRET=x', '--set', 'DATABASE_URL=y',
          ],
          cwd,
          deliveryOsHome,
        );

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`Pulled "${INSTALL_PARAMS_ARTIFACT.id}"`);
        // The old plain message, not the health-summary sentence -- proves
        // --no-wire really takes the old pullArtifact-only path, not just a
        // differently-worded version of the new one.
        expect(result.stdout).not.toContain('Wiring was applied automatically');
        expect(fs.existsSync(path.join(cwd, 'auth.ts'))).toBe(false);
        expect(fs.existsSync(path.join(cwd, 'middleware.ts'))).toBe(false);
      } finally {
        await rmDirWithRetry(cwd);
      }
    });

    it('rejects a malformed --set value (no "=") with a clean error, not a crash', async () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-e2e-install-params-badset-'));
      try {
        const addResult = runCli(
          ['remote', 'add', paramsRemoteDir, '--name', 'install-params-remote-badset'],
          cwd,
          deliveryOsHome,
        );
        expect(addResult.status).toBe(0);

        const result = runCli(
          [
            'pull', INSTALL_PARAMS_ARTIFACT.id,
            '--remote', 'install-params-remote-badset',
            '--set', 'NOT-A-KEY-VALUE-PAIR',
          ],
          cwd,
          deliveryOsHome,
        );

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('KEY=VALUE');
      } finally {
        await rmDirWithRetry(cwd);
      }
    });
  });

  describe('signature verification (Phase 7 item 3)', () => {
    it('list --json reports signed: true for an artifact that declares a signature (Phase 8 item 4)', async () => {
      const remoteDir = await createTestRemoteWithSignedArtifact({
        contentDigestMatchesPayload: true,
        includeSignatureBundle: true,
      });
      // Its own isolated home -- see the same note on the install_params
      // version of this test, above.
      const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-e2e-list-json-signed-home-'));
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-e2e-list-json-signed-'));
      try {
        const addResult = runCli(
          ['remote', 'add', remoteDir, '--name', 'list-json-signed-remote'],
          cwd,
          isolatedHome,
        );
        expect(addResult.status).toBe(0);

        const result = runCli(['list', '--json', '--remote', 'list-json-signed-remote'], cwd, isolatedHome);
        expect(result.status).toBe(0);
        const entries = JSON.parse(result.stdout) as (CatalogJsonEntry & { signed: boolean })[];
        const entry = entries.find((e) => e.id === SIGNED_ARTIFACT.id)!;
        expect(entry.signed).toBe(true);
      } finally {
        await teardownTestRemote(remoteDir);
        await rmDirWithRetry(isolatedHome);
        await rmDirWithRetry(cwd);
      }
    }, 30_000);

    it('refuses the pull, before any files are written, when a signature is declared but no signature.bundle file exists', async () => {
      const remoteDir = await createTestRemoteWithSignedArtifact({
        contentDigestMatchesPayload: true,
        includeSignatureBundle: false,
      });
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-e2e-signed-nobundle-'));
      try {
        const addResult = runCli(
          ['remote', 'add', remoteDir, '--name', 'signed-remote-nobundle'],
          cwd,
          deliveryOsHome,
        );
        expect(addResult.status).toBe(0);

        const result = runCli(
          ['pull', SIGNED_ARTIFACT.id, '--remote', 'signed-remote-nobundle'],
          cwd,
          deliveryOsHome,
        );

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('no signature bundle was found');
        expect(fs.existsSync(path.join(cwd, SIGNED_ARTIFACT.installTarget))).toBe(false);
      } finally {
        await teardownTestRemote(remoteDir);
        await rmDirWithRetry(cwd);
      }
    }, 30_000);

    it('refuses the pull, before any files are written, when the recorded content_digest does not match the actual payload', async () => {
      const remoteDir = await createTestRemoteWithSignedArtifact({
        contentDigestMatchesPayload: false,
        includeSignatureBundle: true,
      });
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-e2e-signed-mismatch-'));
      try {
        const addResult = runCli(
          ['remote', 'add', remoteDir, '--name', 'signed-remote-mismatch'],
          cwd,
          deliveryOsHome,
        );
        expect(addResult.status).toBe(0);

        const result = runCli(
          ['pull', SIGNED_ARTIFACT.id, '--remote', 'signed-remote-mismatch'],
          cwd,
          deliveryOsHome,
        );

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('does not match its recorded content_digest');
        expect(fs.existsSync(path.join(cwd, SIGNED_ARTIFACT.installTarget))).toBe(false);
      } finally {
        await teardownTestRemote(remoteDir);
        await rmDirWithRetry(cwd);
      }
    }, 30_000);
  });
});
