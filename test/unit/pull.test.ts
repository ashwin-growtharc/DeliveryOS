import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pullArtifact } from '../../src/engine/pull/pull';
import { PostInstallError } from '../../src/engine/errors';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';

// Same lightweight "fake a registered remote + cache directly on disk"
// pattern as test/unit/pullPayloadComponent.test.ts -- pullArtifact reads
// remotes/manifests straight off DELIVERYOS_HOME via buildCatalog(), so no
// real git clone/fetch is needed to exercise post_install's own error
// handling.

// On Windows, killing a timed-out `execSync` call only terminates the
// cmd.exe shell wrapper -- the real grandchild `node` process spawned by
// the timeout test below keeps running independently for its own ~600ms,
// still holding a lock on `cwd`, regardless of the timeout already having
// fired (confirmed by hand). `fs.rmSync`'s own `maxRetries` option was
// tried first and did NOT reliably retry this specific EPERM -- this
// explicit retry loop does.
async function rmDirWithRetry(dir: string): Promise<void> {
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt === maxAttempts || (code !== 'EPERM' && code !== 'EBUSY')) {
        throw err;
      }
      await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
  }
}

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
});
