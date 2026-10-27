import { describe, expect, it } from 'vitest';
import { singularize, toCamelCase, toPascalCase } from './case.js';

describe('toCamelCase / toPascalCase', () => {
  it('converts kebab-case names', () => {
    expect(toCamelCase('user-profiles')).toBe('userProfiles');
    expect(toPascalCase('user-profiles')).toBe('UserProfiles');
  });

  it('returns an empty string when there are no words', () => {
    expect(toCamelCase('--')).toBe('');
    expect(toPascalCase('--')).toBe('');
  });
});

describe('singularize', () => {
  it.each([
    ['users', 'user'],
    ['orders', 'order'],
    ['user-profiles', 'user-profile'],
    ['categories', 'category'],
    ['addresses', 'address'],
    ['boxes', 'box'],
    ['batches', 'batch'],
    ['dishes', 'dish'],
  ])('%s -> %s', (plural, singular) => {
    expect(singularize(plural)).toBe(singular);
  });

  it.each(['address', 'health', 'user'])('leaves "%s" unchanged', (name) => {
    expect(singularize(name)).toBe(name);
  });

  it('never returns an empty string', () => {
    expect(singularize('s')).toBe('s');
  });
});
