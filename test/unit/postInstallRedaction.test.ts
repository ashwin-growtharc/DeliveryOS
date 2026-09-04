import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pullArtifact } from '../../src/engine/pull/pull';
import { PostInstallError } from '../../src/engine/errors';
import { remotesRegistryPath, remoteCachePath } from '../../src/engine/paths';

/**
 * `post_install` output was returned raw -- up to 10 MB of whatever the child
 * process wrote -- and `audit/redact.ts` was wired to four AI audit logs but
 * never to this. That matters because every consumer of the value shows it to
 * somebody: the CLI prints it, the app renders it in Activity, and an MCP tool
 * would put it directly into model context.
 *
 * And `post_install` is almost always a package manager. `npm install` prints
 * registry URLs; Prisma and friends print connection strings. This is not a
 * hypothetical shape of output, it is the common one.
 */

let deliveryOsHome: string;
let projectDir: string;
let originalEnv: string | undefined;
const REMOTE = 'redaction-remote';

/** A credential in the shape real tooling actually emits. */
const LEAKED_PASSWORD = 's3cr3t-pw-should-not-survive';
const LEAKED_LINE = `DATABASE_URL=postgres://admin:${LEAKED_PASSWORD}@localhost:5432/app`;

function seedArtifact(id: string, postInstall: string): void {
  const artifactDir = path.join(remoteCachePath(REMOTE), 'artifacts', id);
  fs.mkdirSync(path.join(artifactDir, 'payload'), { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'payload', 'file.txt'), 'payload\n', 'utf-8');
  fs.writeFileSync(
    path.join(artifactDir, 'manifest.yaml'),
    [
      `id: ${id}`,
      'kind: doc',
      `description: Artifact whose post_install prints a credential`,
      'owner: team-x',
      'version: 1.0.0',
      'source_repo: https://example.invalid/repo',
      `install_target: ${id}`,
      'review_required: false',
      `post_install: ${postInstall}`,
      '',
    ].join('\n'),
    'utf-8',
  );
}

beforeEach(() => {
  originalEnv = process.env.DELIVERYOS_HOME;
  deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-redact-home-'));
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-redact-project-'));
  process.env.DELIVERYOS_HOME = deliveryOsHome;
  fs.mkdirSync(deliveryOsHome, { recursive: true });
  fs.writeFileSync(
    remotesRegistryPath(),
    JSON.stringify({
      remotes: [{ name: REMOTE, url: 'https://example.invalid/r', addedAt: new Date().toISOString() }],
    }),
    'utf-8',
  );
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.DELIVERYOS_HOME;
  else process.env.DELIVERYOS_HOME = originalEnv;
  fs.rmSync(deliveryOsHome, { recursive: true, force: true });
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe('post_install output redaction', () => {
  it('redacts a credential the command printed on success, without mangling the rest', async () => {
    seedArtifact('leaky-ok', `node -e "console.log('installing'); console.log('${LEAKED_LINE}'); console.log('done')"`);

    const result = await pullArtifact('leaky-ok', REMOTE, projectDir);
    const output = result.postInstallOutput ?? '';

    expect(output, 'post_install should have produced output').not.toBe('');
    expect(output).not.toContain(LEAKED_PASSWORD);
    // Still readable as build output -- this uses the NON-truncating variant,
    // so surrounding lines survive intact. A redactor that ate the whole field
    // would pass the assertion above and be useless.
    expect(output).toContain('installing');
    expect(output).toContain('done');
  }, 60_000);

  it('redacts a credential in the FAILURE path too, where it lands in an error message', async () => {
    // The riskier of the two: this string is concatenated into a
    // PostInstallError the CLI prints verbatim and the app renders in Activity.
    seedArtifact(
      'leaky-fail',
      `node -e "console.log('${LEAKED_LINE}'); process.exit(1)"`,
    );

    let message = '';
    try {
      await pullArtifact('leaky-fail', REMOTE, projectDir);
      throw new Error('expected the failing post_install to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PostInstallError);
      message = (err as Error).message;
    }

    expect(message).toContain('leaky-fail');
    expect(message).not.toContain(LEAKED_PASSWORD);
  }, 60_000);
});
