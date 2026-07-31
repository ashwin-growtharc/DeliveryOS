import { describe, expect, it } from 'vitest';
import { bumpVersion } from '../../src/engine/manifest/version';

describe('bumpVersion', () => {
  it('bumps patch, leaving major/minor untouched', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
  });

  it('bumps minor and resets patch to 0', () => {
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
  });

  it('bumps major and resets minor+patch to 0', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
  });

  it('throws on a malformed version string rather than silently guessing', () => {
    expect(() => bumpVersion('1.2', 'patch')).toThrow(/not a valid x\.y\.z/);
    expect(() => bumpVersion('v1.2.3', 'patch')).toThrow(/not a valid x\.y\.z/);
  });
});
