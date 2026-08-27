import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Same mocking rationale as runClaudeSubprocess.test.ts's own comment:
// this spawns a real, separately-installed, separately-authenticated CLI
// tool -- the `child_process` boundary is mocked here, the codebase's
// established exception to "test against real behavior."
const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { launchInteractiveClaudeSession } = await import(
  '../../src/engine/claude/launchInteractiveClaudeSession'
);

class FakeChild extends EventEmitter {}

function mockSpawnExiting(exitCode: number | null): FakeChild {
  const child = new FakeChild();
  spawnMock.mockImplementation(() => {
    queueMicrotask(() => child.emit('exit', exitCode));
    return child;
  });
  return child;
}

beforeEach(() => {
  spawnMock.mockReset();
});

describe('launchInteractiveClaudeSession', () => {
  it('JSON.stringify-quotes the starting message as a single argv element -- a real, confirmed bug: an unquoted multi-word message gets split into several separate shell words under shell:true, and Claude only ever received a truncated fragment', async () => {
    mockSpawnExiting(0);
    const message = `Read some/path.md and follow it exactly. Don't stop at a documented seam.`;

    await launchInteractiveClaudeSession('/some/project', message);

    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe('claude');
    expect(args).toEqual([JSON.stringify(message)]);
    // The real, un-quoted message must never appear as its own bare argv
    // element (that's exactly the broken shape that produced the bug).
    expect(args).not.toContain(message);
  });

  it('inherits stdio and sets cwd to the real target project (the opposite of runClaudeSubprocess, which deliberately leaves cwd unset)', async () => {
    mockSpawnExiting(0);
    await launchInteractiveClaudeSession('/some/project', 'hello');

    const [, , opts] = spawnMock.mock.calls[0];
    expect(opts).toMatchObject({ cwd: '/some/project', stdio: 'inherit', shell: true });
  });

  it('resolves with the real exit code once the child exits', async () => {
    mockSpawnExiting(1);
    await expect(launchInteractiveClaudeSession('/some/project', 'hello')).resolves.toEqual({ exitCode: 1 });
  });

  it('resolves with exitCode: null when the process is killed by a signal rather than exiting normally', async () => {
    mockSpawnExiting(null);
    await expect(launchInteractiveClaudeSession('/some/project', 'hello')).resolves.toEqual({ exitCode: null });
  });

  it('rejects when the child process itself fails to spawn (e.g. claude not on PATH)', async () => {
    const child = new FakeChild();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => child.emit('error', new Error('spawn claude ENOENT')));
      return child;
    });

    await expect(launchInteractiveClaudeSession('/some/project', 'hello')).rejects.toThrow(/ENOENT/);
  });
});
