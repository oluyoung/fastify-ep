import * as clack from '@clack/prompts';
import { validateInit } from '../validate-init.js';

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export interface InitOptions {
  pm?: PackageManager;
}

export async function runInit(
  name: string | undefined,
  options: InitOptions,
  cwd: string,
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
    const answer = await clack.select({
      message: 'Package manager?',
      options: PACKAGE_MANAGERS.map((pm) => ({ value: pm, label: pm })),
      initialValue: 'npm' as PackageManager,
    });
    if (clack.isCancel(answer)) {
      clack.cancel('Cancelled.');
      process.exit(1);
    }
    packageManager = answer;
  }

  const result = validateInit(projectName, cwd);
  if (!result.valid) {
    clack.log.error(result.reason);
    clack.outro('Failed.');
    process.exit(1);
  }

  clack.log.success(`Would scaffold "${projectName}" here using ${packageManager}.`);
  clack.outro('Done.');
}
