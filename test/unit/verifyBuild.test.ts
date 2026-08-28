import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectBuildCommand, runProjectBuild } from '../../src/engine/pull/verifyBuild';

// On Windows, killing a timed-out `exec` call only terminates the cmd.exe
// shell wrapper -- the real grandchild `node` process spawned by the
// timeout test below keeps running independently for its own ~600ms,
// still holding a lock on `cwd`, regardless of the timeout already having
// fired (confirmed by hand). `fs.rmSync`'s own `maxRetries` option was
// tried first and did NOT reliably retry this specific EPERM -- this
// explicit retry loop does.
async function rmDirWithRetry(dir: string): Promise<void> {
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt === maxAttempts || (code !== 'EPERM' && code !== 'EBUSY')) {
        throw err;
      }
      await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
  }
}

describe('detectBuildCommand (Phase 10 item 1)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-verify-build-test-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('returns undefined when there is no package.json at all', () => {
    expect(detectBuildCommand(cwd)).toBeUndefined();
  });

  it('returns undefined when package.json has no "build" script', () => {
    fs.writeFileSync(
      path.join(cwd, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { test: 'vitest' } }),
      'utf-8',
    );
    expect(detectBuildCommand(cwd)).toBeUndefined();
  });

  it('returns "npm run build" when package.json declares a build script', () => {
    fs.writeFileSync(
      path.join(cwd, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { build: 'next build' } }),
      'utf-8',
    );
    expect(detectBuildCommand(cwd)).toBe('npm run build');
  });

  it('returns undefined (not a throw) for malformed JSON', () => {
    fs.writeFileSync(path.join(cwd, 'package.json'), '{ not valid json', 'utf-8');
    expect(detectBuildCommand(cwd)).toBeUndefined();
  });
});

describe('runProjectBuild (Phase 10 item 1)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-verify-build-run-test-'));
  });

  afterEach(async () => {
    // See rmDirWithRetry's own doc comment above: the timeout test below
    // spawns a real process that outlives the timeout firing. Confirmed by
    // hand: without a generous retry budget here, cleanup intermittently
    // throws EPERM even though the test's own assertions already passed.
    await rmDirWithRetry(cwd);
  });

  it('reports ran: false when no build command is detected -- not an error', async () => {
    const result = await runProjectBuild(cwd);
    expect(result).toEqual({ ran: false });
  });

  it('runs a real, genuinely passing build command for real and reports success', async () => {
    fs.writeFileSync(
      path.join(cwd, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { build: 'node -e "console.log(1)"' } }),
      'utf-8',
    );
    const result = await runProjectBuild(cwd);
    expect(result.ran).toBe(true);
    expect(result.command).toBe('npm run build');
    expect(result.success).toBe(true);
  }, 30_000);

  it('runs a real, genuinely failing build command for real and reports failure with real output', async () => {
    fs.writeFileSync(
      path.join(cwd, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { build: 'node -e "console.error(\'real build error\'); process.exit(1)"' } }),
      'utf-8',
    );
    const result = await runProjectBuild(cwd);
    expect(result.ran).toBe(true);
    expect(result.success).toBe(false);
    expect(result.output).toContain('real build error');
    // Regression guard: a real compile failure must NOT be misreported as
    // either of the two new distinct outcomes below.
    expect(result.timedOut).toBeUndefined();
    expect(result.toolNotFound).toBeUndefined();
  }, 30_000);

  it('reports timedOut distinctly when the build command genuinely hangs past its timeout', async () => {
    fs.writeFileSync(
      path.join(cwd, 'package.json'),
      // A real command that outlives the 200ms timeoutMs override below.
      // Deliberately NOT a multi-second sleep: confirmed by hand that on
      // Windows, killing a timed-out `exec` call only terminates the
      // cmd.exe shell wrapper -- the real grandchild `node` process here
      // keeps running independently for its own full duration regardless
      // of the timeout firing, so afterEach's cleanup has to wait it out
      // too. Keeping this short keeps the whole test fast.
      JSON.stringify({ name: 'x', scripts: { build: 'node -e "setTimeout(() => {}, 600)"' } }),
      'utf-8',
    );
    // Passing a tiny timeoutMs override (not BUILD_VERIFY_TIMEOUT_MS) is
    // what keeps this test genuinely fast instead of taking minutes -- see
    // runProjectBuild's second parameter.
    const result = await runProjectBuild(cwd, 200);
    expect(result.ran).toBe(true);
    expect(result.command).toBe('npm run build');
    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.toolNotFound).toBeUndefined();
    expect(result.output).toContain('timed out');
  }, 10_000);

  it('reports toolNotFound distinctly when the build command\'s own tool is missing from PATH', async () => {
    fs.writeFileSync(
      path.join(cwd, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { build: 'anything, never actually reached' } }),
      'utf-8',
    );
    // detectBuildCommand always resolves to the fixed literal "npm run
    // build" -- the only real way to make ITS tool go missing is to make
    // "npm" itself unresolvable, by emptying PATH for the duration of this
    // call. Confirmed empirically (see verifyBuild.ts's isToolNotFoundError
    // doc comment): this reproduces the real "machine doesn't have this
    // tool" case exactly, via cmd.exe's own "not recognized" error, not a
    // mock.
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = '';
      const result = await runProjectBuild(cwd);
      expect(result.ran).toBe(true);
      expect(result.command).toBe('npm run build');
      expect(result.success).toBe(false);
      expect(result.toolNotFound).toBe(true);
      expect(result.timedOut).toBeUndefined();
    } finally {
      process.env.PATH = originalPath;
    }
  }, 30_000);
});
