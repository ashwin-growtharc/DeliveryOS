import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildWireContextMarkdown, resolveWireTarget } from '../../src/engine/pull/buildWireContext';
import { Manifest } from '../../src/engine/manifest/schema';
import { LockEntry } from '../../src/engine/lockfile/types';
import { lockfilePath, remoteCachePath, remotesRegistryPath } from '../../src/engine/paths';
import { ArtifactNotPulledError } from '../../src/engine/errors';

function fakeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    id: 'email-code-auth',
    kind: 'backend-plugin',
    description: 'Passwordless email login via a stateless 6-digit code.',
    owner: 'team-x',
    version: '1.0.0',
    tags: { roles: [], teams: [], stacks: [], componentTypes: [] },
    source_repo: 'https://example.invalid/repo',
    install_target: 'lib/auth',
    review_required: false,
    install_params: [],
    wiring_actions: [],
    ...overrides,
  };
}

function fakeLockEntry(overrides: Partial<LockEntry> = {}): LockEntry {
  return {
    id: 'email-code-auth',
    version: '1.0.0',
    remote: 'test-remote',
    ...overrides,
  };
}

describe('buildWireContextMarkdown', () => {
  it('includes the manifest id and real description', () => {
    const md = buildWireContextMarkdown(fakeManifest(), fakeLockEntry());
    expect(md).toContain('email-code-auth');
    expect(md).toContain('Passwordless email login via a stateless 6-digit code.');
  });

  it('includes the real, resolved installTarget from the lockfile entry, not the manifest\'s own raw install_target', () => {
    const manifest = fakeManifest({ install_target: 'src/lib/auth' });
    const lockEntry = fakeLockEntry({ installTarget: 'lib/auth' });
    const md = buildWireContextMarkdown(manifest, lockEntry);
    expect(md).toContain('lib/auth');
    // The un-adapted manifest value should not be what's shown as "where it landed".
    expect(md).not.toContain('src/lib/auth');
  });

  it('lists every real wiredFiles path', () => {
    const lockEntry = fakeLockEntry({
      installTarget: 'lib/auth',
      wiredFiles: ['auth.ts', 'middleware.ts', 'app/api/auth/[...nextauth]/route.ts'],
    });
    const md = buildWireContextMarkdown(fakeManifest(), lockEntry);
    expect(md).toContain('auth.ts');
    expect(md).toContain('middleware.ts');
    expect(md).toContain('app/api/auth/[...nextauth]/route.ts');
  });

  it('omits the "where it landed" section entirely when installTarget is absent (an old-shape lockfile entry)', () => {
    const md = buildWireContextMarkdown(fakeManifest(), fakeLockEntry({ installTarget: undefined }));
    expect(md).not.toContain('Where it landed');
  });

  it('omits the wired-files section entirely when wiredFiles is absent or empty', () => {
    const mdAbsent = buildWireContextMarkdown(fakeManifest(), fakeLockEntry({ wiredFiles: undefined }));
    expect(mdAbsent).not.toContain('already auto-wired');
    const mdEmpty = buildWireContextMarkdown(fakeManifest(), fakeLockEntry({ wiredFiles: [] }));
    expect(mdEmpty).not.toContain('already auto-wired');
  });

  it('instructs actually calling the real functions now, not stopping at a documented seam', () => {
    const md = buildWireContextMarkdown(fakeManifest(), fakeLockEntry());
    const normalized = md.toLowerCase().replace(/\s+/g, ' ');
    expect(normalized).toContain('actually call the real functions');
    expect(normalized).toContain('documented seam');
  });
});

describe('resolveWireTarget', () => {
  let deliveryOsHome: string;
  let originalEnv: string | undefined;
  let cwd: string;

  beforeEach(() => {
    originalEnv = process.env.DELIVERYOS_HOME;
    deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-wire-target-home-'));
    process.env.DELIVERYOS_HOME = deliveryOsHome;
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-wire-target-cwd-'));
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DELIVERYOS_HOME;
    } else {
      process.env.DELIVERYOS_HOME = originalEnv;
    }
    fs.rmSync(deliveryOsHome, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('throws ArtifactNotPulledError, without ever attempting to resolve a remote, when the id has no lockfile entry', () => {
    expect(() => resolveWireTarget(cwd, 'never-pulled', undefined)).toThrow(ArtifactNotPulledError);
    expect(() => resolveWireTarget(cwd, 'never-pulled', undefined)).toThrow(/pull it first/);
  });

  it('resolves the manifest and lockfile entry together for a real, already-pulled artifact', () => {
    const registry = {
      remotes: [{ name: 'test-remote', url: 'https://example.invalid/repo', addedAt: new Date().toISOString() }],
    };
    fs.mkdirSync(deliveryOsHome, { recursive: true });
    fs.writeFileSync(remotesRegistryPath(), JSON.stringify(registry), 'utf-8');

    const remoteCacheDir = remoteCachePath('test-remote');
    fs.mkdirSync(path.join(remoteCacheDir, 'artifacts', 'email-code-auth', 'payload'), { recursive: true });
    fs.writeFileSync(
      path.join(remoteCacheDir, 'artifacts', 'email-code-auth', 'manifest.yaml'),
      [
        'id: email-code-auth',
        'kind: backend-plugin',
        'description: Passwordless email login',
        'owner: team-x',
        'version: 1.0.0',
        'source_repo: https://example.invalid/repo',
        'install_target: lib/auth',
        'review_required: false',
        '',
      ].join('\n'),
      'utf-8',
    );

    fs.mkdirSync(path.join(cwd, '.deliveryos'), { recursive: true });
    fs.writeFileSync(
      lockfilePath(cwd),
      JSON.stringify({
        version: 1,
        entries: [{ id: 'email-code-auth', version: '1.0.0', remote: 'test-remote', installTarget: 'lib/auth' }],
      }),
      'utf-8',
    );

    const { manifest, lockEntry } = resolveWireTarget(cwd, 'email-code-auth', undefined);
    expect(manifest.id).toBe('email-code-auth');
    expect(lockEntry.installTarget).toBe('lib/auth');
  });
});
