import { resolve } from 'node:path';
import * as clack from '@clack/prompts';
import { detectPackageManager } from '../detect-package-manager.js';
import { PACKAGE_MANAGERS, type PackageManager } from '../package-manager.js';
import { scaffoldProject } from '../scaffold.js';
import { validateInit } from '../validate-init.js';

export interface InitOptions {
  pm?: PackageManager;
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

  const result = validateInit(projectName, cwd);
  if (!result.valid) {
    clack.log.error(result.reason);
    clack.outro('Failed.');
    process.exit(1);
  }

  const targetDir = resolve(cwd, projectName);
  try {
    scaffoldProject({ targetDir, projectName, cliVersion });
  } catch (err) {
    clack.log.error(err instanceof Error ? err.message : String(err));
    clack.outro('Failed.');
    process.exit(1);
  }

  clack.log.success(`Scaffolded "${projectName}" in ${targetDir}.`);
  clack.note(
    `cd ${projectName}\n${packageManager} install\n${packageManager} run dev`,
    'Next steps',
  );
  clack.outro('Done.');
}
