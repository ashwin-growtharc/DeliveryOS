import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import simpleGit from 'simple-git';
import {
  createTestRemote,
  createTestRemoteWithInstallParamsArtifact,
  createTestRemoteWithSignedArtifact,
  teardownTestRemote,
  TEST_ARTIFACTS,
  INSTALL_PARAMS_ARTIFACT,
  SIGNED_ARTIFACT,
} from '../fixtures/testRemote';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { cloneRemote, cachePath } from '../../src/engine/remote/remoteCache';

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

/** Shape of an intermediate progress line the sidecar writes for
 * `artifact.pull`/`artifact.push` (see src/sidecar.ts's `writeProgress`).
 * Distinguished from a `SidecarResponse` by its `event: 'progress'` field --
 * it never resolves a pending request the way a final response does. */
interface SidecarProgressLine {
  id: string | null;
  event: 'progress';
  stage: string;
  message: string;
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
  // Progress lines don't resolve a pending request the way a final response
  // does (see the 'line' handler below), so they're accumulated here
  // instead -- tests drain them with `takeProgressLines()`.
  private readonly progressLines: SidecarProgressLine[] = [];
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
      let parsed: SidecarResponse | SidecarProgressLine;
      try {
        parsed = JSON.parse(trimmed) as SidecarResponse | SidecarProgressLine;
      } catch {
        // A response line that isn't valid JSON would itself be a sidecar
        // protocol bug (never expected here) -- ignore rather than crash
        // the test harness; the awaiting assertion will time out and fail
        // loudly instead.
        return;
      }

      if ((parsed as SidecarProgressLine).event === 'progress') {
        this.progressLines.push(parsed as SidecarProgressLine);
        return;
      }

      const response = parsed as SidecarResponse;
      const key = response.id === null ? '__null__' : response.id;
      const resolver = this.pending.get(key);
      if (resolver) {
        this.pending.delete(key);
        resolver(response);
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

  /** Returns every progress line accumulated since the last call to this
   * method (or since the session was created), then clears the buffer.
   * Callers typically drain it once right before a call whose progress they
   * want to isolate (in case an earlier request left stray lines) and once
   * more right after awaiting that call's response. */
  takeProgressLines(): SidecarProgressLine[] {
    const lines = this.progressLines.slice();
    this.progressLines.length = 0;
    return lines;
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

  // Regression: the command map was a plain object literal, and dispatch was
  // a bracket lookup on the unvalidated `command` string off the wire -- so
  // every Object.prototype member was reachable as a "command" that ran and
  // reported success. `{"command":"toString"}` returned
  // {"ok":true,"result":"[object Undefined]"}. The map now has a null
  // prototype and dispatch checks own-property + callability.
  it(
    'refuses Object.prototype members as commands instead of dispatching them',
    async () => {
      const cwd = newScratchCwd('proto-dispatch');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        for (const command of [
          'toString',
          'valueOf',
          'constructor',
          'hasOwnProperty',
          'isPrototypeOf',
          '__proto__',
        ]) {
          const resp = await session.request(command, {});
          expect(resp.ok, `expected "${command}" to be refused, not dispatched`).toBe(false);
          expect(JSON.stringify(resp.error)).toContain('Unknown command');
        }

        // A genuinely unknown name still behaves the same way, and the
        // session is still healthy afterwards.
        const bogus = await session.request('definitely.not.a.command', {});
        expect(bogus.ok).toBe(false);

        const listResp = await session.request('remote.list', {});
        expect(listResp.ok).toBe(true);
      } finally {
        expect(await session.close()).toBe(0);
      }
    },
    30_000,
  );

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
    'remote.remove unregisters a remote, deletes its local cache clone, and a subsequent remote.list no longer shows it',
    async () => {
      const cwd = newScratchCwd('remote-remove');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const addResp = await session.request('remote.add', {
          url: fixtureRemoteDir,
          name: 'sidecar-remote-to-remove',
        });
        expect(addResp.ok).toBe(true);
        const dest = cachePath('sidecar-remote-to-remove');
        expect(fs.existsSync(dest)).toBe(true);

        const removeResp = await session.request('remote.remove', {
          name: 'sidecar-remote-to-remove',
        });
        expect(removeResp.ok).toBe(true);
        expect(removeResp.result).toMatchObject({ name: 'sidecar-remote-to-remove' });

        // The local cache clone is actually deleted, not just unregistered.
        expect(fs.existsSync(dest)).toBe(false);

        const listResp = await session.request('remote.list', {});
        const remotes = listResp.result as Array<{ name: string; url: string }>;
        expect(remotes.find((r) => r.name === 'sidecar-remote-to-remove')).toBeUndefined();
      } finally {
        expect(await session.close()).toBe(0);
      }
    },
    30_000,
  );

  it(
    'remote.remove on a name that was never registered fails cleanly with RemoteRegistryError',
    async () => {
      const cwd = newScratchCwd('remote-remove-missing');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const removeResp = await session.request('remote.remove', { name: 'never-registered' });
        expect(removeResp.ok).toBe(false);
        expect(removeResp.error?.type).toBe('RemoteRegistryError');
        expect(removeResp.error?.message).toContain('never-registered');
      } finally {
        expect(await session.close()).toBe(0);
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
    'artifact.push (edit mode): the sidecar has no octokit-injection point, so it reaches ' +
      'the real GitHub auth/API boundary and fails cleanly there, writing nothing',
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
      await addRemoteEntry({ name: remoteName, url: fakeGithubUrl, addedAt: new Date().toISOString() });
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

        const branchesBefore = (await simpleGit(fixtureRemoteDir).branch(['-a'])).all;

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

        // This test used to assert the OPPOSITE of what the code does: that
        // "the branch/commit/push sequence happens BEFORE the GitHub API
        // call", and therefore that a `deliveryos/<id>/...` branch existed in
        // the fixture remote afterwards. In edit mode pushArtifact calls
        // createOctokit and then fetchRepoInfo well before createBranch, so
        // this push dies at the GitHub boundary with no git write at all and
        // that branch is never created.
        //
        // The assertion nonetheless "passed" in a full-suite run, because
        // OTHER tests in this file push real branches into the same shared
        // fixture remote -- so it was reading another test's leftover state.
        // In isolation it failed every time. That is what made this one of
        // the suite's two long-standing "flaky" failures: it was never
        // flaky, it was order-dependent and wrong.
        //
        // What is actually worth asserting is that the failure happened at
        // the GitHub boundary and left nothing behind: no new branch pushed
        // by THIS attempt (snapshot-compared, since the fixture is shared),
        // and a local cache not parked on a half-built push branch.
        const branchesAfter = (await simpleGit(fixtureRemoteDir).branch(['-a'])).all;
        expect(branchesAfter).toEqual(branchesBefore);

        const cacheStatus = await simpleGit(cachePath(remoteName)).status();
        expect(cacheStatus.current?.startsWith('deliveryos/')).toBe(false);
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  it(
    'artifact.pull emits progress stages in order (resolve, copy, post_install, snapshot, '
      + 'install-params, lockfile) before the final response, and the final response shape '
      + 'is untouched',
    async () => {
      const cwd = newScratchCwd('pull-progress');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const addResp = await session.request('remote.add', {
          url: fixtureRemoteDir,
          name: 'sidecar-remote-pull-progress',
        });
        expect(addResp.ok).toBe(true);
        session.takeProgressLines(); // discard remote.add's own progress lines (it emits none, but be defensive)

        // handbook-doc is TEST_ARTIFACTS's one artifact with a post_install
        // command -- pulling it exercises all 5 progress stages, including
        // the 'post_install' one that's conditionally emitted.
        const artifact = TEST_ARTIFACTS.find((a) => a.hasPostInstall)!;
        const pullResp = await session.request('artifact.pull', {
          id: artifact.id,
          remote: 'sidecar-remote-pull-progress',
          cwd,
        });
        expect(pullResp.ok).toBe(true);

        const progressLines = session.takeProgressLines();
        expect(progressLines.map((p) => p.stage)).toEqual([
          'resolve',
          'verify',
          'copy',
          'post_install',
          'snapshot',
          'install-params',
          'lockfile',
        ]);
        for (const line of progressLines) {
          expect(line.id).toBe(pullResp.id);
          expect(line.stage.length).toBeGreaterThan(0);
          expect(line.message.length).toBeGreaterThan(0);
        }

        // Adding progress lines must not have changed the final response's
        // own shape -- still exactly {id, ok, result}, nothing extra bolted
        // on and nothing dropped.
        expect(Object.keys(pullResp).sort()).toEqual(['id', 'ok', 'result']);
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  it(
    "artifact.pull on an artifact WITHOUT post_install emits progress stages with the "
      + "'post_install' stage absent",
    async () => {
      const cwd = newScratchCwd('pull-progress-no-postinstall');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const addResp = await session.request('remote.add', {
          url: fixtureRemoteDir,
          name: 'sidecar-remote-pull-progress-2',
        });
        expect(addResp.ok).toBe(true);
        session.takeProgressLines();

        const artifact = TEST_ARTIFACTS.find((a) => !a.hasPostInstall)!;
        const pullResp = await session.request('artifact.pull', {
          id: artifact.id,
          remote: 'sidecar-remote-pull-progress-2',
          cwd,
        });
        expect(pullResp.ok).toBe(true);

        const stages = session.takeProgressLines().map((p) => p.stage);
        expect(stages).toEqual(['resolve', 'verify', 'copy', 'snapshot', 'install-params', 'lockfile']);
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  it(
    'artifact.push emits early progress stages (fetch, diff, ...) before hitting the real '
      + 'GitHub-auth wall',
    async () => {
      // Same split as the existing "artifact.push (edit mode)" coverage-gap
      // test above: a fake github.com-shaped URL registered directly (so
      // the sidecar's own remote.add isn't asked to clone a real
      // github.com URL), cloned from the real local fixture "remote".
      const remoteName = 'sidecar-remote-push-progress';
      const fakeGithubUrl =
        'https://github.com/deliveryos-qa-fake-owner/deliveryos-qa-fake-repo-progress.git';
      await addRemoteEntry({ name: remoteName, url: fakeGithubUrl, addedAt: new Date().toISOString() });
      await cloneRemote(remoteName, fixtureRemoteDir);

      const cwd = newScratchCwd('push-progress');
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
          '# welcome-template\n\nedited for the push progress test.\n',
          'utf-8',
        );

        session.takeProgressLines(); // discard the pull's own progress lines
        const pushResp = await session.request('artifact.push', {
          id: artifact.id,
          cwd,
          options: {},
        });
        expect(pushResp.ok).toBe(false);
        expect(['GithubAuthError', 'GithubApiError']).toContain(pushResp.error?.type);

        const stages = session.takeProgressLines().map((p) => p.stage);
        // How far push gets before hitting the real GitHub-auth wall could
        // vary slightly machine-to-machine (gh CLI installed/logged in or
        // not) -- assert a reasonable early prefix rather than the exact
        // full stage list, to avoid flakiness.
        expect(stages.length).toBeGreaterThan(0);
        expect(stages.slice(0, 2)).toEqual(['fetch', 'diff']);
        for (const stage of stages) {
          expect(typeof stage).toBe('string');
          expect(stage.length).toBeGreaterThan(0);
        }
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

  it(
    'sync.checkForUpdates detects a version bump pushed upstream to a pulled artifact, '
      + "fetching fresh before comparing, and leaves an untouched pulled artifact out of the result",
    async () => {
      const cwd = newScratchCwd('sync-check-updates');
      const remoteName = 'sidecar-remote-sync';
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const addResp = await session.request('remote.add', {
          url: fixtureRemoteDir,
          name: remoteName,
        });
        expect(addResp.ok).toBe(true);

        const welcome = TEST_ARTIFACTS.find((a) => a.id === 'welcome-template')!;
        const lintConfig = TEST_ARTIFACTS.find((a) => a.id === 'lint-config')!;

        const pullWelcome = await session.request('artifact.pull', {
          id: welcome.id,
          remote: remoteName,
          cwd,
        });
        expect(pullWelcome.ok).toBe(true);

        // A second artifact, pulled but never modified upstream -- proves
        // checkForUpdates doesn't just report everything that was pulled.
        const pullLintConfig = await session.request('artifact.pull', {
          id: lintConfig.id,
          remote: remoteName,
          cwd,
        });
        expect(pullLintConfig.ok).toBe(true);

        // Bump welcome-template's version directly against the fixture
        // "remote" repo -- same direct simpleGit(fixtureRemoteDir)
        // read/write-file/add/commit pattern the push-progress tests above
        // use, just editing the manifest instead of leaving it alone.
        const manifestPath = path.join(
          fixtureRemoteDir,
          'artifacts',
          welcome.id,
          'manifest.yaml',
        );
        const originalManifest = fs.readFileSync(manifestPath, 'utf-8');
        const bumpedManifest = originalManifest.replace(/^version: .*$/m, 'version: 1.1.0');
        expect(bumpedManifest).not.toBe(originalManifest);
        fs.writeFileSync(manifestPath, bumpedManifest, 'utf-8');

        const fixtureGit = simpleGit(fixtureRemoteDir);
        await fixtureGit.add(['artifacts/welcome-template/manifest.yaml']);
        await fixtureGit.commit('bump welcome-template to 1.1.0');

        session.takeProgressLines(); // discard the two pulls' own progress lines

        const checkResp = await session.request('sync.checkForUpdates', { cwd });
        expect(checkResp.ok).toBe(true);
        const updates = checkResp.result as Array<{
          id: string;
          remote: string;
          installedVersion: string;
          availableVersion: string;
        }>;

        expect(updates).toHaveLength(1);
        expect(updates[0]).toEqual({
          id: 'welcome-template',
          remote: remoteName,
          installedVersion: '1.0.0',
          availableVersion: '1.1.0',
        });

        const progressLines = session.takeProgressLines();
        expect(progressLines.some((line) => line.stage === 'fetch')).toBe(true);
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  it(
    'artifact.pull applies values passed as "values", and artifact.applyInstallParams configures the rest afterward without a re-pull',
    async () => {
      const installParamsRemoteDir = await createTestRemoteWithInstallParamsArtifact();
      const cwd = newScratchCwd('install-params');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const addResp = await session.request('remote.add', {
          url: installParamsRemoteDir,
          name: 'sidecar-remote-install-params',
        });
        expect(addResp.ok).toBe(true);

        // AUTH_URL is deliberately omitted here -- its manifest-declared
        // default should apply on its own, exercising the same
        // provided-value-wins-over-default rule both artifact.pull and
        // artifact.applyInstallParams share via resolveInstallParamValues.
        const pullResp = await session.request('artifact.pull', {
          id: INSTALL_PARAMS_ARTIFACT.id,
          remote: 'sidecar-remote-install-params',
          cwd,
          values: { AUTH_SECRET: 'from-pull' },
        });
        expect(pullResp.ok).toBe(true);
        expect((pullResp.result as { missingRequiredParams: string[] }).missingRequiredParams)
          .toEqual(['DATABASE_URL']);

        let envContent = fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8');
        expect(envContent).toContain('AUTH_SECRET=from-pull');
        expect(envContent).toContain('AUTH_URL=http://localhost:3000');
        expect(envContent).not.toContain('DATABASE_URL');

        // Now configure the still-missing value WITHOUT a re-pull -- the
        // real point of this command existing at all (going back later to
        // fix one value, from Detail, after already having pulled).
        const applyResp = await session.request('artifact.applyInstallParams', {
          id: INSTALL_PARAMS_ARTIFACT.id,
          remote: 'sidecar-remote-install-params',
          cwd,
          values: { DATABASE_URL: 'postgres://from-apply' },
        });
        expect(applyResp.ok).toBe(true);
        expect((applyResp.result as { missingRequiredParams: string[] }).missingRequiredParams)
          .toEqual([]);

        envContent = fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8');
        expect(envContent).toContain('DATABASE_URL=postgres://from-apply');
        // The earlier values must survive untouched -- applyInstallParams
        // only ever updates the keys it was actually given.
        expect(envContent).toContain('AUTH_SECRET=from-pull');
      } finally {
        await session.close();
        await teardownTestRemote(installParamsRemoteDir);
      }
    },
    30_000,
  );

  it(
    'artifact.readInstallParamValues returns only the REAL values already sitting in .env.local for THIS artifact\'s own declared install_params, never leaking an unrelated key or a manifest default that was never actually written',
    async () => {
      const installParamsRemoteDir = await createTestRemoteWithInstallParamsArtifact();
      const cwd = newScratchCwd('read-install-param-values');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const addResp = await session.request('remote.add', {
          url: installParamsRemoteDir,
          name: 'sidecar-remote-read-install-params',
        });
        expect(addResp.ok).toBe(true);

        // AUTH_SECRET provided this call; AUTH_URL takes its manifest
        // default and gets persisted for real; DATABASE_URL stays
        // genuinely unset (no value provided, no default declared).
        const pullResp = await session.request('artifact.pull', {
          id: INSTALL_PARAMS_ARTIFACT.id,
          remote: 'sidecar-remote-read-install-params',
          cwd,
          values: { AUTH_SECRET: 'from-pull' },
        });
        expect(pullResp.ok).toBe(true);

        // A key some OTHER artifact's own config wrote into the same
        // project-root .env.local -- must never come back out of this
        // call, since it isn't one of THIS manifest's own install_params.
        fs.appendFileSync(path.join(cwd, '.env.local'), 'UNRELATED_OTHER_ARTIFACT_KEY=should-not-leak\n');

        const readResp = await session.request('artifact.readInstallParamValues', {
          id: INSTALL_PARAMS_ARTIFACT.id,
          remote: 'sidecar-remote-read-install-params',
          cwd,
        });
        expect(readResp.ok).toBe(true);
        expect((readResp.result as { values: Record<string, string> }).values).toEqual({
          AUTH_SECRET: 'from-pull',
          AUTH_URL: 'http://localhost:3000',
        });

        // Configure the still-missing value without a re-pull -- the exact
        // scenario this command exists for (Detail's Configuration tab
        // pre-filling from a real value a PRIOR visit already saved).
        const applyResp = await session.request('artifact.applyInstallParams', {
          id: INSTALL_PARAMS_ARTIFACT.id,
          remote: 'sidecar-remote-read-install-params',
          cwd,
          values: { DATABASE_URL: 'postgres://from-apply' },
        });
        expect(applyResp.ok).toBe(true);

        const readResp2 = await session.request('artifact.readInstallParamValues', {
          id: INSTALL_PARAMS_ARTIFACT.id,
          remote: 'sidecar-remote-read-install-params',
          cwd,
        });
        expect(readResp2.ok).toBe(true);
        expect((readResp2.result as { values: Record<string, string> }).values).toEqual({
          AUTH_SECRET: 'from-pull',
          AUTH_URL: 'http://localhost:3000',
          DATABASE_URL: 'postgres://from-apply',
        });
      } finally {
        await session.close();
        await teardownTestRemote(installParamsRemoteDir);
      }
    },
    30_000,
  );

  it(
    'artifact.readPayloadFile reads a real file out of an artifact\'s payload, and returns undefined (not an error) for one that doesn\'t exist',
    async () => {
      const cwd = newScratchCwd('read-payload-file');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const remoteName = 'sidecar-remote-read-payload';
        const addResp = await session.request('remote.add', { url: fixtureRemoteDir, name: remoteName });
        expect(addResp.ok).toBe(true);

        const artifact = TEST_ARTIFACTS[0];
        const readResp = await session.request('artifact.readPayloadFile', {
          remote: remoteName,
          id: artifact.id,
          path: 'README.md',
        });
        expect(readResp.ok).toBe(true);
        expect((readResp.result as { content?: string }).content).toContain(`# ${artifact.id}`);

        const missingResp = await session.request('artifact.readPayloadFile', {
          remote: remoteName,
          id: artifact.id,
          path: 'no-such-file.md',
        });
        expect(missingResp.ok).toBe(true);
        expect((missingResp.result as { content?: string }).content).toBeUndefined();

        // Real security boundary, not just a nicety -- a path-traversal
        // attempt must be refused outright, the same discipline compile.ts's
        // own import sandboxing already established for preview.tsx.
        const escapeResp = await session.request('artifact.readPayloadFile', {
          remote: remoteName,
          id: artifact.id,
          path: '../../../../package.json',
        });
        expect(escapeResp.ok).toBe(false);
        expect(escapeResp.error?.message).toContain('outside');
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  it(
    'artifact.resolveWiringActions resolves against the real project at cwd, absent vs. present, with no file ever written',
    async () => {
      const wiringRemoteDir = await createTestRemoteWithInstallParamsArtifact();
      const cwd = newScratchCwd('resolve-wiring-actions');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const remoteName = 'sidecar-remote-wiring';
        const addResp = await session.request('remote.add', { url: wiringRemoteDir, name: remoteName });
        expect(addResp.ok).toBe(true);

        // Neither auth.ts nor middleware.ts exists yet in this fresh
        // project -- both actions should resolve to their whenAbsent
        // variant.
        const beforeResp = await session.request('artifact.resolveWiringActions', {
          id: INSTALL_PARAMS_ARTIFACT.id,
          remote: remoteName,
          cwd,
        });
        expect(beforeResp.ok).toBe(true);
        const before = beforeResp.result as Array<{
          targetFile: string; targetFileExists: boolean; snippet?: string; instructions: string;
        }>;
        expect(before).toHaveLength(2);
        const authAction = before.find((a) => a.targetFile === 'auth.ts')!;
        expect(authAction.targetFileExists).toBe(false);
        expect(authAction.snippet).toContain('NextAuth');
        const middlewareAction = before.find((a) => a.targetFile === 'middleware.ts')!;
        expect(middlewareAction.targetFileExists).toBe(false);
        expect(middlewareAction.snippet).toContain('auth as middleware');

        // Now seed a real middleware.ts in the project -- re-resolving
        // must flip that ONE action to its whenPresent variant (merge
        // guidance instructions, no whenPresent.snippet of its own) while
        // auth.ts's own resolution is unaffected.
        fs.writeFileSync(path.join(cwd, 'middleware.ts'), 'export default function middleware() {}', 'utf-8');

        const afterResp = await session.request('artifact.resolveWiringActions', {
          id: INSTALL_PARAMS_ARTIFACT.id,
          remote: remoteName,
          cwd,
        });
        expect(afterResp.ok).toBe(true);
        const after = afterResp.result as Array<{
          targetFile: string; targetFileExists: boolean; snippet?: string;
          snippetIsFullFileReference?: boolean; instructions: string;
        }>;
        const authAfter = after.find((a) => a.targetFile === 'auth.ts')!;
        expect(authAfter.targetFileExists).toBe(false);
        const middlewareAfter = after.find((a) => a.targetFile === 'middleware.ts')!;
        expect(middlewareAfter.targetFileExists).toBe(true);
        // whenPresent declared no snippet of its own, so this falls back to
        // whenAbsent's own canonical content -- a real reference for "Merge
        // with Claude" to work from, not an absent value (see wiring.ts's
        // own ResolvedWiringAction.snippet doc comment for why). Flagged
        // via snippetIsFullFileReference so it's never mislabeled to the
        // model as author-written merge guidance (see requestWiringMerge.ts).
        expect(middlewareAfter.snippet).toContain('auth as middleware');
        expect(middlewareAfter.snippetIsFullFileReference).toBe(true);
        expect(middlewareAfter.instructions).toContain('Merge');

        // Purely read-only -- resolving never creates/modifies auth.ts,
        // and the middleware.ts we seeded by hand is untouched.
        expect(fs.existsSync(path.join(cwd, 'auth.ts'))).toBe(false);
        expect(fs.readFileSync(path.join(cwd, 'middleware.ts'), 'utf-8'))
          .toBe('export default function middleware() {}');
      } finally {
        await session.close();
        await teardownTestRemote(wiringRemoteDir);
      }
    },
    30_000,
  );

  it(
    'artifact.pullAndAutoWire (Phase 10 item 1) applies whenAbsent actions for real, leaves an existing file alone, and reports a build result',
    async () => {
      const remoteDir = await createTestRemoteWithInstallParamsArtifact();
      const cwd = newScratchCwd('pull-and-auto-wire');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const remoteName = 'sidecar-remote-auto-wire';
        const addResp = await session.request('remote.add', { url: remoteDir, name: remoteName });
        expect(addResp.ok).toBe(true);

        // Seed middleware.ts by hand first -- INSTALL_PARAMS_ARTIFACT
        // declares whenPresent for this one, so it must be left
        // completely untouched; auth.ts has no whenPresent, so it must
        // get auto-created.
        fs.writeFileSync(path.join(cwd, 'middleware.ts'), 'export default function middleware() {}', 'utf-8');
        // A real, passing build command -- proves the "-and-test" half
        // for real, not just that wiring got applied.
        fs.writeFileSync(
          path.join(cwd, 'package.json'),
          JSON.stringify({ name: 'x', scripts: { build: 'node -e "console.log(1)"' } }),
          'utf-8',
        );

        const resp = await session.request('artifact.pullAndAutoWire', {
          id: INSTALL_PARAMS_ARTIFACT.id,
          remote: remoteName,
          cwd,
          values: { AUTH_SECRET: 'x', DATABASE_URL: 'postgres://x' },
        });

        expect(resp.ok).toBe(true);
        const result = resp.result as {
          pullResult: { manifest: { id: string } };
          wiring: { applied: string[]; needsReview: string[] };
          build: { ran: boolean; command?: string; success?: boolean };
        };
        expect(result.pullResult.manifest.id).toBe(INSTALL_PARAMS_ARTIFACT.id);
        expect(result.wiring.applied).toEqual(['auth.ts']);
        expect(result.wiring.needsReview).toEqual(['middleware.ts']);
        expect(result.build).toEqual({ ran: true, command: 'npm run build', success: true, output: expect.any(String) });

        // Real, on-disk proof, not just the returned result.
        expect(fs.existsSync(path.join(cwd, 'auth.ts'))).toBe(true);
        expect(fs.readFileSync(path.join(cwd, 'middleware.ts'), 'utf-8'))
          .toBe('export default function middleware() {}');
      } finally {
        await session.close();
        await teardownTestRemote(remoteDir);
      }
    },
    30_000,
  );

  it(
    'artifact.pull refuses via the sidecar too (ok: false, real error surfaced), before any files are written, when a declared signature has no bundle on disk',
    async () => {
      const signedRemoteDir = await createTestRemoteWithSignedArtifact({
        contentDigestMatchesPayload: true,
        includeSignatureBundle: false,
      });
      const cwd = newScratchCwd('signed-nobundle');
      const session = new SidecarSession(cwd, deliveryOsHome);
      try {
        const remoteName = 'sidecar-remote-signed-nobundle';
        const addResp = await session.request('remote.add', { url: signedRemoteDir, name: remoteName });
        expect(addResp.ok).toBe(true);

        const pullResp = await session.request('artifact.pull', {
          id: SIGNED_ARTIFACT.id,
          remote: remoteName,
          cwd,
        });

        expect(pullResp.ok).toBe(false);
        expect(pullResp.error?.type).toBe('SignatureVerificationError');
        expect(pullResp.error?.message).toContain('no signature bundle was found');
        expect(fs.existsSync(path.join(cwd, SIGNED_ARTIFACT.installTarget))).toBe(false);
      } finally {
        await session.close();
        await teardownTestRemote(signedRemoteDir);
      }
    },
    30_000,
  );
});
