import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveInstallParamValues,
  applyInstallParams,
  readExistingEnvValues,
} from '../../src/engine/pull/installParams';
import { InstallParam } from '../../src/engine/manifest/schema';

const PARAMS: InstallParam[] = [
  { key: 'AUTH_SECRET', description: 'Session secret', secret: true, required: true },
  { key: 'AUTH_URL', description: 'App URL', secret: false, required: true, default: 'http://localhost:3000' },
  { key: 'DATABASE_URL', description: 'DB connection string', secret: true, required: true },
  { key: 'OPTIONAL_FLAG', description: 'Not required, no default', secret: false, required: false },
];

describe('resolveInstallParamValues', () => {
  it('uses a provided value over the param\'s own default', () => {
    const { values } = resolveInstallParamValues(PARAMS, { AUTH_URL: 'https://real.example.com' });
    expect(values.AUTH_URL).toBe('https://real.example.com');
  });

  it('falls back to the param\'s default when nothing was provided', () => {
    const { values } = resolveInstallParamValues(PARAMS, {});
    expect(values.AUTH_URL).toBe('http://localhost:3000');
  });

  it('reports every required param with neither a provided value nor a default as missing', () => {
    const { missingRequired } = resolveInstallParamValues(PARAMS, {});
    expect(missingRequired.sort()).toEqual(['AUTH_SECRET', 'DATABASE_URL']);
  });

  it('a provided value clears a param from the missing list', () => {
    const { missingRequired, values } = resolveInstallParamValues(PARAMS, {
      AUTH_SECRET: 'real-secret',
      DATABASE_URL: 'postgres://real',
    });
    expect(missingRequired).toEqual([]);
    expect(values.AUTH_SECRET).toBe('real-secret');
    expect(values.DATABASE_URL).toBe('postgres://real');
  });

  it('a non-required param with no default and no provided value is never reported missing', () => {
    const { missingRequired, values } = resolveInstallParamValues(PARAMS, {});
    expect(missingRequired).not.toContain('OPTIONAL_FLAG');
    expect(values.OPTIONAL_FLAG).toBeUndefined();
  });

  it('an empty params array (the overwhelming majority of real artifacts) resolves to no values and nothing missing', () => {
    const { values, missingRequired } = resolveInstallParamValues([], {});
    expect(values).toEqual({});
    expect(missingRequired).toEqual([]);
  });

  it('falls back to an already-configured "existing" value (from a previous pull/configure call) when nothing new was provided', () => {
    // The real bug this guards against: configuring ONE still-missing
    // value later (via artifact.applyInstallParams, no re-pull) must not
    // make every OTHER already-satisfied param look missing again just
    // because this particular call didn't repeat it.
    const { values, missingRequired } = resolveInstallParamValues(
      PARAMS,
      { DATABASE_URL: 'postgres://new' },
      { AUTH_SECRET: 'already-configured-earlier' },
    );
    expect(values.AUTH_SECRET).toBe('already-configured-earlier');
    expect(values.DATABASE_URL).toBe('postgres://new');
    expect(missingRequired).toEqual([]);
  });

  it('a value provided THIS call wins over an existing one, which in turn wins over the default', () => {
    const { values } = resolveInstallParamValues(
      PARAMS,
      { AUTH_URL: 'https://this-call-wins.example.com' },
      { AUTH_URL: 'https://existing-value.example.com' },
    );
    expect(values.AUTH_URL).toBe('https://this-call-wins.example.com');
  });
});

describe('readExistingEnvValues', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-read-env-test-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('returns {} when .env.local does not exist yet -- the common first-pull case', () => {
    expect(readExistingEnvValues(cwd)).toEqual({});
  });

  it('reads real KEY=VALUE lines, ignoring comments and blank lines', () => {
    fs.writeFileSync(
      path.join(cwd, '.env.local'),
      '# a comment\n\nAUTH_SECRET=abc123\nDATABASE_URL=postgres://real\n',
      'utf-8',
    );
    expect(readExistingEnvValues(cwd)).toEqual({
      AUTH_SECRET: 'abc123',
      DATABASE_URL: 'postgres://real',
    });
  });

  it('round-trips with applyInstallParams -- what gets written is exactly what gets read back', () => {
    applyInstallParams(cwd, { AUTH_SECRET: 'round-trip-value' });
    expect(readExistingEnvValues(cwd)).toEqual({ AUTH_SECRET: 'round-trip-value' });
  });
});

describe('applyInstallParams', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-install-params-test-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('does nothing at all when there are no values to apply -- no .env.local created for the overwhelming majority of artifacts', () => {
    applyInstallParams(cwd, {});
    expect(fs.existsSync(path.join(cwd, '.env.local'))).toBe(false);
  });

  it('creates a fresh .env.local when none exists', () => {
    applyInstallParams(cwd, { AUTH_SECRET: 'abc123', AUTH_URL: 'http://localhost:3000' });
    const content = fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8');
    expect(content).toContain('AUTH_SECRET=abc123');
    expect(content).toContain('AUTH_URL=http://localhost:3000');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('updates an existing key in place without duplicating it, and preserves every other line untouched', () => {
    fs.writeFileSync(
      path.join(cwd, '.env.local'),
      '# a comment\nEXISTING_VAR=keep-me\nAUTH_SECRET=old-value\n\nANOTHER=also-keep\n',
      'utf-8',
    );

    applyInstallParams(cwd, { AUTH_SECRET: 'new-value' });

    const content = fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8');
    const lines = content.split('\n');
    expect(lines).toContain('# a comment');
    expect(lines).toContain('EXISTING_VAR=keep-me');
    expect(lines).toContain('AUTH_SECRET=new-value');
    expect(lines).not.toContain('AUTH_SECRET=old-value');
    expect(lines).toContain('ANOTHER=also-keep');
    // The real point of this test: updating one key must not disturb the
    // intentional blank line between EXISTING_VAR/AUTH_SECRET and ANOTHER,
    // and must not introduce a NEW spurious blank line anywhere else --
    // `content` always ends in exactly one trailing '\n' by design, which
    // itself produces one trailing '' element when split, on top of the
    // one genuinely intentional blank line -- exactly 2, not more.
    expect(lines.filter((l) => l === '')).toHaveLength(2);
  });

  it('appends a genuinely new key after existing content, without introducing a spurious blank line', () => {
    fs.writeFileSync(path.join(cwd, '.env.local'), 'EXISTING=keep\n', 'utf-8');

    applyInstallParams(cwd, { DATABASE_URL: 'postgres://real' });

    const content = fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8');
    expect(content).toBe('EXISTING=keep\nDATABASE_URL=postgres://real\n');
  });

  it('normalizes to exactly one trailing newline even when the existing file had none', () => {
    fs.writeFileSync(path.join(cwd, '.env.local'), 'EXISTING=keep', 'utf-8');

    applyInstallParams(cwd, { NEW_KEY: 'value' });

    const content = fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8');
    expect(content).toBe('EXISTING=keep\nNEW_KEY=value\n');
  });

  it('never writes anything inside a project subdirectory -- only ever <cwd>/.env.local', () => {
    // Regression guard for the real reason this lives in its own module:
    // a value written under an artifact's install_target would be swept
    // into pullArtifact's pristine snapshot. Confirms the write target is
    // always the project root, never anywhere install_target-shaped.
    const installTargetLikeDir = path.join(cwd, 'src', 'lib', 'auth');
    fs.mkdirSync(installTargetLikeDir, { recursive: true });

    applyInstallParams(cwd, { AUTH_SECRET: 'super-secret' });

    expect(fs.existsSync(path.join(cwd, '.env.local'))).toBe(true);
    expect(fs.readdirSync(installTargetLikeDir)).toEqual([]);
  });
});
