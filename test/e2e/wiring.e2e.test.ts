import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  createTestRemoteWithInstallParamsArtifact,
  teardownTestRemote,
  INSTALL_PARAMS_ARTIFACT,
} from '../fixtures/testRemote';

// Phase 8 item 2: `deliveryos wiring <id>` -- the one concrete gap that was
// blocking a Claude Code Skill from doing anything with Tier 2 wiring at
// all (resolveWiringActions was sidecar-only before this). Same real
// subprocess discipline as pull.e2e.test.ts.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TSX_CLI = require.resolve('tsx/cli');
const CLI_ENTRY = path.join(REPO_ROOT, 'src', 'index.ts');

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string, deliveryOsHome: string): CliResult {
  const result = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, DELIVERYOS_HOME: deliveryOsHome },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

interface WiringActionJson {
  targetFile: string;
  targetFileExists: boolean;
  description: string;
  instructions: string;
  snippet?: string;
}

describe('wiring e2e (Phase 8 item 2)', () => {
  let remoteDir: string;
  let deliveryOsHome: string;
  let cwd: string;

  beforeAll(async () => {
    remoteDir = await createTestRemoteWithInstallParamsArtifact();
    deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-e2e-wiring-home-'));
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-e2e-wiring-cwd-'));

    const addResult = runCli(
      ['remote', 'add', remoteDir, '--name', 'wiring-e2e-remote'],
      cwd,
      deliveryOsHome,
    );
    expect(addResult.status).toBe(0);
  }, 30_000);

  afterAll(async () => {
    await teardownTestRemote(remoteDir);
    fs.rmSync(deliveryOsHome, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('resolves both actions as whenAbsent against a fresh project with neither file present, in JSON', () => {
    const result = runCli(
      ['wiring', INSTALL_PARAMS_ARTIFACT.id, '--remote', 'wiring-e2e-remote', '--json'],
      cwd,
      deliveryOsHome,
    );

    expect(result.status).toBe(0);
    const actions: WiringActionJson[] = JSON.parse(result.stdout);
    expect(actions).toHaveLength(2);

    const authAction = actions.find((a) => a.targetFile === 'auth.ts')!;
    expect(authAction.targetFileExists).toBe(false);
    expect(authAction.snippet).toContain('NextAuth');

    const middlewareAction = actions.find((a) => a.targetFile === 'middleware.ts')!;
    expect(middlewareAction.targetFileExists).toBe(false);
    expect(middlewareAction.snippet).toContain('auth as middleware');
  });

  it('flips to whenPresent once the target file is seeded, in the human-readable listing', () => {
    fs.writeFileSync(path.join(cwd, 'middleware.ts'), 'export default function middleware() {}', 'utf-8');

    const result = runCli(
      ['wiring', INSTALL_PARAMS_ARTIFACT.id, '--remote', 'wiring-e2e-remote'],
      cwd,
      deliveryOsHome,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('middleware.ts -- EXISTS');
    expect(result.stdout).toContain('Merge');
    expect(result.stdout).toContain('auth.ts -- NOT FOUND');

    // Purely read-only -- resolving never creates auth.ts, and the
    // middleware.ts seeded by hand above is untouched.
    expect(fs.existsSync(path.join(cwd, 'auth.ts'))).toBe(false);
    expect(fs.readFileSync(path.join(cwd, 'middleware.ts'), 'utf-8'))
      .toBe('export default function middleware() {}');
  });

  it('hard-errors cleanly on a nonexistent artifact id, not a crash', () => {
    const result = runCli(
      ['wiring', 'no-such-artifact-at-all', '--remote', 'wiring-e2e-remote'],
      cwd,
      deliveryOsHome,
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('No artifact');
  });
});
