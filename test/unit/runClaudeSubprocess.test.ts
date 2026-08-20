import { describe, it, expect, vi, beforeEach } from 'vitest';

// runClaudeSubprocess spawns a real, separately-installed, separately-
// authenticated CLI tool (`claude`) -- unlike git (tested for real against
// local fixtures throughout this codebase), there's no hermetic, repeatable
// way to exercise a real invocation in a unit test, so the `child_process`
// boundary itself is mocked here (this codebase's only such mock, and
// deliberately so -- everything else genuinely reachable without an
// external service/auth dependency is tested against real behavior).
const execFileMock = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

// Imported AFTER the mock is registered (vi.mock is hoisted above imports
// by vitest regardless of source order, but importing here keeps the
// mock's own intent visible right next to what it feeds).
const { runClaudeSubprocess, DISALLOWED_TOOLS } = await import('../../src/engine/claude/runClaudeSubprocess');

interface FakeChild {
  stdin: { end: ReturnType<typeof vi.fn> } | null;
}

function mockExecFileResolving(stdout: string): FakeChild {
  const child: FakeChild = { stdin: { end: vi.fn() } };
  execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
    callback(null, stdout);
    return child;
  });
  return child;
}

function mockExecFileRejecting(err: Error): FakeChild {
  const child: FakeChild = { stdin: { end: vi.fn() } };
  execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
    callback(err, '');
    return child;
  });
  return child;
}

beforeEach(() => {
  execFileMock.mockReset();
});

describe('runClaudeSubprocess', () => {
  it('writes the prompt to the child\'s stdin and ends it (never passes it through argv)', async () => {
    const child = mockExecFileResolving('{"result":"ok"}');

    await runClaudeSubprocess('a prompt with "quotes" and $(injection attempts)', DISALLOWED_TOOLS);

    expect(child.stdin!.end).toHaveBeenCalledWith('a prompt with "quotes" and $(injection attempts)');
    const [cmd, args] = execFileMock.mock.calls[0];
    expect(cmd).toBe('claude');
    expect(args.join(' ')).not.toContain('injection attempts');
  });

  it('resolves with stdout on success', async () => {
    mockExecFileResolving('{"result":"the real output"}');
    await expect(runClaudeSubprocess('prompt', DISALLOWED_TOOLS)).resolves.toBe('{"result":"the real output"}');
  });

  it('rejects with the underlying error when execFile\'s callback reports one (e.g. a real timeout)', async () => {
    const timeoutErr = Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' });
    mockExecFileRejecting(timeoutErr);
    await expect(runClaudeSubprocess('prompt', DISALLOWED_TOOLS, 5)).rejects.toBe(timeoutErr);
  });

  it('rejects with a clear error when the child has no writable stdin, instead of throwing on child.stdin.end', async () => {
    execFileMock.mockImplementation(() => ({ stdin: null }));
    await expect(runClaudeSubprocess('prompt', DISALLOWED_TOOLS)).rejects.toThrow(
      /claude subprocess has no writable stdin/,
    );
  });

  it('passes disallowedTools, the requested timeout, a real maxBuffer, and shell:true through to execFile', async () => {
    mockExecFileResolving('{}');
    await runClaudeSubprocess('prompt', 'Bash,Edit', 12_345);

    const [, args, opts] = execFileMock.mock.calls[0];
    expect(args).toEqual(['-p', '--disallowedTools', 'Bash,Edit', '--output-format', 'json']);
    expect(opts).toMatchObject({ timeout: 12_345, shell: true });
    // maxBuffer must be a real, generous cap -- not left at Node's silent
    // 1 MB default, which used to kill a large real response with a raw
    // Node buffer-overflow error instead of ever reaching this module's
    // own JSON-parse error handling.
    expect(opts.maxBuffer).toBeGreaterThan(1024 * 1024);
  });
});
