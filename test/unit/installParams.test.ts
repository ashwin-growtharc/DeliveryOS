import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveInstallParamValues,
  applyInstallParams,
  readExistingEnvValues,
  applyEnvExamplePlaceholders,
  checkEnvLocalGitignoreCoverage,
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

  it('re-running with identical input produces byte-identical output -- real idempotency, not just "doesn\'t throw"', () => {
    applyInstallParams(cwd, { AUTH_SECRET: 'value-one', AUTH_URL: 'http://localhost:3000' });
    const firstContent = fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8');

    applyInstallParams(cwd, { AUTH_SECRET: 'value-one', AUTH_URL: 'http://localhost:3000' });
    const secondContent = fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8');

    expect(secondContent).toBe(firstContent);
  });

  it('CRLF-terminated existing content still parses and upserts correctly', () => {
    fs.writeFileSync(path.join(cwd, '.env.local'), 'EXISTING=keep\r\nAUTH_SECRET=old\r\n', 'utf-8');

    applyInstallParams(cwd, { AUTH_SECRET: 'new' });

    const content = fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8');
    expect(content).toContain('EXISTING=keep');
    expect(content).toContain('AUTH_SECRET=new');
    expect(content).not.toContain('AUTH_SECRET=old');
  });
});

describe('applyEnvExamplePlaceholders (Tier 1 of the wiring agent, Phase 7 item 6)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-env-example-test-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('a secret param always gets a blank placeholder, regardless of anything else', () => {
    applyEnvExamplePlaceholders(cwd, [
      { key: 'AUTH_SECRET', description: 'Session secret', secret: true, required: true },
    ]);
    const content = fs.readFileSync(path.join(cwd, '.env.example'), 'utf-8');
    expect(content).toBe('AUTH_SECRET=\n');
  });

  it('a non-secret param with a declared default uses that default as the placeholder', () => {
    applyEnvExamplePlaceholders(cwd, [
      { key: 'AUTH_URL', description: 'App URL', secret: false, required: true, default: 'http://localhost:3000' },
    ]);
    const content = fs.readFileSync(path.join(cwd, '.env.example'), 'utf-8');
    expect(content).toBe('AUTH_URL=http://localhost:3000\n');
  });

  it('a non-secret param with no default gets a blank placeholder', () => {
    applyEnvExamplePlaceholders(cwd, [
      { key: 'SOME_FLAG', description: 'no default', secret: false, required: false },
    ]);
    const content = fs.readFileSync(path.join(cwd, '.env.example'), 'utf-8');
    expect(content).toBe('SOME_FLAG=\n');
  });

  it('an empty install_params array is a no-op -- no .env.example created for the overwhelming majority of artifacts', () => {
    applyEnvExamplePlaceholders(cwd, []);
    expect(fs.existsSync(path.join(cwd, '.env.example'))).toBe(false);
  });

  it('matches the real nextauth-credentials target\'s exact three placeholders', () => {
    applyEnvExamplePlaceholders(cwd, [
      { key: 'AUTH_SECRET', description: 'Session secret', secret: true, required: true },
      { key: 'AUTH_URL', description: 'App URL', secret: false, required: true, default: 'http://localhost:3000' },
      { key: 'DATABASE_URL', description: 'DB connection string', secret: true, required: true },
    ]);
    const content = fs.readFileSync(path.join(cwd, '.env.example'), 'utf-8');
    expect(content).toBe('AUTH_SECRET=\nAUTH_URL=http://localhost:3000\nDATABASE_URL=\n');
  });

  it('two sequential calls with different key-sets (simulating two different backend-plugin artifacts) each leave the other\'s lines alone', () => {
    applyEnvExamplePlaceholders(cwd, [
      { key: 'AUTH_SECRET', description: 'from artifact A', secret: true, required: true },
    ]);
    applyEnvExamplePlaceholders(cwd, [
      { key: 'OTHER_ARTIFACT_KEY', description: 'from artifact B', secret: false, required: true, default: 'default-value' },
    ]);

    const content = fs.readFileSync(path.join(cwd, '.env.example'), 'utf-8');
    expect(content).toBe('AUTH_SECRET=\nOTHER_ARTIFACT_KEY=default-value\n');
  });

  it('re-running with the same install_params is byte-identical the second time', () => {
    const params = [
      { key: 'AUTH_SECRET', description: 'Session secret', secret: true, required: true },
      { key: 'AUTH_URL', description: 'App URL', secret: false, required: true, default: 'http://localhost:3000' },
    ];
    applyEnvExamplePlaceholders(cwd, params);
    const first = fs.readFileSync(path.join(cwd, '.env.example'), 'utf-8');
    applyEnvExamplePlaceholders(cwd, params);
    const second = fs.readFileSync(path.join(cwd, '.env.example'), 'utf-8');
    expect(second).toBe(first);
  });

  it('never writes .env.local, and applyInstallParams never writes .env.example -- the two files are independent', () => {
    applyEnvExamplePlaceholders(cwd, [
      { key: 'AUTH_SECRET', description: 'Session secret', secret: true, required: true },
    ]);
    expect(fs.existsSync(path.join(cwd, '.env.local'))).toBe(false);

    applyInstallParams(cwd, { DATABASE_URL: 'postgres://real' });
    const exampleContent = fs.readFileSync(path.join(cwd, '.env.example'), 'utf-8');
    expect(exampleContent).not.toContain('DATABASE_URL');
  });
});

describe('checkEnvLocalGitignoreCoverage', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-gitignore-coverage-test-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('warns when there is no .gitignore at all', () => {
    const warning = checkEnvLocalGitignoreCoverage(cwd);
    expect(warning).toBeDefined();
    expect(warning).toContain('.gitignore');
  });

  it('does not warn when .gitignore covers .env.local directly', () => {
    fs.writeFileSync(path.join(cwd, '.gitignore'), 'node_modules\n.env.local\n', 'utf-8');
    expect(checkEnvLocalGitignoreCoverage(cwd)).toBeUndefined();
  });

  it('does not warn when .gitignore covers it via a broader ".env*" pattern', () => {
    fs.writeFileSync(path.join(cwd, '.gitignore'), '.env*\n', 'utf-8');
    expect(checkEnvLocalGitignoreCoverage(cwd)).toBeUndefined();
  });

  it('does not warn when .gitignore covers it via a broader "*.local" pattern', () => {
    fs.writeFileSync(path.join(cwd, '.gitignore'), '*.local\n', 'utf-8');
    expect(checkEnvLocalGitignoreCoverage(cwd)).toBeUndefined();
  });

  it('warns when .gitignore exists but has only unrelated entries', () => {
    fs.writeFileSync(path.join(cwd, '.gitignore'), 'node_modules\ndist/\n*.log\n', 'utf-8');
    const warning = checkEnvLocalGitignoreCoverage(cwd);
    expect(warning).toBeDefined();
  });

  it('never throws, even against a directory that does not exist', () => {
    const missingDir = path.join(cwd, 'does-not-exist');
    expect(() => checkEnvLocalGitignoreCoverage(missingDir)).not.toThrow();
  });
});

describe('applyInstallParams return shape (gitignore coverage warning)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-apply-install-params-warning-test-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('does NOT even attempt the gitignore check when values is {} -- no warning, even in a directory with clearly no coverage', () => {
    // This same directory (no .gitignore at all) WOULD warn if values were
    // non-empty -- see the next test. The absence of a warning here proves
    // the "only check when something was actually written" gate worked,
    // not that the directory happened to be safely covered.
    const result = applyInstallParams(cwd, {});
    expect(result.gitignoreWarning).toBeUndefined();
    expect(fs.existsSync(path.join(cwd, '.gitignore'))).toBe(false);
  });

  it('returns a gitignoreWarning when a real value was written and .env.local is not covered', () => {
    const result = applyInstallParams(cwd, { AUTH_SECRET: 'real-secret-value' });
    expect(result.gitignoreWarning).toBeDefined();
  });

  it('returns no gitignoreWarning when a real value was written but .env.local IS covered', () => {
    fs.writeFileSync(path.join(cwd, '.gitignore'), '.env.local\n', 'utf-8');
    const result = applyInstallParams(cwd, { AUTH_SECRET: 'real-secret-value' });
    expect(result.gitignoreWarning).toBeUndefined();
  });
});

describe('install_param key/value sanitization (write-site, agreeing with parseEnvLines)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-env-sanitize-test-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  // A manifest's install_params are untrusted: `key` is only
  // z.string().min(1) and `default` is an unconstrained string, and both were
  // interpolated raw into `KEY=VALUE`. A newline ends the line early, so
  // everything after it became its own top-level .env entry -- and a
  // NON-SECRET default is applied with zero user interaction.
  it('refuses a key containing a newline instead of injecting extra .env.local lines', () => {
    const result = applyInstallParams(cwd, { GOOD: '1', 'EVIL\nINJECTED': 'x' });

    expect(fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8')).toBe('GOOD=1\n');
    expect(result.installParamWarning).toContain('EVIL');
    expect(readExistingEnvValues(cwd)).toEqual({ GOOD: '1' });
  });

  it('refuses a VALUE containing a newline -- the shape a manifest default could carry with no user interaction', () => {
    const result = applyInstallParams(cwd, {
      SAFE: 'ok',
      DATABASE_URL: 'x\nNODE_OPTIONS=--require ./evil.js',
    });

    const written = fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8');
    expect(written).toBe('SAFE=ok\n');
    expect(written).not.toContain('NODE_OPTIONS');
    expect(result.installParamWarning).toContain('DATABASE_URL');
  });

  it('does not re-append a refused key on every subsequent pull', () => {
    // parseEnvLines can never match a newline-bearing key, so a raw write took
    // the append branch forever: the injection compounded once per pull.
    applyInstallParams(cwd, { 'EVIL\nINJECTED': 'x' });
    const first = fs.existsSync(path.join(cwd, '.env.local'))
      ? fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8')
      : '';
    applyInstallParams(cwd, { 'EVIL\nINJECTED': 'x' });
    const second = fs.existsSync(path.join(cwd, '.env.local'))
      ? fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8')
      : '';

    expect(second).toBe(first);
    expect(second).not.toContain('INJECTED');
  });

  it('refuses keys the reader regex could never match, so writer and reader cannot disagree', () => {
    for (const key of ['1LEADING_DIGIT', 'has-a-dash', 'has.a.dot', 'has space', '']) {
      const result = applyInstallParams(cwd, { [key]: 'v' });
      expect(result.installParamWarning).toBeDefined();
      expect(readExistingEnvValues(cwd)[key]).toBeUndefined();
    }
  });

  it('still writes every ordinary key exactly as before -- the check does not over-match', () => {
    const result = applyInstallParams(cwd, {
      AUTH_SECRET: 'abc123',
      _LEADING_UNDERSCORE: 'ok',
      MIXED_case_9: 'fine',
      EMPTY_VALUE: '',
      HAS_EQUALS: 'a=b=c',
    });

    expect(result.installParamWarning).toBeUndefined();
    expect(readExistingEnvValues(cwd)).toEqual({
      AUTH_SECRET: 'abc123',
      _LEADING_UNDERSCORE: 'ok',
      MIXED_case_9: 'fine',
      EMPTY_VALUE: '',
      HAS_EQUALS: 'a=b=c',
    });
  });
});
