import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import validateNpmPackageName from 'validate-npm-package-name';
import { toPascalCase } from './case.js';
import { detectWorkspace, type Workspace } from './detect-workspace.js';
import { findWorkspaceProjects } from './find-project.js';
import { renderTemplate } from './template-engine.js';
import { validateName } from './validate-name.js';
import { unmatchedGlobNote } from './workspace-notes.js';

const LIBRARY_TEMPLATE_DIR = fileURLToPath(new URL('../library-template', import.meta.url));

/** Written into every library so tools can tell it from a service (`.fastify-ep.json`). */
export const LIBRARY_MARKER = '.fastify-ep-library.json';

export class LibraryGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryGenerationError';
  }
}

export interface GenerateLibraryOptions {
  /** The directory the command runs in; the workspace is found from here. */
  cwd: string;
  /** Library name, lowercase kebab-case. */
  name: string;
  /** Package name when it should differ from the default (may be scoped). */
  packageName?: string;
  /** The library's directory, relative to `cwd`, overriding the workspace's `packages/*` convention. */
  dir?: string;
  cliVersion: string;
  libraryTemplateDir?: string;
}

export interface GenerateLibraryResult {
  targetDir: string;
  packageName: string;
  /** Follow-up steps and warnings for the user. */
  notes: string[];
}

/** `packages/*` or `libs/*` (any depth in front of it): where this workspace keeps libraries. */
function libraryParent(workspace: Workspace): string {
  for (const glob of workspace.globs) {
    const match = /^(?:\.\/)?((?:[\w.@-]+\/)*(?:packages|libs))\/\*$/.exec(glob);
    if (match) return match[1];
  }
  return 'packages';
}

function readPackageName(dir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown };
    return typeof pkg.name === 'string' ? pkg.name : undefined;
  } catch {
    return undefined;
  }
}

/** The scope (`@acme`) the workspace already uses: its root package, else its first scoped service. */
function workspaceScope(workspace: Workspace): string | undefined {
  const scopeOf = (name: string | undefined) =>
    name?.startsWith('@') ? name.split('/')[0] : undefined;
  const fromRoot = scopeOf(readPackageName(workspace.root));
  if (fromRoot) return fromRoot;
  for (const project of findWorkspaceProjects(workspace)) {
    const scope = scopeOf(readPackageName(join(workspace.root, project)));
    if (scope) return scope;
  }
  return undefined;
}

/** What a service puts in its `dependencies` to use the library. */
function dependencySpec(workspace: Workspace): string {
  const { packageManager, yarn } = workspace;
  if (packageManager === 'pnpm') return 'workspace:*';
  if (packageManager === 'yarn' && yarn === 'berry') return 'workspace:*';
  return '*';
}

function buildCommand(workspace: Workspace, packageName: string): string {
  switch (workspace.packageManager) {
    case 'pnpm':
      return `pnpm --filter ${packageName} build`;
    case 'yarn':
      return `yarn workspace ${packageName} build`;
    default:
      return `npm run build -w ${packageName}`;
  }
}

function copyTemplates(srcDir: string, destDir: string, vars: Record<string, string>): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) copyTemplates(src, dest, vars);
    else writeFileSync(dest, renderTemplate(readFileSync(src, 'utf8'), vars));
  }
}

/**
 * Generates a shared library package in the workspace around `cwd`. A library is a plain TypeScript
 * package, not a domain module: it has no manifest entry and is not registered in any app. The CLI
 * writes only the new directory and prints how to depend on it.
 */
export function generateLibrary({
  cwd,
  name,
  packageName,
  dir,
  cliVersion,
  libraryTemplateDir = LIBRARY_TEMPLATE_DIR,
}: GenerateLibraryOptions): GenerateLibraryResult {
  const nameResult = validateName(name);
  if (!nameResult.valid) {
    throw new LibraryGenerationError(`invalid library name "${name}": ${nameResult.reason}`);
  }

  const workspace = detectWorkspace(cwd);
  if (!workspace) {
    throw new LibraryGenerationError(
      `"${cwd}" is not inside a workspace (no pnpm-workspace.yaml with "packages:", and no ` +
        `package.json with "workspaces" in any parent directory). Libraries are shared packages ` +
        `inside a workspace.`,
    );
  }

  const targetDir =
    dir !== undefined ? resolve(cwd, dir) : join(workspace.root, libraryParent(workspace), name);
  const rel = relative(workspace.root, targetDir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new LibraryGenerationError(
      `the library directory "${targetDir}" must be inside the workspace root "${workspace.root}".`,
    );
  }
  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    throw new LibraryGenerationError(`target directory "${targetDir}" is not empty.`);
  }

  const scope = workspaceScope(workspace);
  const finalName = packageName ?? (scope ? `${scope}/${name}` : name);
  const nameCheck = validateNpmPackageName(finalName);
  if (!nameCheck.validForNewPackages) {
    const reason = [...(nameCheck.errors ?? []), ...(nameCheck.warnings ?? [])][0] ?? 'invalid';
    throw new LibraryGenerationError(`"${finalName}" is not a valid package name (${reason}).`);
  }

  const alreadyExisted = existsSync(targetDir);
  try {
    copyTemplates(libraryTemplateDir, targetDir, {
      packageName: finalName,
      libraryName: name,
      LibraryName: toPascalCase(name),
    });
    const marker = { schemaVersion: 1, kind: 'library', fastifyEpVersion: cliVersion };
    writeFileSync(join(targetDir, LIBRARY_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
  } catch (err) {
    if (!alreadyExisted) rmSync(targetDir, { recursive: true, force: true });
    throw err;
  }

  const pm = workspace.packageManager;
  const notes = [
    `To use it, add this to the "dependencies" of a service, then run "${pm} install" at the workspace root:\n\n  "${finalName}": "${dependencySpec(workspace)}"`,
    `Services import the library through its dist, so build it first: ${buildCommand(workspace, finalName)}`,
  ];
  const globNote = unmatchedGlobNote(workspace, targetDir);
  if (globNote) notes.unshift(globNote);

  return { targetDir, packageName: finalName, notes };
}
