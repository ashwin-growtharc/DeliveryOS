import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createTestRemote, teardownTestRemote, TEST_ARTIFACTS } from '../fixtures/testRemote';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { cloneRemote } from '../../src/engine/remote/remoteCache';
import { pullArtifact } from '../../src/engine/pull/pull';
import { scanForNewArtifacts } from '../../src/engine/scan/scan';

describe('scan e2e', () => {
  let fixtureRemoteDir: string;
  let deliveryOsHome: string;
  let originalEnv: string | undefined;

  beforeAll(async () => {
    originalEnv = process.env.DELIVERYOS_HOME;
    fixtureRemoteDir = await createTestRemote();
    deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-scan-e2e-home-'));
    process.env.DELIVERYOS_HOME = deliveryOsHome;
  }, 30_000);

  afterAll(async () => {
    if (originalEnv === undefined) {
      delete process.env.DELIVERYOS_HOME;
    } else {
      process.env.DELIVERYOS_HOME = originalEnv;
    }
    await teardownTestRemote(fixtureRemoteDir);
    fs.rmSync(deliveryOsHome, { recursive: true, force: true });
  });

  async function registerAndClone(name: string): Promise<void> {
    addRemoteEntry({ name, url: fixtureRemoteDir, addedAt: new Date().toISOString() });
    await cloneRemote(name, fixtureRemoteDir);
  }

  function newScratchCwd(label: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `deliveryos-scan-${label}-`));
  }

  it(
    'finds new agents/skills under .claude, guessing descriptions from frontmatter where present',
    async () => {
      const remoteName = 'scan-test-remote-new';
      await registerAndClone(remoteName);
      const cwd = newScratchCwd('new');

      const agentsDir = path.join(cwd, '.claude', 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentsDir, 'my-new-agent.md'),
        '---\nname: my-new-agent\ndescription: Does something useful.\n---\n\n# Body\n',
        'utf-8',
      );
      // No frontmatter at all -- description should come back undefined,
      // not throw.
      fs.writeFileSync(
        path.join(agentsDir, 'no-frontmatter-agent.md'),
        '# Just a heading\n\nSome instructions.\n',
        'utf-8',
      );

      const skillsDir = path.join(cwd, '.claude', 'skills', 'my-new-skill');
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillsDir, 'SKILL.md'),
        '---\nname: my-new-skill\ndescription: A new reusable skill.\n---\n',
        'utf-8',
      );

      const candidates = await scanForNewArtifacts(cwd, remoteName);
      const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));

      expect(byId['my-new-agent']).toMatchObject({
        kind: 'agent',
        installTarget: '.claude/agents/my-new-agent.md',
        description: 'Does something useful.',
      });
      expect(byId['no-frontmatter-agent']).toMatchObject({
        kind: 'agent',
        description: undefined,
      });
      expect(byId['my-new-skill']).toMatchObject({
        kind: 'skill',
        installTarget: '.claude/skills/my-new-skill',
        description: 'A new reusable skill.',
      });
    },
    30_000,
  );

  it(
    'finds new commands/rules in category subfolders, preserving the subfolder in installTarget',
    async () => {
      const remoteName = 'scan-test-remote-commands-rules';
      await registerAndClone(remoteName);
      const cwd = newScratchCwd('commands-rules');

      const javaCommandsDir = path.join(cwd, '.claude', 'commands', 'java');
      fs.mkdirSync(javaCommandsDir, { recursive: true });
      fs.writeFileSync(
        path.join(javaCommandsDir, 'my-command.md'),
        '---\nname: my-command\ndescription: Runs a thing.\n---\n',
        'utf-8',
      );

      const javaRulesDir = path.join(cwd, '.claude', 'rules', 'java');
      fs.mkdirSync(javaRulesDir, { recursive: true });
      // Real rule files use `paths:`, never `description:` -- confirms
      // description correctly comes back undefined rather than throwing.
      fs.writeFileSync(
        path.join(javaRulesDir, 'my-rule.md'),
        '---\npaths:\n  - "**/*.java"\n---\n# My Rule\n',
        'utf-8',
      );

      // A .md file nested inside a "references" subfolder still becomes its
      // own candidate -- scan doesn't try to detect/exclude that pattern
      // (see scanForNewArtifacts's own doc comment for why).
      const referencesDir = path.join(javaCommandsDir, 'references');
      fs.mkdirSync(referencesDir, { recursive: true });
      fs.writeFileSync(path.join(referencesDir, 'some-reference.md'), '# Some Reference\n', 'utf-8');

      const candidates = await scanForNewArtifacts(cwd, remoteName);
      const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));

      expect(byId['my-command']).toMatchObject({
        kind: 'command',
        installTarget: '.claude/commands/java/my-command.md',
        description: 'Runs a thing.',
      });
      expect(byId['my-rule']).toMatchObject({
        kind: 'rule',
        installTarget: '.claude/rules/java/my-rule.md',
        description: undefined,
      });
      expect(byId['some-reference']).toMatchObject({
        kind: 'command',
        installTarget: '.claude/commands/java/references/some-reference.md',
      });
    },
    30_000,
  );

  it(
    'excludes a local file whose id already exists in the target remote\'s catalog',
    async () => {
      const remoteName = 'scan-test-remote-collision';
      await registerAndClone(remoteName);
      const cwd = newScratchCwd('collision');

      // welcome-template is one of the 3 artifacts createTestRemote() seeds
      // -- a local .claude/agents file that happens to share that id
      // should NOT show up as "new", even though nobody pulled it here.
      const agentsDir = path.join(cwd, '.claude', 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentsDir, 'welcome-template.md'),
        '---\ndescription: Coincidentally the same id as a real remote artifact.\n---\n',
        'utf-8',
      );
      fs.writeFileSync(path.join(agentsDir, 'genuinely-new.md'), '# New\n', 'utf-8');

      const candidates = await scanForNewArtifacts(cwd, remoteName);
      const ids = candidates.map((c) => c.id);

      expect(ids).not.toContain('welcome-template');
      expect(ids).toContain('genuinely-new');
    },
    30_000,
  );

  it(
    'excludes an id already tracked in this project\'s lockfile',
    async () => {
      const remoteName = 'scan-test-remote-tracked';
      await registerAndClone(remoteName);
      const cwd = newScratchCwd('tracked');

      const artifact = TEST_ARTIFACTS.find((a) => a.id === 'lint-config')!;
      await pullArtifact(artifact.id, remoteName, cwd);

      // Same id as the just-pulled artifact, sitting directly in
      // .claude/agents -- already tracked, must not show up as a candidate.
      const agentsDir = path.join(cwd, '.claude', 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(path.join(agentsDir, `${artifact.id}.md`), '# Already tracked\n', 'utf-8');

      const candidates = await scanForNewArtifacts(cwd, remoteName);
      expect(candidates.map((c) => c.id)).not.toContain(artifact.id);
    },
    30_000,
  );

  it('returns an empty array when .claude/agents and .claude/skills do not exist at all', async () => {
    const remoteName = 'scan-test-remote-empty';
    await registerAndClone(remoteName);
    const cwd = newScratchCwd('empty');

    const candidates = await scanForNewArtifacts(cwd, remoteName);
    expect(candidates).toEqual([]);
  });

  it(
    'finds a genuinely reusable React component under src/, alongside the existing agent/skill/command/rule kinds (Phase D)',
    async () => {
      // Real, end-to-end confirmation that detectUiComponentCandidates
      // (unit-tested on its own in test/unit/detectUiComponents.test.ts)
      // is actually wired into scanForNewArtifacts, not just implemented
      // in isolation -- this is the integration point that test file
      // deliberately doesn't cover.
      const remoteName = 'scan-test-remote-ui-component';
      await registerAndClone(remoteName);
      const cwd = newScratchCwd('ui-component');

      const componentDir = path.join(cwd, 'src', 'ui', 'Alert');
      fs.mkdirSync(componentDir, { recursive: true });
      fs.writeFileSync(
        path.join(componentDir, 'Alert.tsx'),
        'export interface AlertProps { message: string; }\n' +
          'export function Alert({ message }: AlertProps) { return <div>{message}</div>; }\n',
        'utf-8',
      );
      // A plain page-level file with no Props type at all -- must NOT
      // show up as a candidate; confirms this test isn't accidentally
      // passing because ANY .tsx file under src/ gets picked up.
      const pagesDir = path.join(cwd, 'src', 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(pagesDir, 'Home.tsx'), 'export function Home() { return <div>Home</div>; }\n', 'utf-8');

      const candidates = await scanForNewArtifacts(cwd, remoteName);
      const alertCandidate = candidates.find((c) => c.id === 'alert');

      expect(alertCandidate).toBeTruthy();
      expect(alertCandidate?.kind).toBe('ui-component');
      expect(alertCandidate?.payloadPath).toBe(componentDir);
      expect(fs.existsSync(path.join(componentDir, 'preview.tsx'))).toBe(true);
      expect(candidates.some((c) => c.id === 'home')).toBe(false);
    },
    30_000,
  );

  it(
    'finds a genuine standalone project as a template candidate, alongside the existing agent kind, and excludes one whose id is already tracked (Phase D)',
    async () => {
      // Real, end-to-end confirmation that detectStarterKitCandidates
      // (unit-tested on its own in test/unit/detectStarterKitCandidates.test.ts)
      // is actually wired into scanForNewArtifacts, not just implemented
      // in isolation.
      const remoteName = 'scan-test-remote-starter-kit';
      await registerAndClone(remoteName);
      const cwd = newScratchCwd('starter-kit');

      const appDir = path.join(cwd, 'my-new-app');
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(
        path.join(appDir, 'package.json'),
        JSON.stringify({ name: 'my-new-app', scripts: { build: 'vite build' } }),
        'utf-8',
      );
      fs.mkdirSync(path.join(appDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(appDir, 'src', 'routes.tsx'), 'export const router = createBrowserRouter([]);', 'utf-8');

      // Coexists in the same scan with an unrelated agent candidate.
      const agentsDir = path.join(cwd, '.claude', 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(path.join(agentsDir, 'unrelated-agent.md'), '# Unrelated\n', 'utf-8');

      // A directory whose NAME matches an already-pulled artifact's real id
      // (not its installTarget) -- same "id already tracked" convention the
      // agent-kind test above uses -- must be excluded even though nobody
      // asked to pull it as a template specifically.
      await pullArtifact('lint-config', remoteName, cwd);
      const alreadyTrackedDir = path.join(cwd, 'lint-config');
      fs.mkdirSync(path.join(alreadyTrackedDir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(alreadyTrackedDir, 'package.json'),
        JSON.stringify({ name: 'lint-config', scripts: { build: 'vite build' } }),
        'utf-8',
      );
      fs.writeFileSync(path.join(alreadyTrackedDir, 'src', 'routes.tsx'), '', 'utf-8');

      const candidates = await scanForNewArtifacts(cwd, remoteName);
      const appCandidate = candidates.find((c) => c.id === 'my-new-app');

      expect(appCandidate).toMatchObject({
        kind: 'template',
        payloadPath: appDir,
        installTarget: 'my-new-app',
      });
      expect(appCandidate?.description).toContain('src/routes.tsx');
      expect(candidates.some((c) => c.id === 'unrelated-agent')).toBe(true);
      expect(candidates.some((c) => c.id === 'lint-config')).toBe(false);
    },
    30_000,
  );
});
