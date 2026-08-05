import { verify as sigstoreVerify, Bundle } from 'sigstore';
import { Manifest } from '../manifest/schema';
import { SignatureVerificationError } from '../errors';
import { computePayloadDigest } from './digest';

/**
 * Verifies a pulled artifact's payload against its manifest's declared
 * `content_digest`/`signature`, BEFORE any files are written into the
 * consuming project (`pullArtifact` calls this ahead of `fs.cpSync`). A
 * no-op for the overwhelming majority of artifacts, which don't declare a
 * `signature` at all -- signing isn't retrofitted onto every existing
 * agent-asset/ui-component, so it must cost nothing for the ones that
 * haven't opted in.
 *
 * `signatureBundle` is the parsed JSON contents of the artifact's sibling
 * `signature.bundle` file (a Sigstore bundle, produced by the signing
 * workflow on the artifact's OWNING remote -- never something DeliveryOS's
 * own engine produces), or `undefined` if that file doesn't exist.
 */
export async function verifyArtifactSignature(
  manifest: Manifest,
  payloadPath: string,
  signatureBundle: unknown,
): Promise<void> {
  if (!manifest.signature) {
    return;
  }

  if (!manifest.content_digest) {
    throw new SignatureVerificationError(
      `Artifact "${manifest.id}" declares a signature but no content_digest to check it against -- refusing to pull.`,
    );
  }

  if (signatureBundle === undefined) {
    throw new SignatureVerificationError(
      `Artifact "${manifest.id}" declares a signature, but no signature bundle was found alongside its manifest -- refusing to pull.`,
    );
  }

  const actualDigest = computePayloadDigest(payloadPath);
  if (actualDigest !== manifest.content_digest) {
    throw new SignatureVerificationError(
      `Artifact "${manifest.id}"'s payload does not match its recorded content_digest `
        + `(expected ${manifest.content_digest}, got ${actualDigest}) -- refusing to pull.`,
    );
  }

  try {
    await sigstoreVerify(
      signatureBundle as Bundle,
      // The signed payload is the UTF-8 bytes of the `content_digest` string
      // itself (e.g. "sha256:abcd...."), not the raw digest bytes -- keeps
      // the signed value human-auditable and matches what the signing
      // workflow signs.
      Buffer.from(manifest.content_digest, 'utf-8'),
      {
        certificateIssuer: manifest.signature.oidc_issuer,
        certificateIdentityURI: manifest.signature.certificate_identity,
      },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SignatureVerificationError(
      `Signature verification failed for artifact "${manifest.id}": ${detail}`,
    );
  }
}
