import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Manifest } from '../../src/engine/manifest/schema';
import { SignatureVerificationError } from '../../src/engine/errors';

// `verifyArtifactSignature`'s own job is: decide whether to call sigstore's
// `verify()` at all, compute/compare the digest first, and translate a
// pass/throw from `verify()` into a SignatureVerificationError. The actual
// cryptographic correctness of `verify()` itself is a third-party library's
// concern (proven for real against live GitHub Actions/Fulcio/Rekor -- see
// PLAN.md) -- these tests mock the `sigstore` boundary to prove OUR control
// flow calls it correctly and handles both outcomes correctly.
const sigstoreVerifyMock = vi.fn();
vi.mock('sigstore', () => ({
  verify: (...args: unknown[]) => sigstoreVerifyMock(...args),
}));

// Imported AFTER the mock so it picks up the mocked module.
const { verifyArtifactSignature } = await import('../../src/engine/provenance/verify');

const BASE_MANIFEST: Manifest = {
  id: 'signed-artifact',
  kind: 'backend-plugin',
  description: 'A signed test artifact',
  owner: 'someone',
  version: '1.0.0',
  tags: { roles: [], teams: [], stacks: [], componentTypes: [] },
  source_repo: 'https://github.com/example/repo.git',
  install_target: 'src/lib/signed',
  review_required: false,
  install_params: [],
  wiring_actions: [],
};

const SIGNATURE = {
  algorithm: 'cosign' as const,
  certificate_identity:
    'https://github.com/example/repo/.github/workflows/sign-artifacts.yml@refs/heads/main',
  oidc_issuer: 'https://token.actions.githubusercontent.com',
};

const FAKE_BUNDLE = { mediaType: 'application/vnd.dev.sigstore.bundle+json;version=0.3' };

describe('verifyArtifactSignature', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-verify-test-'));
    sigstoreVerifyMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writePayload(content = 'hello'): string {
    fs.writeFileSync(path.join(dir, 'a.txt'), content);
    return dir;
  }

  it('is a no-op (never calls sigstore.verify) when the manifest declares no signature', async () => {
    const payloadPath = writePayload();
    await verifyArtifactSignature(BASE_MANIFEST, payloadPath, undefined);
    expect(sigstoreVerifyMock).not.toHaveBeenCalled();
  });

  it('throws if signature is declared but content_digest is missing', async () => {
    const payloadPath = writePayload();
    const manifest: Manifest = { ...BASE_MANIFEST, signature: SIGNATURE };
    await expect(verifyArtifactSignature(manifest, payloadPath, FAKE_BUNDLE))
      .rejects.toThrow(SignatureVerificationError);
    expect(sigstoreVerifyMock).not.toHaveBeenCalled();
  });

  it('throws if signature and content_digest are declared but no bundle was found (undefined)', async () => {
    const payloadPath = writePayload();
    const manifest: Manifest = {
      ...BASE_MANIFEST,
      signature: SIGNATURE,
      content_digest: 'sha256:' + 'a'.repeat(64),
    };
    await expect(verifyArtifactSignature(manifest, payloadPath, undefined))
      .rejects.toThrow(SignatureVerificationError);
    expect(sigstoreVerifyMock).not.toHaveBeenCalled();
  });

  it('throws on a digest mismatch WITHOUT ever calling sigstore.verify (fails closed before crypto)', async () => {
    const payloadPath = writePayload();
    const manifest: Manifest = {
      ...BASE_MANIFEST,
      signature: SIGNATURE,
      content_digest: 'sha256:' + 'a'.repeat(64), // deliberately wrong
    };
    await expect(verifyArtifactSignature(manifest, payloadPath, FAKE_BUNDLE))
      .rejects.toThrow(/does not match its recorded content_digest/);
    expect(sigstoreVerifyMock).not.toHaveBeenCalled();
  });

  it('calls sigstore.verify with the bundle, the content_digest bytes, and the pinned identity/issuer -- and succeeds when it resolves', async () => {
    const payloadPath = writePayload();
    const { computePayloadDigest } = await import('../../src/engine/provenance/digest');
    const realDigest = computePayloadDigest(payloadPath);
    const manifest: Manifest = { ...BASE_MANIFEST, signature: SIGNATURE, content_digest: realDigest };

    sigstoreVerifyMock.mockResolvedValueOnce({ key: {}, identity: {} });

    await expect(verifyArtifactSignature(manifest, payloadPath, FAKE_BUNDLE)).resolves.toBeUndefined();

    expect(sigstoreVerifyMock).toHaveBeenCalledTimes(1);
    const [calledBundle, calledPayload, calledOptions] = sigstoreVerifyMock.mock.calls[0];
    expect(calledBundle).toBe(FAKE_BUNDLE);
    expect(Buffer.isBuffer(calledPayload)).toBe(true);
    expect((calledPayload as Buffer).toString('utf-8')).toBe(realDigest);
    expect(calledOptions).toEqual({
      certificateIssuer: SIGNATURE.oidc_issuer,
      certificateIdentityURI: SIGNATURE.certificate_identity,
    });
  });

  it('throws SignatureVerificationError when sigstore.verify rejects (real signature/identity mismatch)', async () => {
    const payloadPath = writePayload();
    const { computePayloadDigest } = await import('../../src/engine/provenance/digest');
    const realDigest = computePayloadDigest(payloadPath);
    const manifest: Manifest = { ...BASE_MANIFEST, signature: SIGNATURE, content_digest: realDigest };

    sigstoreVerifyMock.mockRejectedValue(new Error('certificate identity mismatch'));

    await expect(verifyArtifactSignature(manifest, payloadPath, FAKE_BUNDLE))
      .rejects.toThrow(SignatureVerificationError);
    await expect(verifyArtifactSignature(manifest, payloadPath, FAKE_BUNDLE))
      .rejects.toThrow(/certificate identity mismatch/);
  });
});
