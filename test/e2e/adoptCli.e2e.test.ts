import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import simpleGit from 'simple-git';
import { rmDirWithRetry } from '../../src/engine/execHelpers';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { cloneRemote } from '../../src/engine/remote/remoteCache';

/**
 * `deliveryos adopt`, through the real CLI.
 *
 * WHAT THIS COVERS AND WHAT IT DOES NOT
 *
 * The full run -- mirror, commit, push, open a pull request -- is covered at
 * the engine level in `mirrorAndAdopt.e2e.test.ts` with a fake GitHub client.
 * The CLI cannot inject one, so a full run from here would need real GitHub
 * credentials and a real repository, which a test must not depend on.
 *
 * So this covers the half a person sees first: the dry run, and every refusal.
 * Those are the paths that decide whether somebody trusts the command enough to
 * run it for real, and they are the ones that used to print a stack trace.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TSX_CLI = require.resolve('tsx/cli');
const CLI_ENTRY = path.join(REPO_ROOT, 'src', 'index.ts');

let home: string;
let originalHome: string | undefined;
let scratch: string[] = [];

/**
 * Registers the catalog the way every other adoption test does: a github.com
 * URL on the registry entry, a real local repository behind the clone.
 *
 * This used to be `remote add <local path>`, and the dry run passed against
 * it -- while the real run would have refused at parseGithubUrl, because a
 * bare path is not somewhere a pull request can be opened. The dry run was
 * previewing a PR that could never open, which is the exact plan/apply
 * disagreement requireContributableRemote now closes. So the fixture, not the
 * check, was wrong.
 */
const FAKE_GITHUB_URL = 'https://github.com/acme/contoso-catalog.git';
async function registerCatalog(repoDir: string): Promise<void> {
  await addRemoteEntry({ name: 'contoso', url: FAKE_GITHUB_URL, addedAt: new Date().toISOString() });
  await cloneRemote('contoso', repoDir);
}

function runCli(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, DELIVERYOS_HOME: home },
    timeout: 120_000,
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** A synced library as it really looks: the client's folders, and the sync
 * client's debris. */
function syncedFolder(): string {
  const root = path.join(tempDir('deliveryos-adopt-src-'), 'Delivery Playbooks');
  fs.mkdirSync(path.join(root, 'playbooks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'playbooks', 'escalation.md'),
    '---\ndescription: When and how to escalate.\n---\n# Escalation\n',
    'utf-8',
  );
  fs.writeFileSync(path.join(root, 'playbooks', 'handover.md'), '# Handover checklist\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'playbooks', '~$escalation.md'), 'x', 'utf-8');
  fs.writeFileSync(path.join(root, 'desktop.ini'), 'x', 'utf-8');
  return root;
}

async function gitRepo(): Promise<string> {
  const root = tempDir('deliveryos-adopt-catalog-');
  fs.writeFileSync(path.join(root, 'README.md'), '# catalog\n', 'utf-8');
  const git = simpleGit(root);
  await git.init();
  await git.add(['.']);
  await git.raw(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init']);
  return root;
}

function profileFile(contents: string): string {
  const file = path.join(tempDir('deliveryos-adopt-profile-'), 'profile.yaml');
  fs.writeFileSync(file, contents, 'utf-8');
  return file;
}

const GOOD_PROFILE = [
  'remote: contoso',
  'owner: consultant',
  'rules:',
  '  - folder: playbooks',
  '    kind: rule',
  '    installTarget: .claude/rules/playbooks',
  '    idPrefix: playbook',
].join('\n');

beforeEach(() => {
  originalHome = process.env.DELIVERYOS_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-adopt-home-'));
  // Set in-process too: registerCatalog runs here, the CLI runs in a child
  // with the same value, and both must see one registry.
  process.env.DELIVERYOS_HOME = home;
  scratch = [];
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.DELIVERYOS_HOME;
  else process.env.DELIVERYOS_HOME = originalHome;
  for (const dir of [home, ...scratch]) await rmDirWithRetry(dir);
});

describe('deliveryos adopt --dry-run', () => {
  it('shows the plan the real run would commit, and writes nothing', async () => {
    const source = syncedFolder();
    const catalog = await gitRepo();
    await registerCatalog(catalog);

    const result = runCli(['adopt', source, '--profile', profileFile(GOOD_PROFILE), '--dry-run'], catalog);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Would adopt 2 artifact(s)');
    expect(result.stdout).toContain('playbook-escalation');
    expect(result.stdout).toContain('playbook-handover');
    // Derived descriptions are flagged, because they are the ones a reviewer
    // should actually read before merging.
    expect(result.stdout).toContain('playbook-handover: "Handover checklist"');
    // The debris never appears -- the dry run went through the same mirror the
    // real run does, which is the whole point of not planning against the raw
    // folder.
    expect(result.stdout).not.toContain('~$');
    expect(result.stdout).toContain('Nothing was written');

    // And nothing WAS written: no manifest layer in the cache, no branch.
    const cache = path.join(home, 'remotes', 'contoso');
    expect(fs.existsSync(path.join(cache, 'artifacts'))).toBe(false);
    const branches = await simpleGit(cache).branchLocal();
    expect(branches.all.some((b) => b.startsWith('deliveryos/adopt/'))).toBe(false);
  });

});

describe('deliveryos adopt refuses, in a sentence', () => {
  /** Every refusal below must be a message, never a stack. A stack trace on a
   * user mistake is the defect `remote add ""` used to have. */
  function expectCleanRefusal(result: { status: number; stderr: string }, ...fragments: string[]): void {
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^Error: /m);
    expect(result.stderr, 'printed a stack trace for a user-facing refusal').not.toMatch(/^\s+at /m);
    for (const fragment of fragments) expect(result.stderr).toContain(fragment);
  }

  it('a folder library cannot receive a mirror', async () => {
    const source = syncedFolder();
    const library = tempDir('deliveryos-adopt-library-');
    fs.writeFileSync(path.join(library, 'x.md'), '# x\n', 'utf-8');
    expect(runCli(['remote', 'add', library, '--name', 'contoso'], library).status).toBe(0);

    const result = runCli(['adopt', source, '--profile', profileFile(GOOD_PROFILE), '--dry-run'], library);
    expectCleanRefusal(result, 'folder library', 'cannot receive a mirror');
  });

  it('a profile that fails validation names the field', async () => {
    const source = syncedFolder();
    const catalog = await gitRepo();
    await registerCatalog(catalog);

    const bad = profileFile(GOOD_PROFILE.replace('owner: consultant\n', ''));
    const result = runCli(['adopt', source, '--profile', bad, '--dry-run'], catalog);
    expectCleanRefusal(result, 'owner');
  });


  it('a remote that is not registered', async () => {
    const source = syncedFolder();
    const result = runCli(['adopt', source, '--profile', profileFile(GOOD_PROFILE), '--dry-run'], source);
    expectCleanRefusal(result, 'No remote named "contoso"');
  });

  it('a folder that is not there', async () => {
    const catalog = await gitRepo();
    await registerCatalog(catalog);

    const result = runCli(
      ['adopt', path.join(catalog, 'does-not-exist'), '--profile', profileFile(GOOD_PROFILE), '--dry-run'],
      catalog,
    );
    expectCleanRefusal(result, 'does-not-exist');
  });

  it('a profile file that is not there', async () => {
    const source = syncedFolder();
    const result = runCli(['adopt', source, '--profile', path.join(source, 'missing.yaml'), '--dry-run'], source);
    expectCleanRefusal(result, 'missing.yaml');
  });
});
