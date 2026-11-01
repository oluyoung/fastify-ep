import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectWorkspace } from './detect-workspace.js';
import {
  findWorkspaceLibraries,
  findWorkspaceProjects,
  projectKindAt,
  resolveProject,
} from './find-project.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fastify-ep-find-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function dir(...parts: string[]): string {
  const path = join(root, ...parts);
  mkdirSync(path, { recursive: true });
  return path;
}

function project(...parts: string[]): string {
  const path = dir(...parts);
  writeFileSync(join(path, '.fastify-ep.json'), '{}\n');
  return path;
}

function workspace(): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
}

describe('resolveProject in a workspace', () => {
  beforeEach(workspace);

  it('uses the current directory when it is a project', () => {
    const users = project('apps', 'users-api');
    expect(resolveProject(users)).toEqual({ root: users, kind: 'service' });
  });

  it('walks up from a subfolder to the nearest project', () => {
    const users = project('apps', 'users-api');
    const nested = dir('apps', 'users-api', 'src', 'modules');
    expect(resolveProject(nested)).toEqual({ root: users, kind: 'service' });
  });

  it('prefers the nearest manifest when projects are nested', () => {
    project('apps', 'outer');
    const inner = project('apps', 'outer', 'examples', 'inner');
    expect(resolveProject(join(inner, 'src'))).toEqual({ root: inner, kind: 'service' });
  });

  it('accepts a project at the workspace root itself', () => {
    writeFileSync(join(root, '.fastify-ep.json'), '{}\n');
    expect(resolveProject(dir('src'))).toEqual({ root, kind: 'service' });
  });

  it('lists the services and suggests --project from the workspace root', () => {
    project('apps', 'users-api');
    project('apps', 'billing-api');
    const result = resolveProject(root);
    expect(result).toHaveProperty('error');
    const { error } = result as { error: string };
    expect(error).toContain('apps/billing-api');
    expect(error).toContain('apps/users-api');
    expect(error).toContain('--project apps/billing-api');
  });

  it('suggests init when the workspace has no services', () => {
    const result = resolveProject(dir('apps'));
    expect((result as { error: string }).error).toContain('fastify-ep init apps/<name>');
  });

  it('does not walk above the workspace root', () => {
    // A project above the workspace must not be picked up.
    const outer = mkdtempSync(join(tmpdir(), 'fastify-ep-find-outer-'));
    try {
      writeFileSync(join(outer, '.fastify-ep.json'), '{}\n');
      const inner = join(outer, 'repo');
      mkdirSync(join(inner, 'apps'), { recursive: true });
      writeFileSync(join(inner, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
      expect(resolveProject(join(inner, 'apps'))).toHaveProperty('error');
    } finally {
      rmSync(outer, { recursive: true, force: true });
    }
  });
});

describe('resolveProject with --project', () => {
  it('resolves a directory relative to cwd and requires a manifest', () => {
    workspace();
    const billing = project('apps', 'billing-api');
    expect(resolveProject(root, 'apps/billing-api')).toEqual({ root: billing, kind: 'service' });
    expect(resolveProject(dir('apps', 'users-api', 'src'), '../../billing-api')).toEqual({
      root: billing,
      kind: 'service',
    });
  });

  it('errors for a directory without a manifest, and for one that does not exist', () => {
    dir('apps', 'empty');
    expect(resolveProject(root, 'apps/empty')).toHaveProperty('error');
    expect(resolveProject(root, 'apps/missing')).toHaveProperty('error');
    expect((resolveProject(root, 'apps/empty') as { error: string }).error).toContain(
      'is not a fastify-ep project',
    );
  });

  it('does not walk up, even from inside a project', () => {
    const users = project('apps', 'users-api');
    expect(resolveProject(join(users, 'src'), '.')).toHaveProperty('error');
  });

  it('works outside a workspace', () => {
    const app = project('app');
    expect(resolveProject(root, 'app')).toEqual({ root: app, kind: 'service' });
  });
});

describe('resolveProject outside a workspace', () => {
  it('returns cwd unchanged, with or without a manifest, and never walks up', () => {
    const app = project('app');
    expect(resolveProject(app)).toEqual({ root: app, kind: 'service' });
    const sub = dir('app', 'src');
    expect(resolveProject(sub)).toEqual({ root: sub, kind: 'service' });
    expect(resolveProject(dir('empty'))).toEqual({ root: join(root, 'empty'), kind: 'service' });
  });
});

describe('findWorkspaceProjects', () => {
  beforeEach(workspace);
  const find = () => findWorkspaceProjects(detectWorkspace(root)!);

  it('finds projects sorted by path, including ones the globs do not cover', () => {
    project('services', 'zeta');
    project('apps', 'alpha');
    expect(find()).toEqual(['apps/alpha', 'services/zeta']);
  });

  it('skips node_modules, dist and hidden directories', () => {
    project('node_modules', 'pkg');
    project('apps', 'svc', 'dist', 'copy');
    project('.cache', 'hidden');
    project('apps', 'real');
    expect(find()).toEqual(['apps/real']);
  });

  it('does not look inside a project for more projects', () => {
    project('apps', 'outer');
    project('apps', 'outer', 'examples', 'inner');
    expect(find()).toEqual(['apps/outer']);
  });

  it('stops at a depth limit and a result limit', () => {
    project('a', 'b', 'c', 'd', 'e', 'f', 'too-deep');
    expect(find()).toEqual([]);
    for (let i = 0; i < 30; i++) project('apps', `svc-${String(i).padStart(2, '0')}`);
    expect(find()).toHaveLength(20);
  });
});

function library(...parts: string[]): string {
  const path = dir(...parts);
  writeFileSync(join(path, '.fastify-ep-library.json'), '{}\n');
  return path;
}

describe('libraries', () => {
  beforeEach(() => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ workspaces: ['apps/*', 'packages/*'] }),
    );
  });

  it('tells a service from a library, and a manifest wins over a marker', () => {
    const users = project('apps', 'users-api');
    const contracts = library('packages', 'contracts');
    const both = project('apps', 'both');
    writeFileSync(join(both, '.fastify-ep-library.json'), '{}\n');
    expect(projectKindAt(users)).toBe('service');
    expect(projectKindAt(contracts)).toBe('library');
    expect(projectKindAt(both)).toBe('service');
    expect(projectKindAt(dir('empty'))).toBeUndefined();
  });

  it('finds a library from inside it', () => {
    const contracts = library('packages', 'contracts');
    const nested = dir('packages', 'contracts', 'src');
    expect(resolveProject(contracts)).toEqual({ root: contracts, kind: 'library' });
    expect(resolveProject(nested)).toEqual({ root: contracts, kind: 'library' });
  });

  it('accepts a library for --project', () => {
    const contracts = library('packages', 'contracts');
    expect(resolveProject(root, 'packages/contracts')).toEqual({
      root: contracts,
      kind: 'library',
    });
  });

  it('rejects a --project directory that is neither', () => {
    dir('packages', 'plain');
    const result = resolveProject(root, 'packages/plain') as { error: string };
    expect(result.error).toContain('.fastify-ep.json');
    expect(result.error).toContain('.fastify-ep-library.json');
  });

  it('lists libraries in the workspace-root error, after the services', () => {
    project('apps', 'users-api');
    library('packages', 'contracts');
    const result = resolveProject(root) as { error: string };
    expect(result.error).toContain('apps/users-api');
    expect(result.error).toContain('Shared libraries');
    expect(result.error).toContain('packages/contracts');
    expect(result.error).toContain('--project apps/users-api');
  });

  it('still suggests creating a service when there are only libraries', () => {
    library('packages', 'contracts');
    const result = resolveProject(root) as { error: string };
    expect(result.error).toContain('fastify-ep init');
    expect(result.error).toContain('packages/contracts');
  });

  it('leaves out the library list when there are none', () => {
    project('apps', 'users-api');
    expect((resolveProject(root) as { error: string }).error).not.toContain('Shared libraries');
  });

  it('finds libraries by scan, skipping node_modules', () => {
    library('packages', 'b');
    library('packages', 'a');
    library('packages', 'a', 'node_modules', 'x');
    const workspace = detectWorkspace(root);
    expect(workspace && findWorkspaceLibraries(workspace)).toEqual(['packages/a', 'packages/b']);
  });

  it('keeps a library out of the service list', () => {
    project('apps', 'users-api');
    library('packages', 'contracts');
    const workspace = detectWorkspace(root);
    expect(workspace && findWorkspaceProjects(workspace)).toEqual(['apps/users-api']);
  });

  it('outside a workspace, a library marker in cwd still makes cwd a library', () => {
    rmSync(join(root, 'package.json'));
    const lib = library('lib');
    expect(resolveProject(lib)).toEqual({ root: lib, kind: 'library' });
  });
});
