import { resolve } from 'node:path';
import * as clack from '@clack/prompts';
import { detectPackageManager } from '../detect-package-manager.js';
import { DATABASE_STRATEGIES, type DatabaseStrategy } from '../manifest.js';
import { PACKAGE_MANAGERS, type PackageManager } from '../package-manager.js';
import { scaffoldProject } from '../scaffold.js';
import { validateInit } from '../validate-init.js';

export interface InitOptions {
  pm?: PackageManager;
  database?: DatabaseStrategy;
}

const DATABASE_LABELS: Record<DatabaseStrategy, string> = {
  none: 'None',
  drizzle: 'Drizzle (PostgreSQL)',
  prisma: 'Prisma (PostgreSQL)',
};

export function nextSteps(
  projectName: string,
  packageManager: PackageManager,
  database: DatabaseStrategy,
): string {
  const steps = [`cd ${projectName}`];
  if (database !== 'none') {
    steps.push('cp .env.example .env', 'docker compose up -d');
  }
  steps.push(`${packageManager} install`);
  steps.push(`${packageManager} run dev`);
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
      message: 'Project name?',
      placeholder: 'my-app',
    });
    if (clack.isCancel(answer)) {
      clack.cancel('Cancelled.');
      process.exit(1);
    }
    projectName = answer;
  }

  let packageManager = options.pm;
  if (!packageManager) {
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

  const result = validateInit(projectName, cwd);
  if (!result.valid) {
    clack.log.error(result.reason);
    clack.outro('Failed.');
    process.exit(1);
  }

  const targetDir = resolve(cwd, projectName);
  try {
    scaffoldProject({ targetDir, projectName, cliVersion, database, packageManager });
  } catch (err) {
    clack.log.error(err instanceof Error ? err.message : String(err));
    clack.outro('Failed.');
    process.exit(1);
  }

  clack.log.success(`Scaffolded "${projectName}" in ${targetDir}.`);
  clack.note(nextSteps(projectName, packageManager, database), 'Next steps');
  clack.outro('Done.');
}
