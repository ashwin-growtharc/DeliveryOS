import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import { createTestRemote, teardownTestRemote, TEST_ARTIFACTS } from '../fixtures/testRemote';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { cloneRemote } from '../../src/engine/remote/remoteCache';

/**
 * One real `deliveryos mcp` subprocess, driven with raw JSON-RPC over stdio
 * against a real git remote.
 *
 * The tool-surface matrix lives in `test/unit/mcp.server.test.ts`, in-memory
 * and in milliseconds. This file deliberately covers only what a subprocess
 * can prove and an in-memory transport cannot:
 *
 *   1. the command is actually wired into the CLI and starts;
 *   2. the engine adapter reaches a real catalog on disk;
 *   3. stdout carries JSON-RPC and NOTHING else.
 *
 * (3) is the one that would otherwise ship broken. Every other file in
 * `src/cli/commands/` opens with a `console.log`, and a single stray one here
 * corrupts the protocol stream -- which the client reports as an opaque parse
 * error, nowhere near the line that caused it. There is now an ESLint rule and
 * a static test for it; this asserts the property end-to-end on the real wire.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TSX_CLI = require.resolve('tsx/cli');
const CLI_ENTRY = path.join(REPO_ROOT, 'src', 'index.ts');

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

interface InitializeResult {
  serverInfo: { name: string; version: string };
}
interface ToolsListResult {
  tools: Array<{ name: string; annotations?: Record<string, unknown> }>;
}
interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/** A minimal JSON-RPC client. Deliberately NOT the SDK's own Client: this test
 * exists to check the bytes on the wire, and a client that tolerates or
 * normalises stray output would hide exactly the defect being looked for. */
class McpProcess {
  private child: ChildProcess;
  private pending = new Map<number, (r: JsonRpcResponse<never>) => void>();
  private nextId = 1;
  /** Every stdout line, including ones that are not valid JSON. */
  readonly stdoutLines: string[] = [];
  readonly stderr: string[] = [];

  constructor(env: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, [TSX_CLI, CLI_ENTRY, 'mcp'], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    readline.createInterface({ input: this.child.stdout! }).on('line', (line) => {
      if (line.trim() === '') return;
      this.stdoutLines.push(line);
      try {
        const parsed = JSON.parse(line) as JsonRpcResponse<never>;
        const resolve = this.pending.get(parsed.id);
        if (resolve) {
          this.pending.delete(parsed.id);
          resolve(parsed);
        }
      } catch {
        // Left in stdoutLines for the pollution assertion to find.
      }
    });

    this.child.stderr!.on('data', (d: Buffer) => this.stderr.push(d.toString()));
  }

  request<T>(method: string, params?: unknown): Promise<JsonRpcResponse<T>> {
    const id = this.nextId++;
    return new Promise<JsonRpcResponse<T>>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for ${method}. stderr: ${this.stderr.join('')}`)),
        30_000,
      );
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r as JsonRpcResponse<T>);
      });
      this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method: string, params?: unknown): void {
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
    const res = await this.request<ToolCallResult>('tools/call', { name, arguments: args });
    const text = res.result!.content[0].text;
    return { isError: res.result!.isError === true, text };
  }

  close(): void {
    this.child.stdin!.end();
    this.child.kill();
  }
}

let remoteDir: string;
let deliveryOsHome: string;
let projectDir: string;
let mcp: McpProcess;

describe('deliveryos mcp, as a real subprocess', () => {
  beforeAll(async () => {
    remoteDir = await createTestRemote();
    deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-mcp-e2e-home-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-mcp-e2e-project-'));

    // Seed the catalog in-process, the same way the other e2e tests do, so the
    // subprocess starts against a real cloned remote on disk.
    const previousHome = process.env.DELIVERYOS_HOME;
    process.env.DELIVERYOS_HOME = deliveryOsHome;
    try {
      addRemoteEntry({ name: 'test-remote', url: remoteDir, addedAt: new Date().toISOString() });
      await cloneRemote('test-remote', remoteDir);
    } finally {
      if (previousHome === undefined) delete process.env.DELIVERYOS_HOME;
      else process.env.DELIVERYOS_HOME = previousHome;
    }

    mcp = new McpProcess({ DELIVERYOS_HOME: deliveryOsHome });

    const init = await mcp.request<InitializeResult>('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '1.0.0' },
    });
    expect(init.result!.serverInfo.name).toBe('deliveryos');
    mcp.notify('notifications/initialized');
  }, 120_000);

  afterAll(async () => {
    mcp?.close();
    await teardownTestRemote(remoteDir);
    fs.rmSync(deliveryOsHome, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('reports the same version the CLI does, not a second hardcoded literal', async () => {
    const program = fs.readFileSync(path.join(REPO_ROOT, 'src', 'cli', 'program.ts'), 'utf-8');
    const declared = program.match(/\.version\('([^']+)'\)/)?.[1];
    const init = new McpProcess({ DELIVERYOS_HOME: deliveryOsHome });
    try {
      const res = await init.request<InitializeResult>('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '1.0.0' },
      });
      expect(res.result!.serverInfo.version).toBe(declared);
    } finally {
      init.close();
    }
  }, 60_000);

  it('advertises its tools over a real transport', async () => {
    const res = await mcp.request<ToolsListResult>('tools/list');
    expect(res.result!.tools.map((t) => t.name).sort()).toEqual([
      'catalog_overview',
      'get_artifact',
      'refresh_catalog',
      'search_artifacts',
    ]);
  }, 60_000);

  it('reads the real catalog from disk through the engine adapter', async () => {
    const res = await mcp.callTool('search_artifacts', { cwd: projectDir });
    const data = JSON.parse(res.text);
    expect(data.total).toBe(TEST_ARTIFACTS.length);
    expect(data.results.map((r: { id: string }) => r.id).sort()).toEqual(
      TEST_ARTIFACTS.map((a) => a.id).sort(),
    );
    // Nothing is installed in a fresh project dir.
    expect(data.results.every((r: { localStatus: string }) => r.localStatus === 'not_pulled')).toBe(true);
  }, 60_000);

  it('surfaces a real post_install command, which is invisible before install today', async () => {
    const withPostInstall = TEST_ARTIFACTS.find((a) => a.hasPostInstall)!;
    const res = await mcp.callTool('get_artifact', { cwd: projectDir, id: withPostInstall.id });
    const data = JSON.parse(res.text);
    expect(data.id).toBe(withPostInstall.id);
    expect(typeof data.postInstall).toBe('string');
    expect(data.postInstall.length).toBeGreaterThan(0);
  }, 60_000);

  it('returns an error result for an unknown id rather than crashing the process', async () => {
    const res = await mcp.callTool('get_artifact', { cwd: projectDir, id: 'no-such-artifact' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('no-such-artifact');

    // The process must still be serving afterwards -- an agent's bad guess
    // should not take the server down.
    const after = await mcp.request<ToolsListResult>('tools/list');
    expect(after.result!.tools).toHaveLength(4);
  }, 60_000);

  it('refuses a cwd that is relative or absent, rather than silently answering about the wrong project', async () => {
    // `docs/agent-surface-plan.md` Stage 2 argued the project should be
    // session-configured and never a tool argument, because the engine
    // validates paths WITHIN cwd but never validates cwd itself. That holds
    // for a surface that writes; this one only reads. What still holds is that
    // a relative cwd would resolve against the SERVER process -- so the tool
    // would confidently report install status for a directory nobody named.
    const relative = await mcp.callTool('search_artifacts', { cwd: 'some/relative/path' });
    expect(relative.isError).toBe(true);
    expect(relative.text).toContain('absolute');

    const missing = await mcp.callTool('catalog_overview', {
      cwd: path.join(projectDir, 'definitely-not-here'),
    });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('does not exist');

    // And on the read path too, not just the list path.
    const onRead = await mcp.callTool('get_artifact', {
      cwd: 'relative/again',
      id: TEST_ARTIFACTS[0].id,
    });
    expect(onRead.isError).toBe(true);
  }, 60_000);

  it('writes NOTHING to stdout that is not JSON-RPC', async () => {
    // The assertion this whole file exists for.
    await mcp.callTool('catalog_overview', { cwd: projectDir });

    const notJsonRpc = mcp.stdoutLines.filter((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed.jsonrpc !== '2.0';
      } catch {
        return true;
      }
    });

    expect(
      notJsonRpc,
      'A non-JSON-RPC line reached stdout. Something in src/mcp/**, src/engine/** or '
        + 'src/cli/commands/mcp.ts is printing -- stdout is the protocol wire.',
    ).toEqual([]);
    expect(mcp.stdoutLines.length).toBeGreaterThan(0);
  }, 60_000);
});
