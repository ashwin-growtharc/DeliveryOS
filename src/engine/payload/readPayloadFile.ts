import * as fs from 'fs';
import { resolvePayloadDir, resolveWithinPayloadDir } from './payloadDir';

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
 */
export function readArtifactPayloadFile(
  remoteName: string,
  id: string,
  relativePath: string,
): string | undefined {
  const payloadDir = resolvePayloadDir(remoteName, id);
  const resolvedFilePath = resolveWithinPayloadDir(payloadDir, relativePath);

  if (!fs.existsSync(resolvedFilePath) || !fs.statSync(resolvedFilePath).isFile()) {
    return undefined;
  }

  return fs.readFileSync(resolvedFilePath, 'utf-8');
}
