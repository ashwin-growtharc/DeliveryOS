import * as path from 'path';
import { resolveArtifact } from '../pull/pull';
import { cachePath } from '../remote/remoteCache';

/**
 * Resolves a cataloged artifact's real payload directory in its remote's
 * local cache, given just `(remoteName, id)` -- the same `payload_path`
 * escape-hatch convention `pullArtifact`/`pushArtifact`/`compileArtifactPreview`
 * all already used independently before this was factored out here.
 */
export function resolvePayloadDir(remoteName: string, id: string): string {
  const entry = resolveArtifact(id, remoteName);
  const { manifest } = entry;
  const remoteDir = cachePath(remoteName);
  return manifest.payload_path
    ? path.join(remoteDir, manifest.payload_path)
    : path.join(remoteDir, 'artifacts', manifest.id, 'payload');
}

/**
 * Resolves `relativePath` against `payloadDir`, refusing (throws) if the
 * result would escape it -- `relativePath` is ultimately caller-supplied
 * (from the app), so `../../../../etc/passwd`-shaped input must be
 * rejected outright, not silently clamped. Sandboxed the same way
 * `compile.ts`'s import resolution already is.
 */
export function resolveWithinPayloadDir(payloadDir: string, relativePath: string): string {
  const resolvedPayloadDir = path.resolve(payloadDir);
  const resolvedPath = path.resolve(payloadDir, relativePath);
  const isInside = resolvedPath === resolvedPayloadDir
    || resolvedPath.startsWith(resolvedPayloadDir + path.sep);
  if (!isInside) {
    throw new Error(
      `Requested path "${relativePath}" resolves outside this artifact's own payload directory`,
    );
  }
  return resolvedPath;
}
