import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addRemoteEntry } from '../../src/engine/remote/remoteRegistry';
import { requireContributableRemote } from '../../src/engine/remote/requireContributableRemote';
import { RemoteRegistryError, UnsupportedRemoteError } from '../../src/engine/errors';

/**
 * One check, one message, for every path that contributes.
 *
 * The three fragments asserted below are pinned by older tests elsewhere
 * (`folderBackend.e2e`, `adoptCli.e2e`, `mirrorAndAdopt.e2e`) against what used
 * to be two different messages. Keeping all three in one sentence is the
 * contract this helper has to honour.
 */

let home: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.DELIVERYOS_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-contributable-'));
  process.env.DELIVERYOS_HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.DELIVERYOS_HOME;
  else process.env.DELIVERYOS_HOME = originalHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('requireContributableRemote', () => {
  it('returns the entry with its owner and repo for a GitHub remote', async () => {
    await addRemoteEntry({ name: 'acme', url: 'https://github.com/acme/catalog.git', addedAt: new Date().toISOString() });
    const result = requireContributableRemote('acme');
    expect(result.owner).toBe('acme');
    expect(result.repo).toBe('catalog');
    expect(result.entry.name).toBe('acme');
  });

  it('refuses a folder library by capability, naming the real problem', async () => {
    await addRemoteEntry({ name: 'lib', url: 'C:/synced/Contoso', backend: 'folder', addedAt: new Date().toISOString() });

    // Before this helper, the preview path reached parseGithubUrl first and
    // said "not a recognizable github.com URL" -- true, and blaming the URL's
    // spelling for what is really the absence of anywhere to review a change.
    expect(() => requireContributableRemote('lib')).toThrow(UnsupportedRemoteError);
    expect(() => requireContributableRemote('lib')).toThrow(/folder library.*reviewed before it lands/s);
    expect(() => requireContributableRemote('lib')).toThrow(/cannot receive a mirror/);
    expect(() => requireContributableRemote('lib')).not.toThrow(/github\.com URL/);
  });

  it('still refuses a git host DeliveryOS cannot open a pull request on', async () => {
    // The capability says "a git remote can hold a proposal"; it does not say
    // DeliveryOS knows how to open one there. That second question is the
    // GitHub parser's, and it must keep being asked.
    await addRemoteEntry({ name: 'gl', url: 'https://gitlab.com/org/project.git', addedAt: new Date().toISOString() });
    expect(() => requireContributableRemote('gl')).toThrow(/not a recognizable github\.com URL/);
  });

  it('refuses an unregistered name as a registry error', () => {
    expect(() => requireContributableRemote('nope')).toThrow(RemoteRegistryError);
    expect(() => requireContributableRemote('nope')).toThrow(/No remote named "nope"/);
  });
});
