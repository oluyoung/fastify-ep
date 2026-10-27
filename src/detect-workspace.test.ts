import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectWorkspace, matchesWorkspaceGlobs, type Workspace } from './detect-workspace.js';

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function makeDir(): string {
  workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-ws-'));
  return workDir;
}

function write(dir: string, file: string, content: string): void {
  writeFileSync(join(dir, file), content);
}

describe('detectWorkspace', () => {
  it('returns undefined outside a workspace', () => {
    expect(detectWorkspace(makeDir())).toBeUndefined();
  });

  it('detects a pnpm workspace and reads its block-list globs', () => {
    const root = makeDir();
    write(
      root,
      'pnpm-workspace.yaml',
      [
        '# comment',
        'packages:',
        "  - 'apps/*'",
        '  - "packages/*" # shared',
        '  - "!apps/legacy"',
        '',
        'allowBuilds:',
        '  esbuild: true',
        '',
      ].join('\n'),
    );
    expect(detectWorkspace(root)).toEqual({
      root,
      packageManager: 'pnpm',
      globs: ['apps/*', 'packages/*', '!apps/legacy'],
      tools: [],
    });
  });

  it('reads a flow-style pnpm packages list', () => {
    const root = makeDir();
    write(root, 'pnpm-workspace.yaml', "packages: ['apps/*', packages/*]\n");
    expect(detectWorkspace(root)?.globs).toEqual(['apps/*', 'packages/*']);
  });

  it('does not treat a fastify-ep pnpm project (allowBuilds only) as a workspace', () => {
    const root = makeDir();
    write(root, 'pnpm-workspace.yaml', 'allowBuilds:\n  esbuild: true\n');
    expect(detectWorkspace(root)).toBeUndefined();
  });

  it('detects npm workspaces from package.json', () => {
    const root = makeDir();
    write(root, 'package.json', JSON.stringify({ name: 'repo', workspaces: ['apps/*'] }));
    expect(detectWorkspace(root)).toEqual({
      root,
      packageManager: 'npm',
      globs: ['apps/*'],
      tools: [],
    });
  });

  it('detects Yarn workspaces by yarn.lock, including the { packages } form', () => {
    const root = makeDir();
    write(root, 'package.json', JSON.stringify({ workspaces: { packages: ['services/*'] } }));
    write(root, 'yarn.lock', '');
    const found = detectWorkspace(root);
    expect(found?.packageManager).toBe('yarn');
    expect(found?.globs).toEqual(['services/*']);
  });

  it.each([
    ['yarn@4.1.0', 'berry'],
    ['yarn@2.4.3', 'berry'],
    ['yarn@1.22.22', 'classic'],
  ] as const)('tells Yarn classic from Berry by packageManager %s', (packageManager, flavor) => {
    const root = makeDir();
    write(root, 'package.json', JSON.stringify({ workspaces: ['apps/*'], packageManager }));
    expect(detectWorkspace(root)?.yarn).toBe(flavor);
  });

  it('tells Yarn Berry from classic by .yarnrc.yml, then by the lockfile header', () => {
    const berryRc = makeDir();
    write(berryRc, 'package.json', JSON.stringify({ workspaces: ['apps/*'] }));
    write(berryRc, 'yarn.lock', '');
    write(berryRc, '.yarnrc.yml', 'nodeLinker: node-modules\n');
    expect(detectWorkspace(berryRc)?.yarn).toBe('berry');
    rmSync(berryRc, { recursive: true, force: true });

    const berryLock = makeDir();
    write(berryLock, 'package.json', JSON.stringify({ workspaces: ['apps/*'] }));
    write(berryLock, 'yarn.lock', '__metadata:\n  version: 8\n');
    expect(detectWorkspace(berryLock)?.yarn).toBe('berry');
    rmSync(berryLock, { recursive: true, force: true });

    const classic = makeDir();
    write(classic, 'package.json', JSON.stringify({ workspaces: ['apps/*'] }));
    write(classic, 'yarn.lock', '# yarn lockfile v1\n');
    expect(detectWorkspace(classic)?.yarn).toBe('classic');
  });

  it('leaves the Yarn flavor undefined when nothing says, and for npm and pnpm', () => {
    const unknown = makeDir();
    write(
      unknown,
      'package.json',
      JSON.stringify({ workspaces: ['apps/*'], packageManager: 'yarn' }),
    );
    write(unknown, 'yarn.lock', '');
    expect(detectWorkspace(unknown)?.yarn).toBeUndefined();
    rmSync(unknown, { recursive: true, force: true });

    const npm = makeDir();
    write(npm, 'package.json', JSON.stringify({ workspaces: ['apps/*'] }));
    expect(detectWorkspace(npm)).not.toHaveProperty('yarn');
  });

  it('prefers the packageManager field over the lockfile', () => {
    const root = makeDir();
    write(
      root,
      'package.json',
      JSON.stringify({ workspaces: ['apps/*'], packageManager: 'yarn@4.1.0' }),
    );
    write(root, 'package-lock.json', '{}');
    expect(detectWorkspace(root)?.packageManager).toBe('yarn');
  });

  it('is not a workspace when package.json has no workspaces, or is invalid', () => {
    const root = makeDir();
    write(root, 'package.json', JSON.stringify({ name: 'single' }));
    expect(detectWorkspace(root)).toBeUndefined();
    write(root, 'package.json', '{ not json');
    expect(detectWorkspace(root)).toBeUndefined();
  });

  it('finds the workspace from a nested directory that does not exist yet', () => {
    const root = makeDir();
    write(root, 'package.json', JSON.stringify({ workspaces: ['apps/*'] }));
    const target = join(root, 'apps', 'payments-api');
    expect(detectWorkspace(target)?.root).toBe(root);
    mkdirSync(target, { recursive: true });
    expect(detectWorkspace(target)?.root).toBe(root);
  });

  it('returns the nearest workspace root when workspaces are nested', () => {
    const outer = makeDir();
    write(outer, 'package.json', JSON.stringify({ workspaces: ['apps/*'] }));
    const inner = join(outer, 'apps', 'platform');
    mkdirSync(inner, { recursive: true });
    write(inner, 'pnpm-workspace.yaml', 'packages:\n  - services/*\n');
    const found = detectWorkspace(join(inner, 'services', 'users'));
    expect(found?.root).toBe(inner);
    expect(found?.packageManager).toBe('pnpm');
  });

  it('reports Turborepo and Nx markers found at the workspace root', () => {
    const root = makeDir();
    write(root, 'package.json', JSON.stringify({ workspaces: ['apps/*'] }));
    write(root, 'turbo.json', '{}');
    write(root, 'nx.json', '{}');
    expect(detectWorkspace(root)?.tools).toEqual(['turbo', 'nx']);
  });

  it('does not report a tool marker without a workspace', () => {
    const root = makeDir();
    write(root, 'turbo.json', '{}');
    expect(detectWorkspace(root)).toBeUndefined();
  });
});

describe('matchesWorkspaceGlobs', () => {
  const ws = (globs: string[]): Workspace => ({
    root: '/repo',
    packageManager: 'pnpm',
    globs,
    tools: [],
  });

  it('matches a direct child with a single-star glob, but not deeper paths', () => {
    expect(matchesWorkspaceGlobs(ws(['apps/*']), '/repo/apps/payments-api')).toBe(true);
    expect(matchesWorkspaceGlobs(ws(['apps/*']), '/repo/apps/payments/api')).toBe(false);
    expect(matchesWorkspaceGlobs(ws(['apps/*']), '/repo/services/payments-api')).toBe(false);
  });

  it('matches nested paths with a double-star glob', () => {
    expect(matchesWorkspaceGlobs(ws(['apps/**']), '/repo/apps/team/payments-api')).toBe(true);
    expect(matchesWorkspaceGlobs(ws(['**/api']), '/repo/apps/team/api')).toBe(true);
    expect(matchesWorkspaceGlobs(ws(['**/api']), '/repo/api')).toBe(true);
  });

  it('matches an exact path and tolerates ./ and trailing slashes', () => {
    expect(matchesWorkspaceGlobs(ws(['./apps/payments-api/']), '/repo/apps/payments-api')).toBe(
      true,
    );
    expect(matchesWorkspaceGlobs(ws(['apps/payments-api']), '/repo/apps/other')).toBe(false);
  });

  it('lets a negated glob exclude a match', () => {
    const globs = ['apps/*', '!apps/legacy'];
    expect(matchesWorkspaceGlobs(ws(globs), '/repo/apps/payments-api')).toBe(true);
    expect(matchesWorkspaceGlobs(ws(globs), '/repo/apps/legacy')).toBe(false);
  });

  it('escapes regex characters in a glob', () => {
    expect(matchesWorkspaceGlobs(ws(['apps/a.b']), '/repo/apps/aXb')).toBe(false);
    expect(matchesWorkspaceGlobs(ws(['apps/a.b']), '/repo/apps/a.b')).toBe(true);
  });

  it('is false for the root itself and for paths outside it', () => {
    expect(matchesWorkspaceGlobs(ws(['*']), '/repo')).toBe(false);
    expect(matchesWorkspaceGlobs(ws(['*']), '/elsewhere/app')).toBe(false);
  });
});
