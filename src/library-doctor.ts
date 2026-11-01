import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import validateNpmPackageName from 'validate-npm-package-name';
import { detectWorkspace, matchesWorkspaceGlobs } from './detect-workspace.js';
import type { DoctorCheck } from './doctor.js';
import { LIBRARY_MARKER } from './find-project.js';
import { unmatchedGlobNote } from './workspace-notes.js';

const REQUIRED_SCRIPTS = ['build', 'typecheck'];

function check(name: string, failure: string | undefined): DoctorCheck {
  return {
    group: 'Libraries',
    severity: 'error',
    name,
    pass: failure === undefined,
    detail: failure,
  };
}

function readJson(path: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) as unknown };
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
    return { error: missing ? `"${path}" not found.` : `"${path}" is not valid JSON.` };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function markerFailure(dir: string): string | undefined {
  const { value, error } = readJson(join(dir, LIBRARY_MARKER));
  if (error) return error;
  if (!isRecord(value)) return `${LIBRARY_MARKER} must be a JSON object.`;
  if (value.schemaVersion !== 1) return `${LIBRARY_MARKER}: "schemaVersion" must be 1.`;
  if (value.kind !== 'library') return `${LIBRARY_MARKER}: "kind" must be "library".`;
  if (typeof value.fastifyEpVersion !== 'string') {
    return `${LIBRARY_MARKER}: "fastifyEpVersion" must be a string.`;
  }
  return undefined;
}

/** Every file path an `exports` value points at, however deeply it is nested in conditions. */
function exportTargets(exports: unknown): string[] {
  if (typeof exports === 'string') return [exports];
  if (Array.isArray(exports)) return exports.flatMap(exportTargets);
  if (isRecord(exports)) return Object.values(exports).flatMap(exportTargets);
  return [];
}

function exportsFailure(pkg: Record<string, unknown>): string | undefined {
  if (pkg.exports === undefined) {
    return '"exports" is missing from package.json; services import the library through it.';
  }
  const outside = exportTargets(pkg.exports).filter(
    (target) => target !== './package.json' && !target.startsWith('./dist/'),
  );
  return outside.length === 0
    ? undefined
    : `"exports" points outside dist: ${outside.join(', ')}. Services use the built output.`;
}

function filesFailure(pkg: Record<string, unknown>): string | undefined {
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  return files.some((f) => typeof f === 'string' && /^\.?\/?dist\/?$/.test(f))
    ? undefined
    : '"files" in package.json does not include "dist".';
}

function scriptsFailure(pkg: Record<string, unknown>): string | undefined {
  const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
  const missing = REQUIRED_SCRIPTS.filter((name) => typeof scripts[name] !== 'string');
  return missing.length === 0
    ? undefined
    : `missing from "scripts" in package.json: ${missing.join(', ')}.`;
}

function nameFailure(pkg: Record<string, unknown>): string | undefined {
  if (typeof pkg.name !== 'string') return '"name" is missing from package.json.';
  const result = validateNpmPackageName(pkg.name);
  if (result.validForNewPackages) return undefined;
  const reason = [...(result.errors ?? []), ...(result.warnings ?? [])][0] ?? 'invalid';
  return `"${pkg.name}" is not a valid package name (${reason}).`;
}

function workspaceFailure(dir: string): string | undefined {
  const workspace = detectWorkspace(dir);
  if (!workspace) {
    return 'not inside a workspace; libraries are shared packages of a pnpm, npm or Yarn workspace.';
  }
  if (matchesWorkspaceGlobs(workspace, dir)) return undefined;
  return unmatchedGlobNote(workspace, dir);
}

/** The checks for a shared library (`generate library`) at `dir`; every failure is an error. */
export function runLibraryChecks(dir: string): DoctorCheck[] {
  const checks = [check('library marker valid', markerFailure(dir))];

  const { value: pkg, error } = readJson(join(dir, 'package.json'));
  if (error || !isRecord(pkg)) {
    checks.push(check('package.json readable', error ?? '"package.json" must be a JSON object.'));
  } else {
    checks.push(
      check('package name valid', nameFailure(pkg)),
      check(
        'package is an ES module',
        pkg.type === 'module' ? undefined : '"type" must be "module" in package.json.',
      ),
      check('exports point at dist', exportsFailure(pkg)),
      check('files include dist', filesFailure(pkg)),
      check('build and typecheck scripts present', scriptsFailure(pkg)),
    );
  }

  checks.push(check('library is a workspace package', workspaceFailure(dir)));
  return checks;
}
