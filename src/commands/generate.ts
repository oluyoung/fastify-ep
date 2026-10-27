import * as clack from '@clack/prompts';
import { generateModule } from '../generate-module.js';
import { generateResource } from '../generate-resource.js';
import type { DiScope } from '../manifest.js';

export interface GenerateModuleCommandOptions {
  withTests?: boolean;
  scope?: DiScope;
}

export async function runGenerateModule(
  moduleName: string,
  cwd: string,
  options: GenerateModuleCommandOptions = {},
): Promise<void> {
  clack.intro('fastify-ep generate module');

  try {
    generateModule({
      targetDir: cwd,
      moduleName,
      withTests: options.withTests,
      scope: options.scope,
    });
  } catch (err) {
    clack.log.error(err instanceof Error ? err.message : String(err));
    clack.outro('Failed.');
    process.exit(1);
  }

  clack.log.success(`Generated module "${moduleName}".`);
  clack.outro('Done.');
}

export interface GenerateResourceCommandOptions {
  withTests?: boolean;
  scope?: DiScope;
  singular?: string;
  crud?: boolean;
}

export async function runGenerateResource(
  resourceName: string,
  cwd: string,
  options: GenerateResourceCommandOptions = {},
): Promise<void> {
  clack.intro('fastify-ep generate resource');

  let notes: string[];
  try {
    ({ notes } = generateResource({
      targetDir: cwd,
      resourceName,
      withTests: options.withTests,
      scope: options.scope,
      singular: options.singular,
      crud: options.crud,
    }));
  } catch (err) {
    clack.log.error(err instanceof Error ? err.message : String(err));
    clack.outro('Failed.');
    process.exit(1);
  }

  clack.log.success(`Generated resource "${resourceName}".`);
  for (const note of notes) clack.log.info(note);
  clack.outro('Done.');
}
