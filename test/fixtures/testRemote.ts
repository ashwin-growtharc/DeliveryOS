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
      `post_install: node -e "require('fs').writeFileSync('.post_install_ran', 'done')"`,
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
