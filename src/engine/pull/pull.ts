import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { buildCatalog, CatalogEntry } from '../catalog/catalog';
import { cachePath } from '../remote/remoteCache';
import { upsertEntry } from '../lockfile/lockfile';
import { pristinePath } from '../paths';
import { ArtifactResolutionError, PostInstallError } from '../errors';
import { Manifest } from '../manifest/schema';

export interface PullResult {
  manifest: Manifest;
  remoteName: string;
  installTarget: string;
}

/**
 * Resolves which catalog entry `id` refers to. Throws
 * ArtifactResolutionError if the id doesn't exist anywhere, or if it exists
 * in more than one remote and `remoteName` wasn't supplied to disambiguate.
 */
export function resolveArtifact(
  id: string,
  remoteName: string | undefined,
  catalog: CatalogEntry[] = buildCatalog(),
): CatalogEntry {
  const matches = catalog.filter((entry) => entry.manifest.id === id);

  if (matches.length === 0) {
    throw new ArtifactResolutionError(`No artifact with id "${id}" found in any registered remote`);
  }

  if (remoteName) {
    const match = matches.find((entry) => entry.remoteName === remoteName);
    if (!match) {
      throw new ArtifactResolutionError(
        `No artifact with id "${id}" found in remote "${remoteName}"`,
      );
    }
    return match;
  }

  if (matches.length > 1) {
    const remoteNames = matches.map((entry) => entry.remoteName).join(', ');
    throw new ArtifactResolutionError(
      `Artifact id "${id}" is ambiguous: found in multiple remotes (${remoteNames}). Use --remote to disambiguate.`,
    );
  }

  return matches[0];
}

/**
 * Pulls the artifact identified by `id` (optionally scoped to `remoteName`)
 * into `cwd`: copies its payload into install_target, runs post_install if
 * present, then upserts the cwd-scoped lockfile. The lockfile is only
 * updated once both the copy and post_install succeed.
 */
export function pullArtifact(id: string, remoteName: string | undefined, cwd: string): PullResult {
  const entry = resolveArtifact(id, remoteName);
  const { manifest, remoteName: resolvedRemoteName } = entry;

  const remoteDir = cachePath(resolvedRemoteName);
  const payloadDir = path.join(remoteDir, 'artifacts', manifest.id, 'payload');
  const installTarget = path.resolve(cwd, manifest.install_target);

  fs.cpSync(payloadDir, installTarget, { recursive: true });

  if (manifest.post_install) {
    try {
      execSync(manifest.post_install, { cwd: installTarget, stdio: 'inherit' });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new PostInstallError(
        `post_install command failed for artifact "${manifest.id}": ${detail}`,
      );
    }
  }

  // Snapshot a pristine copy of the payload as-pulled, so `push` can later
  // diff a local edit against exactly what was installed (not against
  // mtimes, which change on every checkout/copy).
  const pristineTarget = pristinePath(cwd, manifest.id);
  if (fs.existsSync(pristineTarget)) {
    fs.rmSync(pristineTarget, { recursive: true, force: true });
  }
  fs.cpSync(payloadDir, pristineTarget, { recursive: true });

  upsertEntry(cwd, {
    id: manifest.id,
    version: manifest.version,
    remote: resolvedRemoteName,
  });

  return { manifest, remoteName: resolvedRemoteName, installTarget };
}
