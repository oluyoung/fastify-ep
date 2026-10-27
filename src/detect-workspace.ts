import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { PACKAGE_MANAGERS, type PackageManager } from './package-manager.js';

/** Build tools recognised on top of a workspace. They are reported, never edited. */
export const WORKSPACE_TOOLS = ['turbo', 'nx'] as const;
export type WorkspaceTool = (typeof WORKSPACE_TOOLS)[number];

const TOOL_FILES: Record<WorkspaceTool, string> = { turbo: 'turbo.json', nx: 'nx.json' };

export interface Workspace {
  /** The directory holding the workspace marker. */
  root: string;
  /** The package manager that owns the workspace. */
  packageManager: PackageManager;
  /** The workspace's package globs, as written (negated globs such as `!apps/legacy` included). */
  globs: string[];
  tools: WorkspaceTool[];
  /** Yarn workspaces only; undefined when it cannot be told (no `packageManager`, `.yarnrc.yml` or lockfile). */
  yarn?: 'classic' | 'berry';
}

/** Reads a YAML block or flow list under a top-level `packages:` key. Undefined when the key is absent. */
function parsePnpmPackages(yaml: string): string[] | undefined {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => /^packages\s*:/.test(line));
  if (start === -1) return undefined;

  const unquote = (item: string) => item.trim().replace(/^(['"])(.*)\1$/, '$2');
  const inline = /^packages\s*:\s*\[(.*)\]\s*(#.*)?$/.exec(lines[start]);
  if (inline) {
    return inline[1].split(',').map(unquote).filter(Boolean);
  }

  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const item = /^\s*-\s+(.*?)\s*$/.exec(line);
    if (!item) break;
    const value = unquote(item[1].replace(/\s+#.*$/, ''));
    if (value) globs.push(value);
  }
  return globs;
}

function readPackageJson(dir: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** `workspaces` is an array of globs, or `{ packages: [...] }` in Yarn. */
function workspacesField(pkg: Record<string, unknown>): string[] | undefined {
  const field = pkg.workspaces;
  const list = Array.isArray(field)
    ? field
    : typeof field === 'object' && field !== null
      ? (field as { packages?: unknown }).packages
      : undefined;
  return Array.isArray(list) ? list.filter((g): g is string => typeof g === 'string') : undefined;
}

/** The root `packageManager` field (`yarn@4.1.0`), then the lockfile, then npm. */
function npmOrYarn(dir: string, pkg: Record<string, unknown>): PackageManager {
  const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : '';
  const fromField = PACKAGE_MANAGERS.find((pm) => pm === declared);
  if (fromField) return fromField;
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/** Yarn 1 is "classic"; 2 and later are "Berry". From the `packageManager` field, `.yarnrc.yml`, then `yarn.lock`. */
function yarnFlavor(dir: string, pkg: Record<string, unknown>): Workspace['yarn'] {
  const declared =
    typeof pkg.packageManager === 'string' ? /^yarn@(\d+)/.exec(pkg.packageManager) : null;
  if (declared) return Number(declared[1]) >= 2 ? 'berry' : 'classic';
  if (existsSync(join(dir, '.yarnrc.yml'))) return 'berry';
  try {
    const lock = readFileSync(join(dir, 'yarn.lock'), 'utf8');
    if (lock.includes('__metadata:')) return 'berry';
    if (lock.includes('yarn lockfile v1')) return 'classic';
  } catch {
    // no lockfile yet
  }
  return undefined;
}

function detectAt(dir: string): Omit<Workspace, 'tools'> | undefined {
  // A pnpm project scaffolded by fastify-ep has a `pnpm-workspace.yaml` with only `allowBuilds`.
  // Without a `packages:` list it is a single project, not a workspace.
  const pnpmFile = join(dir, 'pnpm-workspace.yaml');
  if (existsSync(pnpmFile)) {
    const globs = parsePnpmPackages(readFileSync(pnpmFile, 'utf8'));
    if (globs) return { root: dir, packageManager: 'pnpm', globs };
  }

  const pkg = readPackageJson(dir);
  const globs = pkg && workspacesField(pkg);
  if (pkg && globs) {
    const packageManager = npmOrYarn(dir, pkg);
    const yarn = packageManager === 'yarn' ? yarnFlavor(dir, pkg) : undefined;
    return { root: dir, packageManager, globs, ...(yarn ? { yarn } : {}) };
  }
  return undefined;
}

/**
 * Walks `startDir` and its ancestors for the nearest workspace root: a `pnpm-workspace.yaml`
 * with a `packages:` list, or a `package.json` with `workspaces` (npm or Yarn). Turborepo and Nx
 * markers in the same directory are reported in `tools`. Returns `undefined` outside a workspace.
 * `startDir` need not exist yet, so this works for an `init` target that is not created.
 */
export function detectWorkspace(startDir: string): Workspace | undefined {
  let dir = startDir;
  for (;;) {
    const found = detectAt(dir);
    if (found) {
      const tools = WORKSPACE_TOOLS.filter((tool) => existsSync(join(dir, TOOL_FILES[tool])));
      return { ...found, tools };
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function globToRegExp(glob: string): RegExp {
  const pattern = glob.replace(/^\.\//, '').replace(/\/+$/, '');
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      // `**/` spans zero or more directories; a trailing `**` spans everything below.
      if (pattern[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Whether `targetDir` is one of the workspace's packages: it matches a package glob and no `!`
 * glob. Supports `*`, `**` and `?`; brace expansion is not supported.
 */
export function matchesWorkspaceGlobs(workspace: Workspace, targetDir: string): boolean {
  const rel = relative(workspace.root, targetDir).split(sep).join('/');
  if (rel === '' || rel.startsWith('..')) return false;
  const included = workspace.globs.filter((glob) => !glob.startsWith('!'));
  const excluded = workspace.globs.filter((glob) => glob.startsWith('!')).map((g) => g.slice(1));
  const matches = (glob: string) => globToRegExp(glob).test(rel);
  return included.some(matches) && !excluded.some(matches);
}
