import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import validateNpmPackageName from 'validate-npm-package-name';

export type ValidateInitResult = { valid: true } | { valid: false; reason: string };

/**
 * Validates the `init <name>` argument: both that `name` is a valid npm package
 * name, and that resolving it against `cwd` is safe to scaffold into (stays under
 * `cwd`, isn't a scoped name used as a directory, and isn't a non-empty directory).
 */
export function validateInit(name: string, cwd: string): ValidateInitResult {
  const nameResult = validateNpmPackageName(name);
  if (!nameResult.validForNewPackages) {
    const reason =
      [...(nameResult.errors ?? []), ...(nameResult.warnings ?? [])][0] ?? 'invalid package name';
    return { valid: false, reason };
  }

  // Only unscoped names create a directory
  if (name.startsWith('@')) {
    return {
      valid: false,
      reason: 'scoped package names (@scope/name) cannot be used as a directory name',
    };
  }

  const targetDir = resolve(cwd, name);
  const rel = relative(cwd, targetDir);
  if (targetDir !== cwd && (rel.startsWith('..') || isAbsolute(rel))) {
    return {
      valid: false,
      reason: 'target directory must stay within the current working directory',
    };
  }

  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    return { valid: false, reason: `target directory "${targetDir}" is not empty` };
  }

  return { valid: true };
}
