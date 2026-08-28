import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pullArtifact } from '../../src/engine/pull/pull';
import { ArtifactResolutionError, ManifestValidationError, PostInstallError } from '../../src/engine/errors';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';
import { readLockfile, upsertEntry } from '../../src/engine/lockfile/lockfile';
import { rmDirWithRetry } from '../../src/engine/execHelpers';

// Same lightweight "fake a registered remote + cache directly on disk"
// pattern as test/unit/pullPayloadComponent.test.ts -- pullArtifact reads
// remotes/manifests straight off DELIVERYOS_HOME via buildCatalog(), so no
// real git clone/fetch is needed to exercise post_install's own error
// handling.
//
// On Windows, killing a timed-out `execSync` call only terminates the
// cmd.exe shell wrapper -- the real grandchild `node` process spawned by
// the timeout test below keeps running independently for its own ~600ms,
// still holding a lock on `cwd`, regardless of the timeout already having
// fired (confirmed by hand). `fs.rmSync`'s own `maxRetries` option was
// tried first and did NOT reliably retry this specific EPERM --
// `rmDirWithRetry` (shared with `removeArtifact.ts`'s own identical real
// production fix, see its doc comment) does.

let deliveryOsHome: string;
let originalEnv: string | undefined;
let cwd: string;

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-pull-test-home-'));
  process.env.DELIVERYOS_HOME = deliveryOsHome;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-pull-test-cwd-'));
});

afterEach(async () => {
  if (originalEnv === undefined) {
    delete process.env.DELIVERYOS_HOME;
  } else {
    process.env.DELIVERYOS_HOME = originalEnv;
  }
  fs.rmSync(deliveryOsHome, { recursive: true, force: true });
  await rmDirWithRetry(cwd);
});

function writeRegistry(remoteNames: string[]): void {
  const registry = {
    remotes: remoteNames.map((name) => ({
      name,
      url: `https://example.invalid/${name}`,
      addedAt: new Date().toISOString(),
    })),
  };
  fs.mkdirSync(deliveryOsHome, { recursive: true });
  fs.writeFileSync(remotesRegistryPath(), JSON.stringify(registry), 'utf-8');
}

function writeArtifact(id: string, postInstall: string): void {
  const remoteCacheDir = remoteCachePath('test-remote');
  const payloadDir = path.join(remoteCacheDir, 'artifacts', id, 'payload');
  fs.mkdirSync(payloadDir, { recursive: true });
  fs.writeFileSync(path.join(payloadDir, 'README.md'), `# ${id}\n`, 'utf-8');
  fs.writeFileSync(
    path.join(remoteCacheDir, 'artifacts', id, 'manifest.yaml'),
    [
      `id: ${id}`,
      `kind: template`,
      `description: Test artifact for post_install error reporting`,
      `owner: team-x`,
      `version: 1.0.0`,
      `source_repo: https://example.invalid/repo`,
      `install_target: installed`,
      `review_required: false`,
      `post_install: ${postInstall}`,
      '',
    ].join('\n'),
    'utf-8',
  );
}

describe('pullArtifact post_install error reporting', () => {
  it('runs a real, genuinely failing post_install and reports it via the pre-existing generic message', async () => {
    writeRegistry(['test-remote']);
    writeArtifact('bad-install', 'node -e "console.error(\'real post_install error\'); process.exit(1)"');

    try {
      await pullArtifact('bad-install', undefined, cwd);
      throw new Error('expected pullArtifact to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(PostInstallError);
      const message = (err as Error).message;
      expect(message).toContain('post_install command failed');
      expect(message).toContain('real post_install error');
    }
  }, 30_000);

  it('reports a genuine post_install timeout with its own distinct message, not the generic failure text', async () => {
    writeRegistry(['test-remote']);
    // Real command that outlives the 200ms postInstallTimeoutMs override
    // below (test-only; production uses POST_INSTALL_TIMEOUT_MS).
    // Deliberately NOT a multi-second sleep: confirmed by hand that on
    // Windows, killing a timed-out `execSync` call only terminates the
    // cmd.exe shell wrapper -- the real grandchild `node` process here
    // keeps running independently for its own full duration regardless of
    // the timeout firing, so afterEach's cleanup has to wait it out too.
    // Keeping this short keeps the whole test fast.
    writeArtifact('hangs-install', 'node -e "setTimeout(() => {}, 600)"');

    try {
      await pullArtifact('hangs-install', undefined, cwd, undefined, {}, 200);
      throw new Error('expected pullArtifact to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(PostInstallError);
      const message = (err as Error).message;
      expect(message).toContain('post_install command timed out after 200ms');
      expect(message).not.toContain('post_install command failed');
    }
  }, 10_000);

  it('reports a genuine "tool not found" post_install failure with its own distinct message', async () => {
    writeRegistry(['test-remote']);
    writeArtifact('missing-tool-install', 'a-command-that-genuinely-does-not-exist-anywhere');

    try {
      await pullArtifact('missing-tool-install', undefined, cwd);
      throw new Error('expected pullArtifact to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(PostInstallError);
      const message = (err as Error).message;
      expect(message).toContain('post_install command\'s tool was not found');
      expect(message).not.toContain('post_install command failed');
      expect(message).not.toContain('timed out');
    }
  }, 30_000);

  // Real, confirmed bug found while dogfooding a large backend-plugin:
  // post_install's own cwd is installTarget, not the project root (see
  // pull.ts's own doc comment) -- a manifest that needs to `cd` back up
  // to the real project (almost every real one does, to run `npm
  // install` against the project's own package.json) had no reliable
  // way to do that. A fixed relative escape like `cd ../../..` silently
  // overshoots whenever install_target's actual depth differs from what
  // it was declared at (e.g. adaptSrcDirPath shortening it) -- confirmed
  // the hard way: this actually installed real packages into a real
  // project's PARENT directory. DELIVERYOS_PROJECT_ROOT is the fix.
  it('passes the real project root as DELIVERYOS_PROJECT_ROOT, independent of how deep installTarget actually is', async () => {
    writeRegistry(['test-remote']);
    // Writes the env var's own value to a file INSIDE installTarget (its
    // real cwd) -- proving both that the var is set, and that it's set
    // to the real `cwd` this test controls, not installTarget itself or
    // some other guessed path.
    writeArtifact(
      'project-root-env-install',
      'node -e "require(\'fs\').writeFileSync(\'root.txt\', process.env.DELIVERYOS_PROJECT_ROOT || \'\')"',
    );

    const result = await pullArtifact('project-root-env-install', undefined, cwd);

    const written = fs.readFileSync(path.join(result.installTarget, 'root.txt'), 'utf-8');
    expect(written).toBe(cwd);
  }, 30_000);
});

describe('pullArtifact containment checks (install_target / payload_path)', () => {
  it('refuses install_target that resolves outside cwd, before any file is written', async () => {
    writeRegistry(['test-remote']);
    const remoteCacheDir = remoteCachePath('test-remote');
    const payloadDir = path.join(remoteCacheDir, 'artifacts', 'evil-target', 'payload');
    fs.mkdirSync(payloadDir, { recursive: true });
    fs.writeFileSync(path.join(payloadDir, 'README.md'), '# evil\n', 'utf-8');
    fs.writeFileSync(
      path.join(remoteCacheDir, 'artifacts', 'evil-target', 'manifest.yaml'),
      [
        'id: evil-target',
        'kind: template',
        'description: Test artifact with a malicious install_target',
        'owner: team-x',
        'version: 1.0.0',
        'source_repo: https://example.invalid/repo',
        'install_target: ../../../../escaped',
        'review_required: false',
        '',
      ].join('\n'),
      'utf-8',
    );

    await expect(pullArtifact('evil-target', undefined, cwd)).rejects.toBeInstanceOf(ManifestValidationError);
    // Nothing was created outside cwd -- the escape target's parent (four
    // levels up from cwd) never gains an "escaped" child directory.
    expect(fs.existsSync(path.join(cwd, '..', '..', '..', '..', 'escaped'))).toBe(false);
  });

  it('refuses payload_path that resolves outside the remote clone', async () => {
    writeRegistry(['test-remote']);
    const remoteCacheDir = remoteCachePath('test-remote');
    fs.mkdirSync(path.join(remoteCacheDir, 'artifacts', 'evil-payload'), { recursive: true });
    fs.writeFileSync(
      path.join(remoteCacheDir, 'artifacts', 'evil-payload', 'manifest.yaml'),
      [
        'id: evil-payload',
        'kind: template',
        'description: Test artifact with a malicious payload_path',
        'owner: team-x',
        'version: 1.0.0',
        'source_repo: https://example.invalid/repo',
        'install_target: installed',
        'review_required: false',
        'payload_path: ../../../../escaped',
        '',
      ].join('\n'),
      'utf-8',
    );

    await expect(pullArtifact('evil-payload', undefined, cwd)).rejects.toBeInstanceOf(ManifestValidationError);
  });

  it('reports a clear error (not a raw ENOENT) when the payload source does not exist on disk', async () => {
    writeRegistry(['test-remote']);
    const remoteCacheDir = remoteCachePath('test-remote');
    // Manifest written, but its artifacts/<id>/payload/ directory never
    // created -- a bad payload_path or an out-of-date remote.
    fs.mkdirSync(path.join(remoteCacheDir, 'artifacts', 'missing-payload'), { recursive: true });
    fs.writeFileSync(
      path.join(remoteCacheDir, 'artifacts', 'missing-payload', 'manifest.yaml'),
      [
        'id: missing-payload',
        'kind: template',
        'description: Test artifact with no real payload on disk',
        'owner: team-x',
        'version: 1.0.0',
        'source_repo: https://example.invalid/repo',
        'install_target: installed',
        'review_required: false',
        '',
      ].join('\n'),
      'utf-8',
    );

    await expect(pullArtifact('missing-payload', undefined, cwd)).rejects.toBeInstanceOf(ArtifactResolutionError);
  });
});

function writeArtifactWithInstallTarget(id: string, installTarget: string): void {
  const remoteCacheDir = remoteCachePath('test-remote');
  const payloadDir = path.join(remoteCacheDir, 'artifacts', id, 'payload');
  fs.mkdirSync(payloadDir, { recursive: true });
  fs.writeFileSync(path.join(payloadDir, 'README.md'), `# ${id}\n`, 'utf-8');
  fs.writeFileSync(
    path.join(remoteCacheDir, 'artifacts', id, 'manifest.yaml'),
    [
      `id: ${id}`,
      `kind: template`,
      `description: Test artifact for install_target src/ adaptation`,
      `owner: team-x`,
      `version: 1.0.0`,
      `source_repo: https://example.invalid/repo`,
      `install_target: ${installTarget}`,
      `review_required: false`,
      `post_install: node -e "process.exit(0)"`,
      '',
    ].join('\n'),
    'utf-8',
  );
}

describe('pullArtifact install_target src/ convention adaptation', () => {
  it('strips the src/ prefix from install_target when the real project uses a root app/ directory', async () => {
    writeRegistry(['test-remote']);
    writeArtifactWithInstallTarget('src-install-target', 'src/lib/auth');
    fs.mkdirSync(path.join(cwd, 'app'), { recursive: true });

    const result = await pullArtifact('src-install-target', undefined, cwd);

    expect(result.installTarget).toBe(path.resolve(cwd, 'lib', 'auth'));
  }, 30_000);

  it('keeps the src/ prefix on install_target when the real project uses src/app', async () => {
    writeRegistry(['test-remote']);
    writeArtifactWithInstallTarget('src-install-target-kept', 'src/lib/auth');
    fs.mkdirSync(path.join(cwd, 'src', 'app'), { recursive: true });

    const result = await pullArtifact('src-install-target-kept', undefined, cwd);

    expect(result.installTarget).toBe(path.resolve(cwd, 'src', 'lib', 'auth'));
  }, 30_000);

  it('falls back to the raw manifest install_target when placement is genuinely ambiguous', async () => {
    writeRegistry(['test-remote']);
    writeArtifactWithInstallTarget('src-install-target-ambiguous', 'src/lib/auth');

    const result = await pullArtifact('src-install-target-ambiguous', undefined, cwd);

    expect(result.installTarget).toBe(path.resolve(cwd, 'src', 'lib', 'auth'));
  }, 30_000);
});

describe('pullArtifact lockfile recording (Phase 13 uninstall groundwork)', () => {
  it('records the real resolved installTarget on the lockfile entry it writes', async () => {
    writeRegistry(['test-remote']);
    writeArtifact('records-install-target', 'node -e "process.exit(0)"');

    const result = await pullArtifact('records-install-target', undefined, cwd);

    const lockfile = readLockfile(cwd);
    const entry = lockfile.entries.find((e) => e.id === 'records-install-target');
    expect(entry?.installTarget).toBe(result.installTarget);
    expect(entry?.installTarget).toBe(path.resolve(cwd, 'installed'));
  }, 30_000);

  it('re-pulling an already-installed artifact preserves its wiredFiles/pendingPr -- a real bug found via review: the lockfile write used to construct a bare {id,version,remote,installTarget} instead of spreading the existing entry, silently wiping both fields on any re-pull', async () => {
    writeRegistry(['test-remote']);
    writeArtifact('preserves-lockfile-fields', 'node -e "process.exit(0)"');

    await pullArtifact('preserves-lockfile-fields', undefined, cwd);

    // Simulates what pullAndAutoWire (wiredFiles) and a real pushed edit
    // (pendingPr) would have already recorded before this second pull.
    const entryBefore = readLockfile(cwd).entries.find((e) => e.id === 'preserves-lockfile-fields')!;
    await upsertEntry(cwd, {
      ...entryBefore,
      wiredFiles: ['src/auth.ts', 'src/middleware.ts'],
      pendingPr: { url: 'https://github.com/example/repo/pull/1', number: 1 },
    });

    await pullArtifact('preserves-lockfile-fields', undefined, cwd);

    const entryAfter = readLockfile(cwd).entries.find((e) => e.id === 'preserves-lockfile-fields');
    expect(entryAfter?.wiredFiles).toEqual(['src/auth.ts', 'src/middleware.ts']);
    expect(entryAfter?.pendingPr).toEqual({ url: 'https://github.com/example/repo/pull/1', number: 1 });
  }, 30_000);
});
