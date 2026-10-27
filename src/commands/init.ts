import { readFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import * as clack from '@clack/prompts';
import { detectPackageManager } from '../detect-package-manager.js';
import { detectWorkspace, type Workspace } from '../detect-workspace.js';
import {
  DATABASE_STRATEGIES,
  DEFAULT_PRESET,
  DI_STRATEGIES,
  PRESETS,
  type DatabaseStrategy,
  type DiStrategy,
  type Preset,
} from '../manifest.js';
import { PACKAGE_MANAGERS, type PackageManager } from '../package-manager.js';
import { pnpmWorkspaceYaml, scaffoldProject } from '../scaffold.js';
import { validateInit } from '../validate-init.js';
import { unmatchedGlobNote } from '../workspace-notes.js';

export interface InitOptions {
  /** Package name, when it should differ from the target directory's name (may be scoped). */
  name?: string;
  pm?: PackageManager;
  preset?: Preset;
  database?: DatabaseStrategy;
  di?: DiStrategy;
}

const PRESET_LABELS: Record<Preset, string> = {
  minimal: 'Minimal (no OpenAPI)',
  standard: 'Standard (OpenAPI, recommended)',
  production: 'Production (Standard + security headers, CORS, rate limiting, Dockerfile)',
};

const DATABASE_LABELS: Record<DatabaseStrategy, string> = {
  none: 'None',
  drizzle: 'Drizzle (PostgreSQL)',
  prisma: 'Prisma (PostgreSQL)',
};

const DI_LABELS: Record<DiStrategy, string> = {
  native: 'Native Fastify (recommended)',
  awilix: 'Awilix',
};

export type PackageManagerChoice = { packageManager: PackageManager } | { error: string };

/**
 * Inside a workspace the workspace's package manager is used: one lockfile and one install at the
 * root. An explicit `--pm` is only accepted when it agrees.
 */
export function inheritPackageManager(
  requested: PackageManager | undefined,
  workspace: Workspace,
): PackageManagerChoice {
  const inherited = workspace.packageManager;
  if (requested !== undefined && requested !== inherited) {
    return {
      error:
        `"${workspace.root}" is a ${inherited} workspace, so a project inside it must use ${inherited} ` +
        `(--pm ${requested} conflicts). Drop --pm, or scaffold outside the workspace.`,
    };
  }
  return { packageManager: inherited };
}

/** Berry installs Plug'n'Play by default, which plain `node` in the image cannot run. */
function usesNodeModulesLinker(root: string): boolean {
  try {
    return /^nodeLinker:\s*['"]?node-modules['"]?\s*$/m.test(
      readFileSync(join(root, '.yarnrc.yml'), 'utf8'),
    );
  } catch {
    return false;
  }
}

/**
 * Why Production cannot generate a Dockerfile in this workspace, or undefined when it can. The Yarn
 * variant uses `yarn workspaces focus`, which only Yarn 2+ (Berry) has, and runs plain `node`, which
 * needs `nodeLinker: node-modules`.
 */
export function dockerSkippedReason(workspace: Workspace): string | undefined {
  if (workspace.packageManager !== 'yarn') return undefined;
  if (workspace.yarn !== 'berry') {
    const found = workspace.yarn === 'classic' ? 'Yarn classic' : 'an unknown Yarn version';
    return (
      `No Dockerfile was generated: this workspace uses ${found}, and the workspace Dockerfile needs ` +
      `Yarn 2 or later. Set "packageManager": "yarn@4.x" in ${join(workspace.root, 'package.json')} ` +
      `and scaffold again, or write a Dockerfile by hand.`
    );
  }
  if (!usesNodeModulesLinker(workspace.root)) {
    return (
      `No Dockerfile was generated: the workspace Dockerfile runs plain node, so it needs ` +
      `"nodeLinker: node-modules" in ${join(workspace.root, '.yarnrc.yml')} (Yarn defaults to Plug'n'Play). ` +
      `Set it and scaffold again, or write a Dockerfile by hand.`
    );
  }
  return undefined;
}

/**
 * What the user must do by hand after scaffolding inside a workspace. `init` writes only inside
 * the new directory, so anything that belongs in the workspace's own files is printed instead.
 */
export function workspaceFollowUps(
  workspace: Workspace,
  targetDir: string,
  database: DatabaseStrategy,
  preset: Preset = DEFAULT_PRESET,
): string[] {
  const notes: string[] = [];
  if (workspace.packageManager === 'pnpm') {
    notes.push(
      `No pnpm-workspace.yaml was written, because the workspace root already has one. ` +
        `Merge this into ${join(workspace.root, 'pnpm-workspace.yaml')}:\n\n${pnpmWorkspaceYaml(database).trimEnd()}`,
    );
  }

  const globNote = unmatchedGlobNote(workspace, targetDir);
  if (globNote) notes.push(globNote);

  const dockerReason = preset === 'production' ? dockerSkippedReason(workspace) : undefined;
  if (dockerReason) notes.push(dockerReason);
  return notes;
}

const TOOL_NAMES = { turbo: 'Turborepo', nx: 'Nx' } as const;

export function describeWorkspace(workspace: Workspace): string {
  const { packageManager, root } = workspace;
  const tools = workspace.tools.map((tool) => TOOL_NAMES[tool]).join(' and ');
  const withTools = tools ? ` (${tools})` : '';
  const article = packageManager === 'npm' ? 'an' : 'a';
  return `Inside ${article} ${packageManager} workspace${withTools} at ${root}. Using ${packageManager}.`;
}

/** Where a project sits in its workspace, for the workspace form of the next steps. */
export interface WorkspaceSteps {
  /** The workspace root relative to the current directory; empty when it is the current directory. */
  rootDir: string;
  /** The project's path relative to the workspace root, with `/` separators. */
  servicePath: string;
  packageName: string;
  /** Whether a Dockerfile was generated. */
  docker: boolean;
}

const WORKSPACE_DEV: Record<PackageManager, (name: string) => string> = {
  npm: (name) => `npm run dev -w ${name}`,
  pnpm: (name) => `pnpm --filter ${name} dev`,
  yarn: (name) => `yarn workspace ${name} dev`,
};

/**
 * `projectDir` is the target directory as the user would `cd` to it, e.g. `my-app` or `apps/api`.
 * Inside a workspace the commands run from the workspace root, with one install for every package.
 */
export function nextSteps(
  projectDir: string,
  packageManager: PackageManager,
  database: DatabaseStrategy,
  preset: Preset = DEFAULT_PRESET,
  workspace?: WorkspaceSteps,
): string {
  if (workspace) {
    const { rootDir, servicePath, packageName, docker } = workspace;
    const steps = rootDir === '' ? [] : [`cd ${rootDir}`];
    if (database !== 'none') {
      steps.push(
        `cp ${servicePath}/.env.example ${servicePath}/.env`,
        `docker compose -f ${servicePath}/docker-compose.yml up -d`,
      );
    }
    steps.push(`${packageManager} install  # once, for the whole workspace`);
    steps.push(WORKSPACE_DEV[packageManager](packageName));
    if (preset === 'production' && docker) {
      steps.push(
        `docker build -f ${servicePath}/Dockerfile -t ${basename(servicePath)} .  # from the workspace root, after the install above`,
      );
    }
    return steps.join('\n');
  }

  const steps = [`cd ${projectDir}`];
  if (database !== 'none') {
    steps.push('cp .env.example .env', 'docker compose up -d');
  }
  steps.push(`${packageManager} install`);
  steps.push(`${packageManager} run dev`);
  if (preset === 'production') {
    steps.push(
      `docker build -t ${basename(projectDir)} .  # needs the lockfile from the install above`,
    );
  }
  return steps.join('\n');
}

export async function runInit(
  name: string | undefined,
  options: InitOptions,
  cwd: string,
  cliVersion: string,
): Promise<void> {
  clack.intro('fastify-ep init');

  let projectName = name;
  if (!projectName) {
    const answer = await clack.text({
      message: 'Project name or path?',
      placeholder: 'my-app',
    });
    if (clack.isCancel(answer)) {
      clack.cancel('Cancelled.');
      process.exit(1);
    }
    projectName = answer;
  }

  let packageManager = options.pm;
  const workspace = detectWorkspace(resolve(cwd, projectName));
  if (workspace) {
    const choice = inheritPackageManager(options.pm, workspace);
    if ('error' in choice) {
      clack.log.error(choice.error);
      clack.outro('Failed.');
      process.exit(1);
    }
    packageManager = choice.packageManager;
    clack.log.info(describeWorkspace(workspace));
  } else if (!packageManager) {
    const detected = detectPackageManager(cwd) ?? 'npm';
    const answer = await clack.select({
      message: 'Package manager?',
      options: PACKAGE_MANAGERS.map((pm) => ({ value: pm, label: pm })),
      initialValue: detected,
    });
    if (clack.isCancel(answer)) {
      clack.cancel('Cancelled.');
      process.exit(1);
    }
    packageManager = answer;
  }

  let preset = options.preset;
  if (!preset) {
    const answer = await clack.select({
      message: 'Preset?',
      options: PRESETS.map((value) => ({ value, label: PRESET_LABELS[value] })),
      initialValue: DEFAULT_PRESET,
    });
    if (clack.isCancel(answer)) {
      clack.cancel('Cancelled.');
      process.exit(1);
    }
    preset = answer;
  }

  let database = options.database;
  if (!database) {
    const answer = await clack.select({
      message: 'Database?',
      options: DATABASE_STRATEGIES.map((strategy) => ({
        value: strategy,
        label: DATABASE_LABELS[strategy],
      })),
      initialValue: 'none' as DatabaseStrategy,
    });
    if (clack.isCancel(answer)) {
      clack.cancel('Cancelled.');
      process.exit(1);
    }
    database = answer;
  }

  let di = options.di;
  if (!di) {
    const answer = await clack.select({
      message: 'Dependency management?',
      options: DI_STRATEGIES.map((strategy) => ({
        value: strategy,
        label: DI_LABELS[strategy],
      })),
      initialValue: 'native' as DiStrategy,
    });
    if (clack.isCancel(answer)) {
      clack.cancel('Cancelled.');
      process.exit(1);
    }
    di = answer;
  }

  const result = validateInit(projectName, cwd, options.name);
  if (!result.valid) {
    clack.log.error(result.reason);
    clack.outro('Failed.');
    process.exit(1);
  }

  const { targetDir, packageName } = result;
  const servicePath = workspace ? relative(workspace.root, targetDir).split(sep).join('/') : '';
  const docker = workspace === undefined || dockerSkippedReason(workspace) === undefined;
  try {
    scaffoldProject({
      targetDir,
      projectName: packageName,
      cliVersion,
      database,
      di,
      preset,
      packageManager,
      workspace: workspace ? { servicePath, docker } : undefined,
    });
  } catch (err) {
    clack.log.error(err instanceof Error ? err.message : String(err));
    clack.outro('Failed.');
    process.exit(1);
  }

  const projectDir = relative(cwd, targetDir);
  clack.log.success(`Scaffolded "${packageName}" in ${targetDir}.`);
  clack.note(
    nextSteps(
      projectDir,
      packageManager,
      database,
      preset,
      workspace && {
        rootDir: relative(cwd, workspace.root),
        servicePath,
        packageName,
        docker,
      },
    ),
    'Next steps',
  );
  if (workspace) {
    for (const note of workspaceFollowUps(workspace, targetDir, database, preset)) {
      clack.log.warn(note);
    }
  }
  clack.outro('Done.');
}
