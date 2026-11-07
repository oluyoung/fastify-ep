import { describe, expect, it } from 'vitest';
import { compareVersions, isVersion } from './version.js';

describe('compareVersions', () => {
  it.each([
    ['0.6.0', '0.6.1', -1],
    ['0.9.0', '0.9.0', 0],
    ['0.10.0', '0.9.0', 1],
    ['1.0.0', '0.99.99', 1],
  ])('%s vs %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });

  it('sorts a pre-release before its release and ignores build metadata', () => {
    expect(compareVersions('0.9.0-beta.1', '0.9.0')).toBeLessThan(0);
    expect(compareVersions('0.9.0+build', '0.9.0')).toBe(0);
  });

  it('throws for something that is not a version', () => {
    expect(() => compareVersions('latest', '0.9.0')).toThrow();
  });
});

describe('isVersion', () => {
  it('accepts x.y.z and rejects the rest', () => {
    expect(isVersion('0.8.0')).toBe(true);
    expect(isVersion('0.8')).toBe(false);
    expect(isVersion('v0.8.0')).toBe(false);
  });
});
