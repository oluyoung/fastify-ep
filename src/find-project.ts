import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { detectWorkspace, type Workspace } from './detect-workspace.js';

const MANIFEST = '.fastify-ep.json';

/** Written into every library so tools can tell it from a service (`.fastify-ep.json`). */
export const LIBRARY_MARKER = '.fastify-ep-library.json';

/** A fastify-ep service (has a manifest) or a shared library (has the library marker). */
export type ProjectKind = 'service' | 'library';

/** What the directory is, or undefined when it is neither. A manifest wins over a marker. */
export function projectKindAt(dir: string): ProjectKind | undefined {
  if (existsSync(join(dir, MANIFEST))) return 'service';
  if (existsSync(join(dir, LIBRARY_MARKER))) return 'library';
  return undefined;
}

const SCAN_MAX_DEPTH = 5;
const SCAN_MAX_RESULTS = 20;
const SCAN_SKIPPED = new Set(['node_modules', 'dist']);

export type ProjectResolution = { root: string; kind: ProjectKind } | { error: string };

/** The directories under the workspace root that hold `marker`, relative to it. A bounded scan. */
function findMarked(workspace: Workspace, marker: string): string[] {
  const found: string[] = [];

  const visit = (dir: string, depth: number): void => {
    if (found.length >= SCAN_MAX_RESULTS) return;
    if (existsSync(join(dir, marker))) {
      found.push(relative(workspace.root, dir).split(sep).join('/') || '.');
      return;
    }
    if (depth >= SCAN_MAX_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SCAN_SKIPPED.has(entry.name)) {
        continue;
      }
      visit(join(dir, entry.name), depth + 1);
    }
  };

  visit(workspace.root, 0);
  return found;
}

/**
 * The fastify-ep services under a workspace root, as paths relative to it. The scan does not read
 * workspace globs, so it also lists a service the globs do not cover yet.
 */
export function findWorkspaceProjects(workspace: Workspace): string[] {
  return findMarked(workspace, MANIFEST);
}

/** The shared libraries (`generate library`) under a workspace root, relative to it. */
export function findWorkspaceLibraries(workspace: Workspace): string[] {
  return findMarked(workspace, LIBRARY_MARKER);
}

function notFoundInWorkspace(cwd: string, workspace: Workspace): string {
  const projects = findWorkspaceProjects(workspace);
  const libraries = findWorkspaceLibraries(workspace);
  const where = `no ${MANIFEST} found in "${cwd}" or its parents up to the workspace root "${workspace.root}".`;
  const list = (paths: string[]) => paths.map((path) => `  ${path}`).join('\n');
  const libraryList =
    libraries.length > 0
      ? `\nShared libraries (doctor can check them, generate cannot):\n${list(libraries)}`
      : '';
  if (projects.length === 0) {
    return (
      `${where} No fastify-ep services found in this workspace. Create one with ` +
      `"fastify-ep init apps/<name>".${libraryList}`
    );
  }
  return (
    `${where} Services in this workspace:\n${list(projects)}${libraryList}\n` +
    `Run this from one of them, or pass --project <dir> (for example --project ${projects[0]}).`
  );
}

/**
 * Where a command should run. With `project`, exactly that directory, which must hold a manifest or
 * a library marker. Without it, inside a workspace the nearest one from `cwd` up to the workspace
 * root; outside a workspace `cwd` itself, so the generators report a missing manifest as they
 * always have.
 */
export function resolveProject(cwd: string, project?: string): ProjectResolution {
  if (project !== undefined) {
    const root = resolve(cwd, project);
    const kind = projectKindAt(root);
    if (!kind) {
      return {
        error: `"${root}" is not a fastify-ep project (no ${MANIFEST} or ${LIBRARY_MARKER} found there).`,
      };
    }
    return { root, kind };
  }

  const workspace = detectWorkspace(cwd);
  if (!workspace) return { root: cwd, kind: projectKindAt(cwd) ?? 'service' };

  for (let dir = cwd; ; dir = dirname(dir)) {
    const kind = projectKindAt(dir);
    if (kind) return { root: dir, kind };
    if (dir === workspace.root || dirname(dir) === dir) break;
  }
  return { error: notFoundInWorkspace(cwd, workspace) };
}
