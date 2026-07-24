import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';

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
