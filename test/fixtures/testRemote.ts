import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { computePayloadDigest } from '../../src/engine/provenance/digest';

export interface TestArtifact {
  id: string;
  kind: string;
  installTarget: string;
  hasPostInstall: boolean;
}

/** ids/kinds of the 3 artifacts seeded by createTestRemote(), exposed so
 * tests don't have to hardcode magic strings. */
export const TEST_ARTIFACTS: TestArtifact[] = [
  { id: 'welcome-template', kind: 'template', installTarget: 'welcome', hasPostInstall: false },
  { id: 'handbook-doc', kind: 'doc', installTarget: 'handbook', hasPostInstall: true },
  { id: 'lint-config', kind: 'config', installTarget: 'lint-config', hasPostInstall: false },
];

function manifestYaml(artifact: TestArtifact): string {
  const lines = [
    `id: ${artifact.id}`,
    `kind: ${artifact.kind}`,
    `description: Test artifact of kind ${artifact.kind}`,
    `owner: test-team`,
    `version: 1.0.0`,
    `tags:`,
    `  roles: []`,
    `  teams: []`,
    `  stacks: []`,
    `source_repo: https://example.invalid/test-remote`,
    `install_target: ${artifact.installTarget}`,
    `review_required: false`,
  ];
  if (artifact.hasPostInstall) {
    lines.push(
      `post_install: node -e "require('fs').writeFileSync('.post_install_ran', 'done'); console.log('post_install ran for ${artifact.id}')"`,
    );
  }
  return lines.join('\n') + '\n';
}

/**
 * Creates a temp directory containing a plain (non-bare) git repo seeded
 * with 3 artifacts (template/doc/config kinds), exactly one of which has a
 * post_install command. Returns the repo's filesystem path.
 */
export async function createTestRemote(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-test-remote-'));

  const git = simpleGit(dir);
  await git.init();
  // Repo-local (not global) identity so this works unmodified in CI.
  await git.addConfig('user.name', 'DeliveryOS Test', false, 'local');
  await git.addConfig('user.email', 'test@deliveryos.invalid', false, 'local');

  for (const artifact of TEST_ARTIFACTS) {
    const artifactDir = path.join(dir, 'artifacts', artifact.id);
    const payloadDir = path.join(artifactDir, 'payload');
    fs.mkdirSync(payloadDir, { recursive: true });

    fs.writeFileSync(path.join(artifactDir, 'manifest.yaml'), manifestYaml(artifact), 'utf-8');
    fs.writeFileSync(
      path.join(payloadDir, 'README.md'),
      `# ${artifact.id}\n\nPayload for ${artifact.kind} artifact.\n`,
      'utf-8',
    );
  }

  await git.add('.');
  await git.commit('seed test remote');

  return dir;
}

/** Recursively removes the temp directory created by createTestRemote(). */
export async function teardownTestRemote(dir: string): Promise<void> {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** id/installTarget of the extra `kind: ui-component` artifact seeded by
 * createTestRemoteWithUiComponentArtifact() -- exposed so tests don't have
 * to hardcode magic strings. Its payload has a real `Button.tsx` +
 * `preview.tsx`, needed to exercise Phase E's preview.png generation (which
 * is gated purely on a preview entry file existing -- none of
 * TEST_ARTIFACTS' template/doc/config fixtures have one). */
export const UI_COMPONENT_ARTIFACT = {
  id: 'test-button',
  installTarget: 'test-button',
} as const;

const UI_COMPONENT_TSX = `export interface ButtonProps {
  label: string;
}

export function Button({ label }: ButtonProps) {
  return <button style={{ padding: '8px 16px' }}>{label}</button>;
}
`;

const UI_COMPONENT_PREVIEW_TSX = `import { Button } from './Button';

export const Default = () => <Button label="Click me" />;
`;

function uiComponentManifestYaml(): string {
  const lines = [
    `id: ${UI_COMPONENT_ARTIFACT.id}`,
    `kind: ui-component`,
    `description: Test ui-component artifact with a real preview.tsx`,
    `owner: test-team`,
    `version: 1.0.0`,
    `tags:`,
    `  roles: []`,
    `  teams: []`,
    `  stacks: []`,
    `  componentTypes: [button]`,
    `source_repo: https://example.invalid/test-remote`,
    `install_target: ${UI_COMPONENT_ARTIFACT.installTarget}`,
    `review_required: false`,
  ];
  return lines.join('\n') + '\n';
}

/**
 * Like createTestRemote(), but seeds one additional `kind: ui-component`
 * artifact (UI_COMPONENT_ARTIFACT) whose payload is a real Button.tsx +
 * preview.tsx pair -- the shape Phase E's preview.png generation (push.ts's
 * `maybeRenderPreviewImage`) actually needs to exercise. Kept separate from
 * createTestRemote() for the same reason
 * createTestRemoteWithPayloadPathArtifact() is: every pre-existing test
 * that assumes "exactly 3 seeded artifacts" keeps working unmodified.
 */
export async function createTestRemoteWithUiComponentArtifact(): Promise<string> {
  const dir = await createTestRemote();
  const git = simpleGit(dir);

  const payloadDir = path.join(dir, 'artifacts', UI_COMPONENT_ARTIFACT.id, 'payload');
  fs.mkdirSync(payloadDir, { recursive: true });
  fs.writeFileSync(path.join(payloadDir, 'Button.tsx'), UI_COMPONENT_TSX, 'utf-8');
  fs.writeFileSync(path.join(payloadDir, 'preview.tsx'), UI_COMPONENT_PREVIEW_TSX, 'utf-8');

  const manifestDir = path.join(dir, 'artifacts', UI_COMPONENT_ARTIFACT.id);
  fs.writeFileSync(path.join(manifestDir, 'manifest.yaml'), uiComponentManifestYaml(), 'utf-8');

  await git.add('.');
  await git.commit('seed ui-component test artifact');

  return dir;
}

/** id/payload_path/install_target of the extra artifact seeded by
 * createTestRemoteWithPayloadPathArtifact(), exposed so tests don't have to
 * hardcode magic strings. Its payload lives at the fixture repo's root
 * (`docs/real-file.md`), well outside any `artifacts/` folder -- mimicking
 * ArcOS's real catalog shape (e.g. `catalog/agents/code-reviewer.md`), where
 * the payload is a pre-existing, actively-maintained file rather than a
 * duplicate shadow copy under artifacts/<id>/payload/. */
export const PAYLOAD_PATH_ARTIFACT = {
  id: 'real-file-artifact',
  payloadPath: 'docs/real-file.md',
  installTarget: 'installed-real-file.md',
} as const;

const PAYLOAD_PATH_ARTIFACT_CONTENT =
  '# real file\n\nThis file lives at its real location, outside artifacts/, and is not duplicated.\n';

function payloadPathManifestYaml(): string {
  const lines = [
    `id: ${PAYLOAD_PATH_ARTIFACT.id}`,
    `kind: doc`,
    `description: Test artifact whose payload lives at its real location outside artifacts/`,
    `owner: test-team`,
    `version: 1.0.0`,
    `tags:`,
    `  roles: []`,
    `  teams: []`,
    `  stacks: []`,
    `source_repo: https://example.invalid/test-remote`,
    `install_target: ${PAYLOAD_PATH_ARTIFACT.installTarget}`,
    `payload_path: ${PAYLOAD_PATH_ARTIFACT.payloadPath}`,
    `review_required: false`,
  ];
  return lines.join('\n') + '\n';
}

/**
 * Like createTestRemote(), but seeds one additional artifact
 * (PAYLOAD_PATH_ARTIFACT) whose manifest sets `payload_path` to a real file
 * living at the fixture repo's root (`docs/real-file.md`) -- outside any
 * artifacts/ folder -- instead of a duplicated copy under
 * artifacts/<id>/payload/. The artifact's manifest.yaml still lives at the
 * usual artifacts/<id>/manifest.yaml location (discoverManifests requires
 * that); only its *payload* points elsewhere.
 *
 * Kept separate from createTestRemote() (rather than folding this 4th
 * artifact into TEST_ARTIFACTS) so every pre-existing test that assumes
 * "exactly 3 seeded artifacts" keeps working unmodified.
 */
export async function createTestRemoteWithPayloadPathArtifact(): Promise<string> {
  const dir = await createTestRemote();
  const git = simpleGit(dir);

  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'real-file.md'), PAYLOAD_PATH_ARTIFACT_CONTENT, 'utf-8');

  const manifestDir = path.join(dir, 'artifacts', PAYLOAD_PATH_ARTIFACT.id);
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(path.join(manifestDir, 'manifest.yaml'), payloadPathManifestYaml(), 'utf-8');

  await git.add('.');
  await git.commit('seed payload_path test artifact');

  return dir;
}

/** id/installTarget/params of the extra `kind: backend-plugin` artifact
 * seeded by createTestRemoteWithInstallParamsArtifact() -- mirrors the real
 * `nextauth-credentials` artifact's shape (Phase 7) at test scale: one
 * secret+required param with no default (must come from --set or the app's
 * checklist, or it's reported missing), one non-secret+required param WITH
 * a default (satisfied even with no input at all), and one more
 * secret+required param with no default. Also declares two `wiring_actions`
 * (Phase 7 item 6) mirroring the real target's two representative shapes:
 * one with no `whenPresent` at all ("this already exists, review before
 * touching it"), one WITH a `whenPresent` (merge-guidance instructions,
 * still no snippet -- the real `middleware.ts` case). */
export const INSTALL_PARAMS_ARTIFACT = {
  id: 'test-backend-plugin',
  installTarget: 'test-backend-plugin',
} as const;

function installParamsManifestYaml(): string {
  const lines = [
    `id: ${INSTALL_PARAMS_ARTIFACT.id}`,
    `kind: backend-plugin`,
    `description: Test backend-plugin artifact with real install_params`,
    `owner: test-team`,
    `version: 1.0.0`,
    `tags:`,
    `  roles: []`,
    `  teams: []`,
    `  stacks: []`,
    `source_repo: https://example.invalid/test-remote`,
    `install_target: ${INSTALL_PARAMS_ARTIFACT.installTarget}`,
    `review_required: false`,
    `install_params:`,
    `  - key: AUTH_SECRET`,
    `    description: Session-signing secret`,
    `    secret: true`,
    `    required: true`,
    `  - key: AUTH_URL`,
    `    description: Canonical app URL`,
    `    secret: false`,
    `    required: true`,
    `    default: http://localhost:3000`,
    `  - key: DATABASE_URL`,
    `    description: Postgres connection string`,
    `    secret: true`,
    `    required: true`,
    `wiring_actions:`,
    `  - type: suggest_snippet`,
    `    description: Wire up the root auth entry point`,
    `    targetFile: auth.ts`,
    `    whenAbsent:`,
    `      instructions: Create auth.ts at your project root.`,
    `      snippet: "export const { handlers, auth } = NextAuth(authConfig);"`,
    `  - type: suggest_snippet`,
    `    description: Wire up the auth middleware`,
    `    targetFile: middleware.ts`,
    `    whenAbsent:`,
    `      instructions: Create middleware.ts at your project root.`,
    `      snippet: "export { auth as middleware } from './auth';"`,
    `    whenPresent:`,
    `      instructions: Merge the auth re-export into your existing middleware.ts.`,
  ];
  return lines.join('\n') + '\n';
}

/**
 * Like createTestRemote(), but seeds one additional `kind: backend-plugin`
 * artifact (INSTALL_PARAMS_ARTIFACT) declaring real install_params -- the
 * shape Phase 7's item 2/4 work (manifest schema + Pull-time collection)
 * actually needs to exercise. Kept separate from createTestRemote() for the
 * same reason every other `createTestRemoteWith*` variant is: every
 * pre-existing test that assumes "exactly 3 seeded artifacts" keeps working
 * unmodified.
 */
export async function createTestRemoteWithInstallParamsArtifact(): Promise<string> {
  const dir = await createTestRemote();
  const git = simpleGit(dir);

  const payloadDir = path.join(dir, 'artifacts', INSTALL_PARAMS_ARTIFACT.id, 'payload');
  fs.mkdirSync(payloadDir, { recursive: true });
  fs.writeFileSync(
    path.join(payloadDir, 'README.md'),
    `# ${INSTALL_PARAMS_ARTIFACT.id}\n\nTest backend-plugin payload.\n`,
    'utf-8',
  );

  const manifestDir = path.join(dir, 'artifacts', INSTALL_PARAMS_ARTIFACT.id);
  fs.writeFileSync(path.join(manifestDir, 'manifest.yaml'), installParamsManifestYaml(), 'utf-8');

  await git.add('.');
  await git.commit('seed install_params test artifact');

  return dir;
}

/** id/installTarget of the extra artifact seeded by
 * createTestRemoteWithSignedArtifact() (Phase 7 item 3). Deliberately does
 * NOT attempt to fake a real, valid Sigstore signature -- that's proven for
 * real against live GitHub Actions/Fulcio/Rekor (see PLAN.md). This fixture
 * covers the two "fails closed, before any files are written" cases that
 * DON'T require real cryptography: a declared signature with no bundle file
 * present, and a declared signature whose content_digest doesn't match the
 * actual payload. */
export const SIGNED_ARTIFACT = {
  id: 'test-signed-artifact',
  installTarget: 'test-signed-artifact',
} as const;

function signedArtifactManifestYaml(contentDigest: string): string {
  const lines = [
    `id: ${SIGNED_ARTIFACT.id}`,
    `kind: backend-plugin`,
    `description: Test artifact declaring a signature (Phase 7 item 3)`,
    `owner: test-team`,
    `version: 1.0.0`,
    `tags:`,
    `  roles: []`,
    `  teams: []`,
    `  stacks: []`,
    `source_repo: https://example.invalid/test-remote`,
    `install_target: ${SIGNED_ARTIFACT.installTarget}`,
    `review_required: false`,
    `content_digest: "${contentDigest}"`,
    `signature:`,
    `  algorithm: cosign`,
    `  certificate_identity: https://github.com/example/repo/.github/workflows/sign-artifacts.yml@refs/heads/main`,
    `  oidc_issuer: https://token.actions.githubusercontent.com`,
  ];
  return lines.join('\n') + '\n';
}

/**
 * Like createTestRemote(), but seeds one additional `kind: backend-plugin`
 * artifact that declares a `content_digest`/`signature`, matching the real
 * shape a signed `nextauth-credentials`-style artifact has once item 3's
 * signing workflow has run. `contentDigestMatchesPayload: false` produces a
 * manifest whose recorded digest doesn't match the real payload (a tampered/
 * stale-record case); `includeSignatureBundle: false` omits the sibling
 * signature.bundle file entirely (a never-signed-for-real case). Both
 * should refuse the pull before any files are written, with no cryptography
 * needed to prove it -- see verifyArtifactSignature's own digest-then-bundle
 * ordering.
 */
export async function createTestRemoteWithSignedArtifact(options: {
  contentDigestMatchesPayload: boolean;
  includeSignatureBundle: boolean;
}): Promise<string> {
  const dir = await createTestRemote();
  const git = simpleGit(dir);

  const manifestDir = path.join(dir, 'artifacts', SIGNED_ARTIFACT.id);
  const payloadDir = path.join(manifestDir, 'payload');
  fs.mkdirSync(payloadDir, { recursive: true });
  fs.writeFileSync(path.join(payloadDir, 'index.js'), 'module.exports = 1;\n', 'utf-8');

  const realDigest = computePayloadDigest(payloadDir);
  const recordedDigest = options.contentDigestMatchesPayload
    ? realDigest
    : `sha256:${'0'.repeat(64)}`;

  fs.writeFileSync(
    path.join(manifestDir, 'manifest.yaml'),
    signedArtifactManifestYaml(recordedDigest),
    'utf-8',
  );

  if (options.includeSignatureBundle) {
    fs.writeFileSync(
      path.join(manifestDir, 'signature.bundle'),
      JSON.stringify({ mediaType: 'application/vnd.dev.sigstore.bundle+json;version=0.3', fake: true }),
      'utf-8',
    );
  }

  await git.add('.');
  await git.commit('seed signed test artifact');

  return dir;
}
