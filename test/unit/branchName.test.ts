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
});
