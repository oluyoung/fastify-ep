import * as clack from '@clack/prompts';
import { generateLibrary } from '../generate-library.js';
import { generateModule } from '../generate-module.js';
import { generateResource } from '../generate-resource.js';
import type { DiScope } from '../manifest.js';
import { resolveProjectOrExit } from './project.js';

export interface GenerateModuleCommandOptions {
  withTests?: boolean;
  scope?: DiScope;
  /** Run against the project in this directory instead of the one found from `cwd`. */
  project?: string;
}

export async function runGenerateModule(
  moduleName: string,
  cwd: string,
  options: GenerateModuleCommandOptions = {},
): Promise<void> {
  clack.intro('fastify-ep generate module');

  const targetDir = resolveProjectOrExit(cwd, options.project);
  try {
    generateModule({
      targetDir,
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
  project?: string;
}

export async function runGenerateResource(
  resourceName: string,
  cwd: string,
  options: GenerateResourceCommandOptions = {},
): Promise<void> {
  clack.intro('fastify-ep generate resource');

  const targetDir = resolveProjectOrExit(cwd, options.project);
  let notes: string[];
  try {
    ({ notes } = generateResource({
      targetDir,
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

export interface GenerateLibraryCommandOptions {
  /** Package name when it should differ from the default (may be scoped). */
  name?: string;
  /** The library's directory, relative to the current directory. */
  dir?: string;
  cliVersion: string;
}

export async function runGenerateLibrary(
  libraryName: string,
  cwd: string,
  options: GenerateLibraryCommandOptions,
): Promise<void> {
  clack.intro('fastify-ep generate library');

  let result;
  try {
    result = generateLibrary({
      cwd,
      name: libraryName,
      packageName: options.name,
      dir: options.dir,
      cliVersion: options.cliVersion,
    });
  } catch (err) {
    clack.log.error(err instanceof Error ? err.message : String(err));
    clack.outro('Failed.');
    process.exit(1);
  }

  clack.log.success(`Generated library "${result.packageName}" in ${result.targetDir}.`);
  for (const note of result.notes) clack.log.info(note);
  clack.outro('Done.');
}
