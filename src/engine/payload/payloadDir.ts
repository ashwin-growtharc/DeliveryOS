import * as path from 'path';
import { resolveArtifact } from '../pull/pull';
import { CatalogEntry } from '../catalog/catalog';
import { cachePath } from '../remote/remoteCache';
import { resolveContainedPath } from '../paths';
import { ManifestValidationError } from '../errors';

/**
 * Resolves a cataloged artifact's real payload directory in its remote's
 * local cache, given just `(remoteName, id)` -- the same `payload_path`
 * escape-hatch convention `pullArtifact`/`pushArtifact`/`compileArtifactPreview`
 * all already used independently before this was factored out here.
 *
 * `payload_path` is untrusted manifest input (same threat model as
 * `pullArtifact`'s own containment check on it) -- resolved here via
 * `resolveContainedPath` rather than a plain `path.join`, so a value like
 * `"../../../../evil"` can't escape the remote's own clone.
 */
export function resolvePayloadDir(
  remoteName: string,
  id: string,
  catalog?: CatalogEntry[],
): string {
  // `catalog` is an optional already-built catalog, mirroring
  // `resolveArtifact`'s own parameter of the same shape. Without it a caller
  // that resolves an artifact and THEN its payload builds the catalog twice
  // -- ~141ms each against the real 230-artifact remote, for identical input.
  const entry = catalog
    ? resolveArtifact(id, remoteName, catalog)
    : resolveArtifact(id, remoteName);
  const { manifest } = entry;
  const remoteDir = cachePath(remoteName);
  if (!manifest.payload_path) {
    return path.join(remoteDir, 'artifacts', manifest.id, 'payload');
  }
  const contained = resolveContainedPath(remoteDir, manifest.payload_path);
  if (!contained) {
    throw new ManifestValidationError(
      `Artifact "${manifest.id}"'s payload_path ("${manifest.payload_path}") resolves outside the `
        + `remote's own directory.`,
    );
  }
  return contained;
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
