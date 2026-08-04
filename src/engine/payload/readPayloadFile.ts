import * as fs from 'fs';
import * as path from 'path';
import { resolveArtifact } from '../pull/pull';
import { cachePath } from '../remote/remoteCache';

/**
 * Reads a single file, by relative path, out of a catalog artifact's real
 * payload directory in its remote's local cache -- e.g. Detail's
 * required-config UX rendering a `backend-plugin` artifact's `README.md`
 * before anyone decides to pull it, the same "browse before you commit"
 * principle `compileArtifactPreview` already established for `ui-component`
 * live previews.
 *
 * Returns `undefined` (not an error) when the file doesn't exist -- most
 * artifacts have no README at all, and "no README" is a normal, common
 * case for a caller to render around, not a failure.
 *
 * Sandboxed the same way `compile.ts`'s import resolution is: `relativePath`
 * is caller-supplied (ultimately from the app), so it's resolved and then
 * checked to still be inside the artifact's own payload directory --
 * `../../../../etc/passwd`-shaped input is rejected outright, not silently
 * clamped.
 */
export function readArtifactPayloadFile(
  remoteName: string,
  id: string,
  relativePath: string,
): string | undefined {
  const entry = resolveArtifact(id, remoteName);
  const { manifest } = entry;

  const remoteDir = cachePath(remoteName);
  // Same payload_path escape-hatch convention pullArtifact/pushArtifact/
  // compileArtifactPreview all already use.
  const payloadDir = manifest.payload_path
    ? path.join(remoteDir, manifest.payload_path)
    : path.join(remoteDir, 'artifacts', manifest.id, 'payload');

  const resolvedPayloadDir = path.resolve(payloadDir);
  const resolvedFilePath = path.resolve(payloadDir, relativePath);
  const isInsidePayloadDir = resolvedFilePath === resolvedPayloadDir
    || resolvedFilePath.startsWith(resolvedPayloadDir + path.sep);
  if (!isInsidePayloadDir) {
    throw new Error(
      `Requested file "${relativePath}" resolves outside this artifact's own payload directory`,
    );
  }

  if (!fs.existsSync(resolvedFilePath) || !fs.statSync(resolvedFilePath).isFile()) {
    return undefined;
  }

  return fs.readFileSync(resolvedFilePath, 'utf-8');
}
