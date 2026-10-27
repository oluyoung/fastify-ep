export type ValidateNameResult = { valid: true } | { valid: false; reason: string };

const MAX_NAME_LENGTH = 64;
const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Validates the `<name>` argument of a generator. The name becomes a directory under
 * `src/modules/` and the source of every generated identifier, so it must be lowercase
 * kebab-case: that rules out path traversal, and keeps `a-b` and `a_b` from collapsing
 * to the same identifier.
 */
export function validateName(name: string): ValidateNameResult {
  if (name.length === 0) {
    return { valid: false, reason: 'name must not be empty' };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { valid: false, reason: `name must be at most ${MAX_NAME_LENGTH} characters` };
  }
  if (!KEBAB_CASE.test(name)) {
    return {
      valid: false,
      reason:
        'name must be lowercase kebab-case: start with a letter, then letters, digits and single hyphens (e.g. "user-profiles")',
    };
  }
  return { valid: true };
}
