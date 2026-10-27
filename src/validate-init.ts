import { existsSync, readdirSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import validateNpmPackageName from 'validate-npm-package-name';

export type ValidateInitResult =
  { valid: true; targetDir: string; packageName: string } | { valid: false; reason: string };

/**
 * Validates the `init <target>` argument and works out where to scaffold and what to call the
 * package. `target` is a directory name or a path (`apps/payments-api`) resolved against `cwd`; it
 * must stay inside `cwd`, must not be `cwd` itself, and must not be a non-empty directory. The
 * package name is `packageName` (the `--name` option, which may be scoped) or else the last
 * segment of the path, and must be a valid npm package name.
 */
export function validateInit(
  target: string,
  cwd: string,
  packageName?: string,
): ValidateInitResult {
  // Only unscoped names create a directory
  if (target.startsWith('@')) {
    return {
      valid: false,
      reason:
        'scoped package names (@scope/name) cannot be used as a directory name; ' +
        'pass a directory and set the package name with --name',
    };
  }

  const targetDir = resolve(cwd, target);
  const rel = relative(cwd, targetDir);
  if (rel === '') {
    return {
      valid: false,
      reason:
        'choose a directory to create; scaffolding into the current directory is not supported',
    };
  }
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return {
      valid: false,
      reason: 'target directory must stay within the current working directory',
    };
  }

  const name = packageName ?? basename(targetDir);
  const nameResult = validateNpmPackageName(name);
  if (!nameResult.validForNewPackages) {
    const reason =
      [...(nameResult.errors ?? []), ...(nameResult.warnings ?? [])][0] ?? 'invalid package name';
    return {
      valid: false,
      reason:
        packageName === undefined
          ? `"${name}" is not a valid package name (${reason}); pass --name to set one`
          : `"${name}" is not a valid package name (${reason})`,
    };
  }

  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    return { valid: false, reason: `target directory "${targetDir}" is not empty` };
  }

  return { valid: true, targetDir, packageName: name };
}
