import { describe, expect, it } from 'vitest';
import { validateName } from './validate-name.js';

describe('validateName', () => {
  it.each(['users', 'user-profiles', 'v2', 'order-items-2'])('accepts "%s"', (name) => {
    expect(validateName(name)).toEqual({ valid: true });
  });

  it.each([
    ['empty', ''],
    ['uppercase', 'Users'],
    ['camelCase', 'userProfiles'],
    ['snake_case', 'user_profiles'],
    ['space', 'user profiles'],
    ['leading digit', '2fa'],
    ['leading hyphen', '-users'],
    ['trailing hyphen', 'users-'],
    ['double hyphen', 'user--profiles'],
    ['path traversal', '../x'],
    ['path separator', 'a/b'],
    ['dot', 'users.v2'],
  ])('rejects %s', (_label, name) => {
    expect(validateName(name).valid).toBe(false);
  });

  it('rejects a name over the length cap', () => {
    expect(validateName('a'.repeat(65)).valid).toBe(false);
    expect(validateName('a'.repeat(64))).toEqual({ valid: true });
  });

  it('explains why a name was rejected', () => {
    const result = validateName('../x');
    expect(result).toMatchObject({ valid: false });
    expect((result as { reason: string }).reason).toMatch(/kebab-case/);
  });
});
