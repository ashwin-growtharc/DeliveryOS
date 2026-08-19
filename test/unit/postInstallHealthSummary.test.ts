import { describe, it, expect } from 'vitest';
import { buildPostInstallHealthSummary } from '../../src/engine/pull/postInstallHealthSummary';
import { AutoWireResult } from '../../src/engine/pull/pullAndAutoWire';
import { BuildVerificationResult } from '../../src/engine/pull/verifyBuild';
import { Manifest } from '../../src/engine/manifest/schema';

function makeResult(opts: {
  applied?: string[];
  needsReview?: string[];
  build?: BuildVerificationResult;
  missingRequiredParams?: string[];
} = {}): AutoWireResult {
  return {
    pullResult: {
      manifest: {} as Manifest,
      remoteName: 'origin',
      installTarget: '/tmp/project',
      missingRequiredParams: opts.missingRequiredParams ?? [],
    },
    wiring: {
      applied: opts.applied ?? [],
      needsReview: opts.needsReview ?? [],
    },
    build: opts.build ?? { ran: false },
  };
}

describe('buildPostInstallHealthSummary (Phase 12: post-install health narrator)', () => {
  it('everything clean: applied wiring, build passes, no missing params -- says there is nothing else to do', () => {
    const summary = buildPostInstallHealthSummary(makeResult({
      applied: ['auth.ts', 'middleware.ts'],
      build: { ran: true, command: 'npm run build', success: true, output: 'ok' },
    }));

    expect(summary).toContain('applied automatically');
    expect(summary.toLowerCase()).toContain('build passes');
    expect(summary.toLowerCase()).toContain('nothing else to do');
    // Nothing to review or configure, so neither of those should be
    // dragged in here.
    expect(summary.toLowerCase()).not.toContain('review');
    expect(summary.toLowerCase()).not.toContain('missing');
  });

  it('build passed but required params still missing -- names the param keys explicitly', () => {
    const summary = buildPostInstallHealthSummary(makeResult({
      build: { ran: true, command: 'npm run build', success: true, output: 'ok' },
      missingRequiredParams: ['DATABASE_URL', 'SESSION_SECRET'],
    }));

    expect(summary.toLowerCase()).toContain('build passes');
    expect(summary).toContain('DATABASE_URL');
    expect(summary).toContain('SESSION_SECRET');
    expect(summary.toLowerCase()).toMatch(/before this feature actually works/);
  });

  it('build failed -- leads with the failure, includes an output excerpt, and still surfaces needsReview/missing params', () => {
    const summary = buildPostInstallHealthSummary(makeResult({
      needsReview: ['auth.ts'],
      missingRequiredParams: ['API_KEY'],
      build: {
        ran: true,
        command: 'npm run build',
        success: false,
        output: 'TypeError: Cannot find module "./missing"\n    at Object.<anonymous> (index.js:1:1)',
      },
    }));

    // Leads with the failure -- the very first sentence, not buried later.
    expect(summary.toLowerCase().startsWith('the build failed')).toBe(true);
    expect(summary).toContain('TypeError: Cannot find module "./missing"');
    // Still mentions the other real facts as additional context.
    expect(summary).toContain('auth.ts');
    expect(summary).toContain('API_KEY');
  });

  it('caps a huge build output excerpt rather than dumping it whole', () => {
    const hugeLine = 'x'.repeat(5000);
    const summary = buildPostInstallHealthSummary(makeResult({
      build: { ran: true, command: 'npm run build', success: false, output: hugeLine },
    }));

    expect(summary.length).toBeLessThan(500);
    expect(summary).toContain('...');
  });

  it('needs manual review with no build command detected -- names files and params, notes the missing build calmly (not as an error)', () => {
    const summary = buildPostInstallHealthSummary(makeResult({
      needsReview: ['auth.ts', 'middleware.ts'],
      missingRequiredParams: ['API_KEY'],
      build: { ran: false },
    }));

    expect(summary).toContain('auth.ts');
    expect(summary).toContain('middleware.ts');
    expect(summary).toContain('API_KEY');
    expect(summary.toLowerCase()).toContain('no build command was found');
    // Never phrased as an error/failure -- this is a normal, expected case.
    expect(summary.toLowerCase()).not.toContain('fail');
    expect(summary.toLowerCase()).not.toContain('error');
  });

  it('nothing applied, nothing to review, no missing params, build passed -- plain and brief', () => {
    const summary = buildPostInstallHealthSummary(makeResult({
      build: { ran: true, command: 'npm run build', success: true, output: 'ok' },
    }));

    expect(summary.toLowerCase()).toContain('build passes');
    expect(summary.toLowerCase()).toContain('nothing else to do');
    expect(summary.length).toBeLessThan(120);
  });

  it('nothing applied, nothing to review, no missing params, build did not run -- plain and brief, not an error', () => {
    const summary = buildPostInstallHealthSummary(makeResult());

    expect(summary.toLowerCase()).toContain('no build command was found');
    expect(summary.toLowerCase()).toContain('nothing else to do');
    expect(summary.toLowerCase()).not.toContain('fail');
  });

  it('edge case: wiring applied and needsReview both present, build did not run, no missing params', () => {
    const summary = buildPostInstallHealthSummary(makeResult({
      applied: ['a.ts'],
      needsReview: ['b.ts'],
      build: { ran: false },
    }));

    // Applied count is reported (file names aren't -- only needsReview
    // names specific files, since those are what a person must act on).
    expect(summary.toLowerCase()).toContain('applied automatically');
    expect(summary).toContain('b.ts');
    expect(summary.toLowerCase()).toContain('no build command was found');
    // Something still needs review, so this should NOT claim there's
    // nothing left to do.
    expect(summary.toLowerCase()).not.toContain('nothing else to do');
  });

  it('edge case: singular phrasing for exactly one needsReview file and one missing param', () => {
    const summary = buildPostInstallHealthSummary(makeResult({
      needsReview: ['auth.ts'],
      missingRequiredParams: ['API_KEY'],
      build: { ran: false },
    }));

    expect(summary).toMatch(/1 file still needs/);
    expect(summary).toContain('a real value is still needed for: API_KEY');
  });
});
