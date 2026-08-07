import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectBuildCommand, runProjectBuild } from '../../src/engine/pull/verifyBuild';

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

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
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
  }, 30_000);
});
