import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { cloneTo } from '../../src/engine/git/git';
import { createTestRemote, teardownTestRemote } from '../fixtures/testRemote';

// Real bug found via Phase 7's end-to-end test: a Windows machine with the
// (very common) global `core.autocrlf=true` git config checks text files
// out with CRLF line endings, while a Linux CI runner computing/signing a
// content digest over that same repo sees LF -- silently breaking
// signature verification for every such user, even for a genuinely
// untampered artifact. `cloneTo` must force `core.autocrlf=false` on the
// clone itself so DeliveryOS's caches are always byte-faithful to the
// remote, regardless of the host machine's own git config.
describe('cloneTo', () => {
  let sourceDir: string;
  let destDir: string;

  afterEach(async () => {
    if (sourceDir) await teardownTestRemote(sourceDir);
    if (destDir && fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
  });

  it('forces core.autocrlf=false on the cloned repo, regardless of what a global/local config elsewhere might set', async () => {
    sourceDir = await createTestRemote();
    destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-clone-test-'));
    fs.rmSync(destDir, { recursive: true, force: true }); // cloneTo requires dest not to exist

    await cloneTo(sourceDir, destDir);

    const clonedGit = simpleGit(destDir);
    const autocrlf = (await clonedGit.raw(['config', '--get', 'core.autocrlf'])).trim();
    expect(autocrlf).toBe('false');
  }, 30_000);

  it('checks out text files with their committed line endings preserved (LF), not converted', async () => {
    sourceDir = await createTestRemote();

    // Write a real LF-terminated text file into the source fixture repo and
    // commit it, so we have a known-LF byte sequence to check on checkout.
    const git = simpleGit(sourceDir);
    const filePath = path.join(sourceDir, 'artifacts', 'lf-check.txt');
    fs.writeFileSync(filePath, 'line one\nline two\nline three\n', 'utf-8');
    await git.add(['artifacts/lf-check.txt']);
    await git.commit('add LF test file');

    destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-clone-test-'));
    fs.rmSync(destDir, { recursive: true, force: true });

    await cloneTo(sourceDir, destDir);

    const checkedOutBytes = fs.readFileSync(path.join(destDir, 'artifacts', 'lf-check.txt'));
    expect(checkedOutBytes.includes(Buffer.from('\r\n'))).toBe(false);
    expect(checkedOutBytes.toString('utf-8')).toBe('line one\nline two\nline three\n');
  }, 30_000);
});
