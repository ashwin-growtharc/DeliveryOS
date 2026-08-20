import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stringify } from 'yaml';
import { removeArtifact } from '../../src/engine/pull/removeArtifact';
import { readLockfile, upsertEntry } from '../../src/engine/lockfile/lockfile';
import { pristinePath, remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';
import { ArtifactNotPulledError } from '../../src/engine/errors';
import { Manifest } from '../../src/engine/manifest/schema';

// Same lightweight "fake a registered remote + cache directly on disk"
// pattern test/unit/pull.test.ts already established -- removeArtifact's
// manifest-resolution fallback goes through the same buildCatalog() ->
// remotes.json + remotes/<name>/artifacts/<id>/manifest.yaml path, so no
// real git clone/fetch is needed here either.

let deliveryOsHome: string;
let originalEnv: string | undefined;
let cwd: string;

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-remove-test-home-'));
  process.env.DELIVERYOS_HOME = deliveryOsHome;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-remove-test-cwd-'));
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

/** Writes a real manifest.yaml (no payload needed -- these tests never call
 * pullArtifact itself, only removeArtifact's own manifest-resolution
 * fallback) directly into a fake remote's cache dir. */
function writeManifest(remoteName: string, manifest: Partial<Manifest> & { id: string }): void {
  const remoteCacheDir = remoteCachePath(remoteName);
  const dir = path.join(remoteCacheDir, 'artifacts', manifest.id);
  fs.mkdirSync(dir, { recursive: true });
  const full = {
    kind: 'backend-plugin',
    description: 'Test artifact for removeArtifact',
    owner: 'team-x',
    version: '1.0.0',
    source_repo: 'https://example.invalid/repo',
    review_required: false,
    ...manifest,
  };
  fs.writeFileSync(path.join(dir, 'manifest.yaml'), stringify(full), 'utf-8');
}

describe('removeArtifact', () => {
  it('deletes the real installTarget and a real wiredFiles entry, and reports a pre-existing file as needing manual review', async () => {
    writeRegistry(['test-remote']);
    writeManifest('test-remote', {
      id: 'my-plugin',
      install_target: 'installed',
      wiring_actions: [
        {
          type: 'suggest_snippet',
          description: 'Wire up a fresh file',
          targetFile: 'wired-file.ts',
          whenAbsent: { instructions: 'Create it.', snippet: 'export const wired = 1;' },
        },
        {
          type: 'suggest_snippet',
          description: 'Wire up a file that already existed',
          targetFile: 'existing-file.ts',
          whenAbsent: { instructions: 'Create it.', snippet: 'export const x = 1;' },
        },
      ],
      install_params: [
        { key: 'MY_SECRET', description: 'A secret', secret: true, required: true },
      ],
    });

    const installTarget = path.join(cwd, 'installed');
    fs.mkdirSync(installTarget, { recursive: true });
    fs.writeFileSync(path.join(installTarget, 'payload.txt'), 'payload', 'utf-8');

    fs.writeFileSync(path.join(cwd, 'wired-file.ts'), 'export const wired = 1;', 'utf-8');
    // Simulates a file that already existed in the project BEFORE this
    // artifact was ever pulled -- never in wiredFiles, so must survive.
    fs.writeFileSync(path.join(cwd, 'existing-file.ts'), 'export const preExisting = 1;', 'utf-8');
    fs.writeFileSync(path.join(cwd, '.env.local'), 'MY_SECRET=super-secret-value\n', 'utf-8');

    const pristineTarget = pristinePath(cwd, 'my-plugin');
    fs.mkdirSync(pristineTarget, { recursive: true });
    fs.writeFileSync(path.join(pristineTarget, 'payload.txt'), 'payload', 'utf-8');

    await upsertEntry(cwd, {
      id: 'my-plugin',
      version: '1.0.0',
      remote: 'test-remote',
      installTarget,
      wiredFiles: ['wired-file.ts'],
    });

    const result = await removeArtifact(cwd, 'my-plugin');

    expect(result.removedInstallTarget).toBe(true);
    expect(fs.existsSync(installTarget)).toBe(false);

    expect(result.removedWiredFiles).toEqual(['wired-file.ts']);
    expect(fs.existsSync(path.join(cwd, 'wired-file.ts'))).toBe(false);

    expect(result.filesNeedingManualReview).toEqual(['existing-file.ts']);
    expect(fs.existsSync(path.join(cwd, 'existing-file.ts'))).toBe(true);

    expect(result.envParamsStillSet).toEqual(['MY_SECRET']);
    // .env.local is purely informational -- never touched.
    expect(fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8')).toContain('MY_SECRET=super-secret-value');

    expect(result.removedPristineSnapshot).toBe(true);
    expect(fs.existsSync(pristineTarget)).toBe(false);

    const lockfile = readLockfile(cwd);
    expect(lockfile.entries.find((e) => e.id === 'my-plugin')).toBeUndefined();
  });

  it('throws ArtifactNotPulledError for an id that was never pulled (no lockfile entry)', async () => {
    await expect(removeArtifact(cwd, 'never-pulled')).rejects.toThrow(ArtifactNotPulledError);
  });

  it('falls back to resolving installTarget via the manifest when the lockfile entry has no installTarget recorded (old-shape entry)', async () => {
    writeRegistry(['test-remote']);
    writeManifest('test-remote', { id: 'old-shape-plugin', install_target: 'installed' });

    const installTarget = path.join(cwd, 'installed');
    fs.mkdirSync(installTarget, { recursive: true });
    fs.writeFileSync(path.join(installTarget, 'payload.txt'), 'payload', 'utf-8');

    // Old-shape entry: no installTarget, no wiredFiles -- exactly what a
    // lockfile entry written before these fields existed looks like.
    await upsertEntry(cwd, { id: 'old-shape-plugin', version: '1.0.0', remote: 'test-remote' });

    const result = await removeArtifact(cwd, 'old-shape-plugin');

    expect(result.removedInstallTarget).toBe(true);
    expect(fs.existsSync(installTarget)).toBe(false);
    const lockfile = readLockfile(cwd);
    expect(lockfile.entries.find((e) => e.id === 'old-shape-plugin')).toBeUndefined();
  });

  it('never deletes anything outside cwd even when a wiredFiles entry is crafted to escape it', async () => {
    // Same traversal-trap shape as requestWiringMerge.test.ts's own escape
    // test: a deeply-nested cwd keeps "../../../../evil.txt" resolving to a
    // FIXED ancestor this test fully controls, not a randomized real path.
    const trapRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-remove-traversal-trap-'));
    const nestedCwd = path.join(trapRoot, 'a', 'b', 'c', 'd', 'project');
    fs.mkdirSync(nestedCwd, { recursive: true });
    const outsidePath = path.resolve(nestedCwd, '..', '..', '..', '..', 'evil.txt');
    fs.writeFileSync(outsidePath, 'do not delete me', 'utf-8');

    const installTarget = path.join(nestedCwd, 'installed');
    fs.mkdirSync(installTarget, { recursive: true });

    try {
      await upsertEntry(nestedCwd, {
        id: 'escaping-plugin',
        version: '1.0.0',
        remote: 'nonexistent-remote',
        installTarget,
        wiredFiles: ['../../../../evil.txt'],
      });

      const result = await removeArtifact(nestedCwd, 'escaping-plugin');

      expect(result.removedWiredFiles).toEqual([]);
      expect(fs.existsSync(outsidePath)).toBe(true);
      expect(fs.readFileSync(outsidePath, 'utf-8')).toBe('do not delete me');
    } finally {
      fs.rmSync(trapRoot, { recursive: true, force: true });
    }
  });

  it('refuses to remove (and deletes nothing) when the lockfile-recorded installTarget itself resolves outside cwd', async () => {
    // The installTarget equivalent of the wiredFiles escape test above --
    // lock.json is a plain project-local file a person (or a bug) could
    // hand-edit; a recursive delete on its own primary target must be
    // re-validated for containment, not just wiredFiles.
    const trapRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-remove-installtarget-trap-'));
    const nestedCwd = path.join(trapRoot, 'a', 'b', 'c', 'd', 'project');
    fs.mkdirSync(nestedCwd, { recursive: true });
    const outsideDir = path.resolve(nestedCwd, '..', '..', '..', '..', 'evil-install-target');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'important.txt'), 'do not delete me', 'utf-8');

    try {
      await upsertEntry(nestedCwd, {
        id: 'escaping-install-target-plugin',
        version: '1.0.0',
        remote: 'nonexistent-remote',
        installTarget: outsideDir,
      });

      await expect(removeArtifact(nestedCwd, 'escaping-install-target-plugin')).rejects.toThrow(
        ArtifactNotPulledError,
      );
      expect(fs.existsSync(outsideDir)).toBe(true);
      expect(fs.readFileSync(path.join(outsideDir, 'important.txt'), 'utf-8')).toBe('do not delete me');

      // Nothing was removed -- the lockfile entry must still be there for
      // a person to inspect, not silently dropped by a failed removal.
      const lockfile = readLockfile(nestedCwd);
      expect(lockfile.entries.find((e) => e.id === 'escaping-install-target-plugin')).toBeDefined();
    } finally {
      fs.rmSync(trapRoot, { recursive: true, force: true });
    }
  });

  it('reports install_params keys still set in .env.local after removal, since .env.local is never touched', async () => {
    writeRegistry(['test-remote']);
    writeManifest('test-remote', {
      id: 'env-plugin',
      install_target: 'installed',
      install_params: [
        { key: 'SHARED_SECRET', description: 'shared', secret: true, required: true },
        { key: 'NEVER_SET', description: 'never configured', secret: false, required: false },
      ],
    });

    const installTarget = path.join(cwd, 'installed');
    fs.mkdirSync(installTarget, { recursive: true });
    fs.writeFileSync(path.join(cwd, '.env.local'), 'SHARED_SECRET=abc123\n', 'utf-8');

    await upsertEntry(cwd, { id: 'env-plugin', version: '1.0.0', remote: 'test-remote', installTarget });

    const result = await removeArtifact(cwd, 'env-plugin');

    expect(result.envParamsStillSet).toEqual(['SHARED_SECRET']);
    expect(fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8')).toBe('SHARED_SECRET=abc123\n');
  });
});
