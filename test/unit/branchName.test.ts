import { describe, expect, it } from 'vitest';
import { buildBranchName } from '../../src/engine/push/branchName';

describe('buildBranchName', () => {
  const fixedDate = new Date('2026-07-26T09:02:15.000Z');

  it('produces a valid, deterministic branch name for a plain slug id', () => {
    const name = buildBranchName('code-reviewer', fixedDate);
    expect(name).toMatch(/^deliveryos\/code-reviewer\/20260726090215-[0-9a-f]{4}$/);
  });

  it('sanitizes an id with spaces and mixed case into a valid git ref', () => {
    // The exact real-world input that crashed push with:
    // "fatal: 'deliveryos/GrowthArc-Brand Guidelines/...' is not a valid branch name"
    const name = buildBranchName('GrowthArc-Brand Guidelines', fixedDate);
    expect(name).toMatch(/^deliveryos\/growtharc-brand-guidelines\/20260726090215-[0-9a-f]{4}$/);
    expect(name).not.toMatch(/\s/);
  });

  it('collapses punctuation runs and trims leading/trailing separators', () => {
    // Underscore is a valid git ref character, so it's left alone --
    // only genuinely disallowed characters (spaces, `!`, leading `..`) get
    // collapsed/trimmed.
    const name = buildBranchName('  ..Weird__ID!!  ', fixedDate);
    expect(name.split('/')[1]).toBe('weird__id');
  });

  it('falls back to a hash-based slug for an id that strips to nothing, never producing an invalid double-slash ref', () => {
    // An id made entirely of characters slugifyForRef strips (all
    // punctuation, or e.g. emoji) used to collapse to "", producing
    // "deliveryos//<timestamp>-<hex>" -- an invalid git ref that failed
    // deep inside createBranch with a cryptic error instead of a clear one.
    const name = buildBranchName('???', fixedDate);
    expect(name).toMatch(/^deliveryos\/artifact-[0-9a-f]{8}\/20260726090215-[0-9a-f]{4}$/);
    expect(name).not.toMatch(/\/\//);
  });

  it('produces the same fallback slug for the same unslugifiable id every time (a function of the id, not random)', () => {
    const first = buildBranchName('???', fixedDate).split('/')[1];
    const second = buildBranchName('???', new Date('2026-08-01T00:00:00.000Z')).split('/')[1];
    expect(first).toBe(second);
  });
});
