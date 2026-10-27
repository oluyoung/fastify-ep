import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Workspace } from '../detect-workspace.js';
import {
  describeWorkspace,
  dockerSkippedReason,
  inheritPackageManager,
  nextSteps,
  workspaceFollowUps,
} from './init.js';

describe('nextSteps', () => {
  it('is install and dev for a project without a database', () => {
    expect(nextSteps('my-app', 'npm', 'none')).toBe('cd my-app\nnpm install\nnpm run dev');
  });

  it.each(['drizzle', 'prisma'] as const)(
    '%s: copies .env and starts Postgres first',
    (database) => {
      expect(nextSteps('my-app', 'pnpm', database)).toBe(
        'cd my-app\ncp .env.example .env\ndocker compose up -d\npnpm install\npnpm run dev',
      );
    },
  );
});

describe('nextSteps for a nested directory', () => {
  it('cds to the path', () => {
    expect(nextSteps('apps/payments-api', 'npm', 'none')).toBe(
      'cd apps/payments-api\nnpm install\nnpm run dev',
    );
  });

  it('tags the Docker image with the last path segment', () => {
    expect(nextSteps('apps/payments-api', 'npm', 'none', 'production')).toContain(
      'docker build -t payments-api .',
    );
  });
});

describe('nextSteps for the Production preset', () => {
  it('ends with the Docker build', () => {
    expect(nextSteps('my-app', 'npm', 'none', 'production')).toBe(
      'cd my-app\nnpm install\nnpm run dev\ndocker build -t my-app .  # needs the lockfile from the install above',
    );
  });

  it.each(['minimal', 'standard'] as const)('%s adds no Docker step', (preset) => {
    expect(nextSteps('my-app', 'npm', 'none', preset)).not.toContain('docker');
  });
});

const workspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  root: '/repo',
  packageManager: 'pnpm',
  globs: ['apps/*'],
  tools: [],
  ...overrides,
});

describe('inheritPackageManager', () => {
  it('uses the workspace manager when --pm is not given', () => {
    expect(inheritPackageManager(undefined, workspace())).toEqual({ packageManager: 'pnpm' });
  });

  it('accepts a --pm that matches the workspace', () => {
    expect(inheritPackageManager('pnpm', workspace())).toEqual({ packageManager: 'pnpm' });
  });

  it('rejects a --pm that conflicts, naming the workspace manager and root', () => {
    const choice = inheritPackageManager('npm', workspace({ root: '/repo' }));
    expect(choice).toMatchObject({ error: expect.stringContaining('/repo') });
    expect('error' in choice && choice.error).toContain('must use pnpm');
    expect('error' in choice && choice.error).toContain('--pm npm');
  });
});

describe('describeWorkspace', () => {
  it('names the manager and root', () => {
    expect(describeWorkspace(workspace())).toBe('Inside a pnpm workspace at /repo. Using pnpm.');
  });

  it('says "an npm workspace"', () => {
    expect(describeWorkspace(workspace({ packageManager: 'npm' }))).toBe(
      'Inside an npm workspace at /repo. Using npm.',
    );
  });

  it('mentions Turborepo and Nx when found', () => {
    expect(describeWorkspace(workspace({ packageManager: 'yarn', tools: ['turbo', 'nx'] }))).toBe(
      'Inside a yarn workspace (Turborepo and Nx) at /repo. Using yarn.',
    );
  });
});

describe('workspaceFollowUps', () => {
  it('prints the allowBuilds to merge for pnpm, and nothing else when the target is matched', () => {
    const notes = workspaceFollowUps(workspace(), '/repo/apps/svc', 'none');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('No pnpm-workspace.yaml was written');
    expect(notes[0]).toContain('/repo/pnpm-workspace.yaml');
    expect(notes[0]).toContain('allowBuilds:');
    expect(notes[0]).toContain('esbuild: false');
  });

  it('lists the Prisma build approvals for a Prisma project', () => {
    const [note] = workspaceFollowUps(workspace(), '/repo/apps/svc', 'prisma');
    expect(note).toContain('prisma: true');
    expect(note).toContain("'@prisma/engines': true");
  });

  it('says which glob to add to pnpm-workspace.yaml when the target is not matched', () => {
    const notes = workspaceFollowUps(
      workspace({ globs: ['packages/*'] }),
      '/repo/apps/svc',
      'none',
    );
    expect(notes).toHaveLength(2);
    expect(notes[1]).toContain('"apps/svc" is not matched');
    expect(notes[1]).toContain("- 'apps/*'");
  });

  it('prints only the glob note for npm and Yarn workspaces', () => {
    const notes = workspaceFollowUps(
      workspace({ packageManager: 'npm', globs: ['packages/*'] }),
      '/repo/apps/svc',
      'none',
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('"workspaces" in /repo/package.json');
    expect(notes[0]).toContain('Add "apps/*"');
  });

  it('prints nothing for an npm workspace whose globs match', () => {
    expect(
      workspaceFollowUps(workspace({ packageManager: 'npm' }), '/repo/apps/svc', 'none'),
    ).toEqual([]);
  });

  it('suggests the exact path for a target directly under the root', () => {
    const [note] = workspaceFollowUps(
      workspace({ packageManager: 'yarn', globs: ['apps/*'] }),
      '/repo/svc',
      'none',
    );
    expect(note).toContain('Add "svc"');
  });
});

describe('nextSteps inside a workspace', () => {
  const at = (overrides = {}) => ({
    rootDir: '',
    servicePath: 'apps/payments-api',
    packageName: '@acme/payments-api',
    docker: true,
    ...overrides,
  });

  it.each([
    ['npm', 'npm run dev -w @acme/payments-api'],
    ['pnpm', 'pnpm --filter @acme/payments-api dev'],
    ['yarn', 'yarn workspace @acme/payments-api dev'],
  ] as const)('%s: one install, then the workspace dev command', (pm, dev) => {
    expect(nextSteps('apps/payments-api', pm, 'none', 'standard', at())).toBe(
      `${pm} install  # once, for the whole workspace\n${dev}`,
    );
  });

  it('cds to the workspace root when it is not the current directory', () => {
    expect(
      nextSteps('svc', 'pnpm', 'none', 'standard', at({ rootDir: '../..' })).split('\n')[0],
    ).toBe('cd ../..');
  });

  it('points the database steps at the service folder', () => {
    expect(nextSteps('svc', 'npm', 'drizzle', 'standard', at())).toContain(
      'cp apps/payments-api/.env.example apps/payments-api/.env\ndocker compose -f apps/payments-api/docker-compose.yml up -d',
    );
  });

  it('builds the Production image from the workspace root with -f', () => {
    expect(nextSteps('svc', 'npm', 'none', 'production', at())).toContain(
      'docker build -f apps/payments-api/Dockerfile -t payments-api .',
    );
  });

  it('has no Docker step when no Dockerfile was generated', () => {
    expect(nextSteps('svc', 'yarn', 'none', 'production', at({ docker: false }))).not.toContain(
      'docker',
    );
  });
});

describe('dockerSkippedReason', () => {
  it('is undefined for npm and pnpm', () => {
    expect(dockerSkippedReason(workspace({ packageManager: 'npm' }))).toBeUndefined();
    expect(dockerSkippedReason(workspace({ packageManager: 'pnpm' }))).toBeUndefined();
  });

  describe('Yarn Berry', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'fastify-ep-docker-'));
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));
    const berry = () => workspace({ root, packageManager: 'yarn', yarn: 'berry' });

    it('is supported with nodeLinker: node-modules', () => {
      writeFileSync(
        join(root, '.yarnrc.yml'),
        'nodeLinker: node-modules\nenableTelemetry: false\n',
      );
      expect(dockerSkippedReason(berry())).toBeUndefined();
    });

    it("is skipped for Plug'n'Play, with or without a .yarnrc.yml", () => {
      expect(dockerSkippedReason(berry())).toContain('nodeLinker: node-modules');
      writeFileSync(join(root, '.yarnrc.yml'), 'nodeLinker: pnp\n');
      expect(dockerSkippedReason(berry())).toContain('Plug');
    });
  });

  it('explains Yarn classic and an unknown Yarn', () => {
    expect(dockerSkippedReason(workspace({ packageManager: 'yarn', yarn: 'classic' }))).toContain(
      'Yarn classic',
    );
    expect(dockerSkippedReason(workspace({ packageManager: 'yarn' }))).toContain('unknown Yarn');
  });

  it('is added to the follow-ups for Production only', () => {
    const ws = workspace({ packageManager: 'yarn', yarn: 'classic' });
    expect(workspaceFollowUps(ws, '/repo/apps/svc', 'none', 'production').join('\n')).toContain(
      'No Dockerfile was generated',
    );
    expect(workspaceFollowUps(ws, '/repo/apps/svc', 'none', 'standard').join('\n')).not.toContain(
      'Dockerfile',
    );
  });
});
