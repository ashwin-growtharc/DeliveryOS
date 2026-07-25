import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import simpleGit from 'simple-git';
import { createTestRemote, teardownTestRemote, TEST_ARTIFACTS } from '../fixtures/testRemote';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { cloneRemote } from '../../src/engine/remote/remoteCache';

// This e2e test drives `src/sidecar.ts` as a real subprocess, exactly the
// way the Tauri host (src-tauri/src/lib.rs's `sidecar_call`) does: spawn it,
// write one `{"id","command","args"}` JSON line to its stdin, read
// `{"id","ok","result"}` / `{"id","ok":false,"error"}` lines back from
// stdout. Same `tsx`-CLI-resolved-via-`require.resolve` invocation approach
// as the other e2e tests (see pull.e2e.test.ts) so this doesn't depend on a
// prior `npm run build` and stays cross-platform.
//
// Unlike the Tauri host (which spawns a fresh sidecar per call), several
// scenarios below deliberately keep ONE sidecar process alive across
// multiple request lines in a single test, to exercise the multi-request
// session behavior `src/sidecar.ts`'s `main()` is designed to support (see
// its `pendingCount`/`exitIfDone` comments).
//
// Same DELIVERYOS_HOME isolation strategy as every other e2e test here:
// never touches the real developer machine's ~/.deliveryos.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TSX_CLI = require.resolve('tsx/cli');
const SIDECAR_ENTRY = path.join(REPO_ROOT, 'src', 'sidecar.ts');

interface SidecarResponse {
  id: string | null;
  ok: boolean;
  result?: unknown;
  error?: { type: string; message: string };
}

interface CatalogListEntry {
  manifest: { id: string; kind: string; version: string; description: string; owner: string };
  remoteName: string;
  localStatus: 'not_pulled' | 'pulled' | 'edited_locally';
  installTarget: string;
}

/**
 * Wraps one `src/sidecar.ts` subprocess. Requests/responses are correlated
 * by `id` (a Map keyed by id, `null` mapped to a reserved key), NOT by
 * arrival order -- the sidecar processes lines concurrently (see its
 * `main()`), so a malformed line's `id: null` response can legitimately
 * arrive before an earlier well-formed request's response finishes
 * resolving. Matching by id makes this session robust to that reordering.
 */
class SidecarSession {
  private readonly child: ChildProcess;
  private readonly pending = new Map<string, (res: SidecarResponse) => void>();
  private readonly stderrChunks: string[] = [];
  private nextId = 1;
  private readonly exited: Promise<number | null>;

  constructor(cwd: string, deliveryOsHome: string) {
    this.child = spawn(process.execPath, [TSX_CLI, SIDECAR_ENTRY], {
      cwd,
      env: { ...process.env, DELIVERYOS_HOME: deliveryOsHome },
    });

    const rl = readline.createInterface({ input: this.child.stdout!, terminal: false });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return;
      }
      let parsed: SidecarResponse;
      try {
        parsed = JSON.parse(trimmed) as SidecarResponse;
      } catch {
        // A response line that isn't valid JSON would itself be a sidecar
        // protocol bug (never expected here) -- ignore rather than crash
        // the test harness; the awaiting assertion will time out and fail
        // loudly instead.
        return;
      }
      const key = parsed.id === null ? '__null__' : parsed.id;
      const resolver = this.pending.get(key);
      if (resolver) {
        this.pending.delete(key);
        resolver(parsed);
      }
    });

    this.child.stderr!.on('data', (chunk: Buffer) => {
      this.stderrChunks.push(chunk.toString('utf-8'));
    });

    this.exited = new Promise((resolve) => {
      this.child.on('exit', (code) => resolve(code));
    });
  }

  /** Sends a well-formed request line and resolves with its response. */
  request(command: string, args: Record<string, unknown> = {}): Promise<SidecarResponse> {
    const id = String(this.nextId++);
    const responsePromise = new Promise<SidecarResponse>((resolve) => {
      this.pending.set(id, resolve);
    });
    this.child.stdin!.write(JSON.stringify({ id, command, args }) + '\n');
    return responsePromise;
  }

  /** Sends a raw (possibly malformed) line and resolves with the next
   * `id: null` response -- the resolver is registered before the line is
   * written, so there's no race with the async 'line' handler. */
  sendRawLine(rawLine: string): Promise<SidecarResponse> {
    const responsePromise = new Promise<SidecarResponse>((resolve) => {
      this.pending.set('__null__', resolve);
    });
    this.child.stdin!.write(rawLine + '\n');
    return responsePromise;
  }

  stderrOutput(): string {
    return this.stderrChunks.join('');
  }

  /** Closes stdin (EOF, matching how a real host session ends) and waits
   * for the process to exit. Returns the exit code. */
  async close(): Promise<number | null> {
    this.child.stdin!.end();
    return this.exited;
  }
}

describe('sidecar e2e', () => {
  let fixtureRemoteDir: string;
  let deliveryOsHome: string;
  let scratchRoot: string;
  let originalEnv: string | undefined;

  beforeAll(async () => {
    originalEnv = process.env.DELIVERYOS_HOME;
    fixtureRemoteDir = await createTestRemote();
    deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-sidecar-e2e-home-'));
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-sidecar-e2e-scratch-'));
    // Some scenarios (the artifact.push coverage-gap test) call
    // addRemoteEntry/cloneRemote directly in-process, which read
    // DELIVERYOS_HOME via src/engine/paths.ts -- set it here so those calls
    // and the spawned sidecar subprocesses (each given the same
    // deliveryOsHome explicitly via `env`) agree on one shared home.
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
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  });

  function newScratchCwd(label: string): string {
    return fs.mkdtempSync(path.join(scratchRoot, `${label}-`));
  }

  it(
    'remote.add registers a real local git remote, and a subsequent remote.list on the same session shows it',
    async () => {
      const cwd = newScratchCwd('remote-add');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const addResp = await session.request('remote.add', {
          url: fixtureRemoteDir,
          name: 'sidecar-remote-1',
        });
        expect(addResp.ok).toBe(true);
        expect(addResp.result).toMatchObject({ name: 'sidecar-remote-1', url: fixtureRemoteDir });

        const listResp = await session.request('remote.list', {});
        expect(listResp.ok).toBe(true);
        const remotes = listResp.result as Array<{ name: string; url: string }>;
        expect(remotes.find((r) => r.name === 'sidecar-remote-1')).toMatchObject({
          name: 'sidecar-remote-1',
          url: fixtureRemoteDir,
        });
      } finally {
        expect(await session.close()).toBe(0);
      }
    },
    30_000,
  );

  it(
    'remote.add with a duplicate name fails cleanly and does not corrupt the registry',
    async () => {
      const cwd = newScratchCwd('remote-dup');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const first = await session.request('remote.add', {
          url: fixtureRemoteDir,
          name: 'sidecar-remote-dup',
        });
        expect(first.ok).toBe(true);

        const second = await session.request('remote.add', {
          url: fixtureRemoteDir,
          name: 'sidecar-remote-dup',
        });
        expect(second.ok).toBe(false);
        expect(second.error?.type).toBe('RemoteRegistryError');
        expect(second.error?.message).toContain('already registered');

        const listResp = await session.request('remote.list', {});
        const remotes = listResp.result as Array<{ name: string; url: string }>;
        const matches = remotes.filter((r) => r.name === 'sidecar-remote-dup');
        expect(matches).toHaveLength(1);
        expect(matches[0].url).toBe(fixtureRemoteDir);
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  it(
    'catalog.list with zero registered remotes returns an empty array, not a crash',
    async () => {
      // Fresh cwd AND fresh DELIVERYOS_HOME so this scenario really sees
      // zero remotes, regardless of what earlier tests registered.
      const cwd = newScratchCwd('catalog-empty');
      const freshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-sidecar-e2e-emptyhome-'));
      const session = new SidecarSession(cwd, freshHome);
      try {
        const resp = await session.request('catalog.list', { cwd });
        expect(resp.ok).toBe(true);
        expect(resp.result).toEqual([]);
      } finally {
        await session.close();
        fs.rmSync(freshHome, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    'catalog.list shows all 3 seeded artifacts as not_pulled after registering a remote with them',
    async () => {
      const cwd = newScratchCwd('catalog-seeded');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const addResp = await session.request('remote.add', {
          url: fixtureRemoteDir,
          name: 'sidecar-remote-catalog',
        });
        expect(addResp.ok).toBe(true);

        const listResp = await session.request('catalog.list', { cwd });
        expect(listResp.ok).toBe(true);
        const entries = listResp.result as CatalogListEntry[];
        // Filter to this test's own remote, since deliveryOsHome (and thus
        // the registry) is shared across scenarios in this file.
        const ownEntries = entries.filter((e) => e.remoteName === 'sidecar-remote-catalog');
        expect(ownEntries).toHaveLength(3);

        for (const artifact of TEST_ARTIFACTS) {
          const entry = ownEntries.find((e) => e.manifest.id === artifact.id);
          expect(entry, `expected catalog entry for ${artifact.id}`).toBeDefined();
          expect(entry?.manifest.kind).toBe(artifact.kind);
          expect(entry?.localStatus).toBe('not_pulled');
        }
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  it(
    'artifact.pull lands files on disk, and a subsequent catalog.list flips localStatus to pulled',
    async () => {
      const cwd = newScratchCwd('pull-flip');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const addResp = await session.request('remote.add', {
          url: fixtureRemoteDir,
          name: 'sidecar-remote-pull',
        });
        expect(addResp.ok).toBe(true);

        const artifact = TEST_ARTIFACTS.find((a) => a.id === 'welcome-template')!;
        const pullResp = await session.request('artifact.pull', {
          id: artifact.id,
          remote: 'sidecar-remote-pull',
          cwd,
        });
        expect(pullResp.ok).toBe(true);
        expect((pullResp.result as { manifest: { id: string } }).manifest.id).toBe(artifact.id);

        const installTarget = path.resolve(cwd, artifact.installTarget);
        expect(fs.existsSync(path.join(installTarget, 'README.md'))).toBe(true);
        expect(fs.readFileSync(path.join(installTarget, 'README.md'), 'utf-8')).toContain(
          artifact.id,
        );

        const listResp = await session.request('catalog.list', { cwd });
        const entries = listResp.result as CatalogListEntry[];
        const entry = entries.find(
          (e) => e.manifest.id === artifact.id && e.remoteName === 'sidecar-remote-pull',
        );
        expect(entry?.localStatus).toBe('pulled');
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  it(
    "a freshly-pulled artifact WITH post_install shows localStatus 'pulled', not 'edited_locally' "
      + '(post_install\'s own generated files must not be misread as a local edit)',
    async () => {
      const cwd = newScratchCwd('pull-post-install-status');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const addResp = await session.request('remote.add', {
          url: fixtureRemoteDir,
          name: 'sidecar-remote-postinstall',
        });
        expect(addResp.ok).toBe(true);

        const artifact = TEST_ARTIFACTS.find((a) => a.hasPostInstall)!;
        const pullResp = await session.request('artifact.pull', {
          id: artifact.id,
          remote: 'sidecar-remote-postinstall',
          cwd,
        });
        expect(pullResp.ok).toBe(true);

        // Sanity check: post_install's marker file really did land -- if it
        // didn't, the localStatus assertion below would pass for the wrong
        // reason (nothing to misdiagnose as an edit).
        const installTarget = path.resolve(cwd, artifact.installTarget);
        expect(fs.existsSync(path.join(installTarget, '.post_install_ran'))).toBe(true);

        const listResp = await session.request('catalog.list', { cwd });
        const entries = listResp.result as CatalogListEntry[];
        const entry = entries.find(
          (e) => e.manifest.id === artifact.id && e.remoteName === 'sidecar-remote-postinstall',
        );
        expect(entry?.localStatus).toBe('pulled');
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  it(
    'editing a pulled artifact on disk flips localStatus to edited_locally on the next catalog.list',
    async () => {
      const cwd = newScratchCwd('edit-flip');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const addResp = await session.request('remote.add', {
          url: fixtureRemoteDir,
          name: 'sidecar-remote-edit',
        });
        expect(addResp.ok).toBe(true);

        const artifact = TEST_ARTIFACTS.find((a) => a.id === 'welcome-template')!;
        const pullResp = await session.request('artifact.pull', {
          id: artifact.id,
          remote: 'sidecar-remote-edit',
          cwd,
        });
        expect(pullResp.ok).toBe(true);

        const installTarget = path.resolve(cwd, artifact.installTarget);
        fs.writeFileSync(
          path.join(installTarget, 'README.md'),
          '# welcome-template\n\nedited on disk directly by the QA test.\n',
          'utf-8',
        );

        const listResp = await session.request('catalog.list', { cwd });
        const entries = listResp.result as CatalogListEntry[];
        const entry = entries.find(
          (e) => e.manifest.id === artifact.id && e.remoteName === 'sidecar-remote-edit',
        );
        expect(entry?.localStatus).toBe('edited_locally');
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  it(
    'artifact.pull on a nonexistent id returns a clean ArtifactResolutionError, not a crash',
    async () => {
      const cwd = newScratchCwd('pull-missing');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const resp = await session.request('artifact.pull', { id: 'nonexistent-id', cwd });
        expect(resp.ok).toBe(false);
        expect(resp.error?.type).toBe('ArtifactResolutionError');
        expect(resp.error?.message).toContain(
          'No artifact with id "nonexistent-id" found in any registered remote',
        );
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  it(
    'artifact.push (edit mode): the sidecar has no octokit-injection point, so it runs real ' +
      'git ops and then hits the real GitHub auth/API boundary -- a clean error, not a crash',
    async () => {
      // src/sidecar.ts's `artifact.push` handler calls
      // `pushArtifact(id, options, cwd)` with no 4th (octokit) argument --
      // unlike the CLI/direct-call e2e tests (push.e2e.test.ts,
      // push.cliFlags.e2e.test.ts), there is no way to inject a fake GitHub
      // client through the JSON-RPC protocol: it isn't a serializable
      // request field, and even if it were, a vi.fn() mock can't cross a
      // process boundary. This is a REAL coverage gap for the
      // success-path -- see the QA report for detail -- so this test
      // instead locks in the failure-path behavior: real git clone/branch/
      // commit/push against the local fixture "remote" all happen for
      // real, and only the final GitHub API call fails (cleanly).
      //
      // Setup deliberately bypasses the sidecar's own `remote.add` (which
      // clones from `url` itself, so a github.com-shaped URL would try a
      // real network clone) -- instead it registers a fake github.com URL
      // directly and clones the real local fixture dir, exactly the split
      // `push.e2e.test.ts` uses. Only the setup goes around the sidecar;
      // the pull and push calls under test still go through the real
      // sidecar subprocess.
      const remoteName = 'sidecar-remote-push-wall';
      const fakeGithubUrl = 'https://github.com/deliveryos-qa-fake-owner/deliveryos-qa-fake-repo.git';
      addRemoteEntry({ name: remoteName, url: fakeGithubUrl, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const cwd = newScratchCwd('push-wall');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const artifact = TEST_ARTIFACTS.find((a) => a.id === 'welcome-template')!;
        const pullResp = await session.request('artifact.pull', {
          id: artifact.id,
          remote: remoteName,
          cwd,
        });
        expect(pullResp.ok).toBe(true);

        const installTarget = path.resolve(cwd, artifact.installTarget);
        fs.writeFileSync(
          path.join(installTarget, 'README.md'),
          '# welcome-template\n\nedited for the push-wall coverage-gap test.\n',
          'utf-8',
        );

        const pushResp = await session.request('artifact.push', {
          id: artifact.id,
          cwd,
          options: {},
        });

        expect(pushResp.ok).toBe(false);
        // GithubAuthError if `gh auth token` isn't usable on this machine;
        // GithubApiError (404, since the owner/repo is fake) if it is.
        // Either is the expected clean failure -- never a crash, and never
        // UnsupportedRemoteError (which would mean it failed even earlier,
        // before reaching real git/GitHub code at all).
        expect(['GithubAuthError', 'GithubApiError']).toContain(pushResp.error?.type);
        expect(pushResp.error?.message.length ?? 0).toBeGreaterThan(0);

        // The branch/commit/push sequence happens BEFORE the GitHub API
        // call inside pushArtifact -- confirm it really ran for real
        // against the fixture "remote", proving the sidecar's wiring
        // reached all the way to the GitHub boundary.
        const branchSummary = await simpleGit(fixtureRemoteDir).branch(['-a']);
        expect(branchSummary.all.some((b) => b.startsWith(`deliveryos/${artifact.id}/`))).toBe(
          true,
        );
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  it(
    'malformed JSON on stdin gets a clean {ok:false} response instead of crashing the process',
    async () => {
      const cwd = newScratchCwd('malformed');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const resp = await session.sendRawLine('{not valid json');
        expect(resp.ok).toBe(false);
        expect(resp.id).toBeNull();
        expect(resp.error).toBeDefined();
        expect(resp.error?.message.length ?? 0).toBeGreaterThan(0);

        // The process is still alive and responsive after the malformed
        // line -- confirms handleLine's catch-and-respond path recovers,
        // rather than the process having crashed/exited.
        const followUp = await session.request('remote.list', {});
        expect(followUp.ok).toBe(true);
      } finally {
        expect(await session.close()).toBe(0);
      }
    },
    30_000,
  );
});
