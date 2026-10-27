import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { detectWorkspace, type Workspace } from './detect-workspace.js';

const MANIFEST = '.fastify-ep.json';

const SCAN_MAX_DEPTH = 5;
const SCAN_MAX_RESULTS = 20;
const SCAN_SKIPPED = new Set(['node_modules', 'dist']);

export type ProjectResolution = { root: string } | { error: string };

/**
 * The fastify-ep projects under a workspace root, as paths relative to it. A bounded scan: it does
 * not read workspace globs, so it also lists a project the globs do not cover yet.
 */
export function findWorkspaceProjects(workspace: Workspace): string[] {
  const found: string[] = [];

  const visit = (dir: string, depth: number): void => {
    if (found.length >= SCAN_MAX_RESULTS) return;
    if (existsSync(join(dir, MANIFEST))) {
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

function notFoundInWorkspace(cwd: string, workspace: Workspace): string {
  const projects = findWorkspaceProjects(workspace);
  const where = `no ${MANIFEST} found in "${cwd}" or its parents up to the workspace root "${workspace.root}".`;
  if (projects.length === 0) {
    return `${where} No fastify-ep services found in this workspace. Create one with "fastify-ep init apps/<name>".`;
  }
  return (
    `${where} Services in this workspace:\n` +
    projects.map((path) => `  ${path}`).join('\n') +
    `\nRun this from one of them, or pass --project <dir> (for example --project ${projects[0]}).`
  );
}

/**
 * Where a command should run. With `project`, exactly that directory, which must hold a manifest.
 * Without it, inside a workspace the nearest project from `cwd` up to the workspace root; outside a
 * workspace `cwd` itself, so the generators report a missing manifest as they always have.
 */
export function resolveProject(cwd: string, project?: string): ProjectResolution {
  if (project !== undefined) {
    const root = resolve(cwd, project);
    if (!existsSync(join(root, MANIFEST))) {
      return {
        error: `"${root}" is not a fastify-ep project (no ${MANIFEST} found there).`,
      };
    }
    return { root };
  }

  const workspace = detectWorkspace(cwd);
  if (!workspace) return { root: cwd };

  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, MANIFEST))) return { root: dir };
    if (dir === workspace.root || dirname(dir) === dir) break;
  }
  return { error: notFoundInWorkspace(cwd, workspace) };
}
