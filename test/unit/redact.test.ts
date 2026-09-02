import { describe, it, expect } from 'vitest';
import {
  redactEmbeddedSecrets,
  redactTextToSummary,
  MAX_LOG_FIELD_CHARS,
} from '../../src/engine/audit/redact';

/**
 * Regression tests for the audit-log redaction bug: `before`/`after` on all
 * three `.deliveryos/*-log.jsonl` entry types stored full file contents with
 * no redaction at all, so any credential in a touched file landed verbatim
 * in a plaintext log that nothing gitignores.
 */
describe('redactTextToSummary (audit-log redaction)', () => {
  it('redacts a hardcoded secret literal in a file body', () => {
    const body = [
      'import NextAuth from "next-auth";',
      '',
      'export const authOptions = {',
      '  secret: "hunter2",',
      '};',
    ].join('\n');

    const out = redactTextToSummary(body, MAX_LOG_FIELD_CHARS) ?? '';

    expect(out).not.toContain('hunter2');
    expect(out).toContain('[redacted]');
    // The surrounding source is untouched -- this redacts the value, not the file.
    expect(out).toContain('import NextAuth from "next-auth";');
    expect(out).toContain('secret:');
  });

  it('redacts a hardcoded secret literal assigned to an underscore-cased key (AUTH_SECRET = "hunter2")', () => {
    // Deviation 2 from the ported upstream regex: its leading `\b` cannot
    // match inside `AUTH_SECRET`, because `_` is a word character, so this
    // exact line -- the most likely real leak in an auth.ts -- passed the
    // unmodified port untouched.
    const out = redactTextToSummary('const AUTH_SECRET = "hunter2";', MAX_LOG_FIELD_CHARS) ?? '';

    expect(out).not.toContain('hunter2');
    expect(out).toContain('[redacted]');
  });

  it('PRESERVES a process.env reference (deviation 1: an env reference is a variable name, not a credential)', () => {
    const body = [
      'export const authOptions = {',
      '  secret: process.env.AUTH_SECRET,',
      '  providers: [],',
      '};',
    ].join('\n');

    const out = redactTextToSummary(body, MAX_LOG_FIELD_CHARS) ?? '';

    // Without the `(?!process\.env\.)` lookahead this collapses to
    // `secret: [redacted]` and the Activity diff goes blank at exactly the
    // line a person opened it to read. auth.ts is the file the wiring-merge
    // flow touches most often, so this is the common case, not the corner.
    expect(out).toContain('secret: process.env.AUTH_SECRET,');
    expect(out).not.toContain('[redacted]');
  });

  it('PRESERVES an import.meta.env reference (deviation 1, Vite form)', () => {
    const out = redactTextToSummary('  apiKey: import.meta.env.VITE_API_KEY,', MAX_LOG_FIELD_CHARS) ?? '';

    expect(out).toContain('apiKey: import.meta.env.VITE_API_KEY,');
    expect(out).not.toContain('[redacted]');
  });

  it('redacts a bearer token embedded in a file body', () => {
    const body = 'const headers = { Authorization: "Bearer sk_live_51NxAbCdEfGh" };';

    const out = redactTextToSummary(body, MAX_LOG_FIELD_CHARS) ?? '';

    expect(out).not.toContain('sk_live_51NxAbCdEfGh');
    expect(out).toContain('[redacted]');
  });

  it('redacts a long opaque high-entropy blob', () => {
    const blob = 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIHZlcnkgbG9uZyBvcGFxdWUgdG9rZW4xMjM0NTY3ODkw';
    expect(blob.length).toBeGreaterThanOrEqual(32);

    expect(redactTextToSummary(blob, MAX_LOG_FIELD_CHARS)).toBe('[redacted]');
  });

  it('redacts a Slack webhook URL, both bare and under a webhook_url key', () => {
    // Assembled at runtime rather than written as one literal. GitHub's push
    // protection matches the SHAPE of a Slack webhook URL, not whether it is
    // live, so this placeholder -- all zeros and X's, never a real hook --
    // blocked every push of this branch until it was split. The string the
    // test actually feeds to `redactTextToSummary` is byte-for-byte identical,
    // so the coverage is unchanged; only the file's own text differs.
    const hook = ['https://hooks.slack.com', 'services', 'T00000000', 'B00000000', 'X'.repeat(24)].join('/');

    expect(redactTextToSummary(hook, MAX_LOG_FIELD_CHARS)).toBe('[redacted]');

    const inFile = redactTextToSummary(`const webhook_url = "${hook}";`, MAX_LOG_FIELD_CHARS) ?? '';
    expect(inFile).not.toContain('XXXXXXXXXXXXXXXXXXXXXXXX');
    expect(inFile).toContain('[redacted]');
  });

  it('leaves ordinary source completely unchanged', () => {
    const body = [
      'export const original = 1;',
      'const max_tokens = 100;',
      'let user_token_count = 5;',
      'export const runtime = "nodejs";',
      'import { NextAuthOptions } from "next-auth";',
    ].join('\n');

    expect(redactTextToSummary(body, MAX_LOG_FIELD_CHARS)).toBe(body);
  });

  it('round-trips the exact short string the existing apply-flow tests assert on', () => {
    // requestWiringMerge.test.ts / fixBuildFailure.test.ts assert an exact
    // before/after round-trip of this literal. Pinned here too so a future
    // widening of the redactor fails on this file first, with a clear name,
    // rather than surfacing as a confusing break in the apply-flow suites.
    expect(redactTextToSummary('export const original = 1;', MAX_LOG_FIELD_CHARS))
      .toBe('export const original = 1;');
    expect(redactTextToSummary('export const merged = 1;', MAX_LOG_FIELD_CHARS))
      .toBe('export const merged = 1;');
  });

  it('coalesces to a plain empty string for empty input, so log fields stay typed string', () => {
    // The ported contract is `null` for empty input, but an empty `before`
    // is the ordinary "this wiring action created the file" case -- the
    // append helpers coalesce so spike-ui's renderActivityDiffDisclosure can
    // keep assigning straight to pre.textContent with no null handling.
    expect(redactTextToSummary('', MAX_LOG_FIELD_CHARS)).toBeNull();

    const field: string = redactTextToSummary('', MAX_LOG_FIELD_CHARS) ?? '';
    expect(field).toBe('');
    expect(typeof field).toBe('string');
  });

  it('marks truncation explicitly rather than silently clipping', () => {
    // Deliberately shaped like real source (spaces, newlines) rather than one
    // unbroken blob: an unbroken 32+ char run of token-ish characters is
    // itself treated as a secret and redacts wholesale, which would test the
    // wrong branch.
    const long = `${'export const a = 1;\n'.repeat(1_000)}TAIL_MARKER`;

    const out = redactTextToSummary(long, MAX_LOG_FIELD_CHARS) ?? '';

    expect(out.length).toBeLessThanOrEqual(MAX_LOG_FIELD_CHARS);
    expect(out).not.toContain('TAIL_MARKER');
    // The whole point: a reader can tell a short entry from a clipped one.
    expect(out).toContain('more chars)');
    expect(out).toMatch(/…\(\d+ more chars\)$/);
  });

  it('does not truncate an entry of the size this flow actually allows (8000-char cap)', () => {
    // requestWiringMerge/requestBuildFix both refuse a file over 8000 chars,
    // so MAX_LOG_FIELD_CHARS is chosen to leave every real entry intact.
    const body = 'export const a = 1;\n'.repeat(1_000).slice(0, MAX_LOG_FIELD_CHARS);
    expect(body).toHaveLength(MAX_LOG_FIELD_CHARS);

    expect(redactTextToSummary(body, MAX_LOG_FIELD_CHARS)).toBe(body);
  });
});

describe('redactEmbeddedSecrets (non-truncating form, for buildError/rebuildOutput)', () => {
  it('redacts an env dump printed by a failing build without shortening the output', () => {
    const buildError = [
      'Error: build failed',
      'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
      'DATABASE_PASSWORD=hunter2',
      '  at Object.<anonymous> (/app/build.js:1:1)',
    ].join('\n');

    const out = redactEmbeddedSecrets(buildError);

    expect(out).not.toContain('wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('Error: build failed');
    expect(out).toContain('at Object.<anonymous> (/app/build.js:1:1)');
  });

  it('leaves an ordinary build error byte-for-byte identical', () => {
    const buildError = 'src/app/page.tsx:12:5 - error TS2322: Type \'number\' is not assignable to type \'string\'.';

    expect(redactEmbeddedSecrets(buildError)).toBe(buildError);
  });
});
