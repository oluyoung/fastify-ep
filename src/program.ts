import { createRequire } from 'node:module';
import { Command } from 'commander';
import { runDoctor } from './commands/doctor.js';
import {
  runGenerateLibrary,
  runGenerateModule,
  runGenerateResource,
  type GenerateLibraryCommandOptions,
  type GenerateModuleCommandOptions,
  type GenerateResourceCommandOptions,
} from './commands/generate.js';
import { runInit } from './commands/init.js';
import {
  DATABASE_STRATEGIES,
  DI_SCOPES,
  DI_STRATEGIES,
  PRESETS,
  type DiScope,
  type Preset,
  type DatabaseStrategy,
  type DiStrategy,
} from './manifest.js';
import { PACKAGE_MANAGERS } from './package-manager.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

/** The generators the program dispatches to; replaceable so tests can observe the parsed options. */
export interface ProgramRunners {
  generateModule: (
    name: string,
    cwd: string,
    options: GenerateModuleCommandOptions,
  ) => Promise<void>;
  generateResource: (
    name: string,
    cwd: string,
    options: GenerateResourceCommandOptions,
  ) => Promise<void>;
  generateLibrary: (
    name: string,
    cwd: string,
    options: GenerateLibraryCommandOptions,
  ) => Promise<void>;
}

export function createProgram(runners: Partial<ProgramRunners> = {}): Command {
  const run: ProgramRunners = {
    generateModule: runGenerateModule,
    generateResource: runGenerateResource,
    generateLibrary: runGenerateLibrary,
    ...runners,
  };
  const program = new Command();

  function parseScope(scope: string): DiScope {
    if (!DI_SCOPES.includes(scope as DiScope)) {
      program.error(`error: option '--scope <scope>' must be one of: ${DI_SCOPES.join(', ')}`);
    }
    return scope as DiScope;
  }

  const withProjectOption = (command: Command): Command =>
    command.option(
      '-C, --project <dir>',
      'run against the fastify-ep project in <dir> (default: the project containing the current directory)',
    );

  program
    .name('fastify-ep')
    .description(
      'Scaffolds and keeps scaffolding a domain-driven module structure on native Fastify.',
    )
    .version(pkg.version);

  program
    .command('init')
    .description('scaffold a new project')
    .argument('[name]', 'project name, or a directory path such as apps/payments-api')
    .option(
      '--name <package-name>',
      'package name when it differs from the directory name (may be scoped, e.g. @acme/payments-api)',
    )
    .option('--pm <manager>', `package manager (${PACKAGE_MANAGERS.join(', ')})`)
    .option('--preset <preset>', `starting point (${PRESETS.join(', ')})`)
    .option('--database <strategy>', `database (${DATABASE_STRATEGIES.join(', ')})`)
    .option('--di <strategy>', `dependency management (${DI_STRATEGIES.join(', ')})`)
    .action(
      async (
        name: string | undefined,
        options: { name?: string; pm?: string; preset?: string; database?: string; di?: string },
      ) => {
        if (
          options.pm &&
          !PACKAGE_MANAGERS.includes(options.pm as (typeof PACKAGE_MANAGERS)[number])
        ) {
          program.error(
            `error: option '--pm <manager>' must be one of: ${PACKAGE_MANAGERS.join(', ')}`,
          );
        }
        if (options.preset && !PRESETS.includes(options.preset as Preset)) {
          program.error(`error: option '--preset <preset>' must be one of: ${PRESETS.join(', ')}`);
        }
        if (
          options.database &&
          !DATABASE_STRATEGIES.includes(options.database as DatabaseStrategy)
        ) {
          program.error(
            `error: option '--database <strategy>' must be one of: ${DATABASE_STRATEGIES.join(', ')}`,
          );
        }
        if (options.di && !DI_STRATEGIES.includes(options.di as DiStrategy)) {
          program.error(
            `error: option '--di <strategy>' must be one of: ${DI_STRATEGIES.join(', ')}`,
          );
        }
        await runInit(
          name,
          {
            name: options.name,
            pm: options.pm as (typeof PACKAGE_MANAGERS)[number] | undefined,
            preset: options.preset as Preset | undefined,
            database: options.database as DatabaseStrategy | undefined,
            di: options.di as DiStrategy | undefined,
          },
          process.cwd(),
          pkg.version,
        );
      },
    );

  const generate = program
    .command('generate')
    .alias('g')
    .description('generate code in a scaffolded project');

  withProjectOption(generate.command('module <name>'))
    .description('add a new domain module')
    .option('--no-test', 'skip generating the module test file')
    .option(
      '--scope <scope>',
      `service lifetime for Awilix projects (${DI_SCOPES.join(', ')})`,
      'singleton',
    )
    .action(async (name: string, options: { test: boolean; scope: string; project?: string }) => {
      await run.generateModule(name, process.cwd(), {
        withTests: options.test,
        scope: parseScope(options.scope),
        project: options.project,
      });
    });

  withProjectOption(generate.command('resource <name>'))
    .description('add a module with a repository, optionally with CRUD routes')
    .option('--crud', 'generate create/read/update/delete routes backed by the project database')
    .option('--no-test', 'skip generating the resource test file')
    .option(
      '--scope <scope>',
      `service lifetime for Awilix projects (${DI_SCOPES.join(', ')})`,
      'singleton',
    )
    .option('--singular <name>', 'entity name when it is not the resource name minus a plural "s"')
    .action(
      async (
        name: string,
        options: {
          crud?: boolean;
          test: boolean;
          scope: string;
          singular?: string;
          project?: string;
        },
      ) => {
        await run.generateResource(name, process.cwd(), {
          crud: options.crud,
          withTests: options.test,
          scope: parseScope(options.scope),
          singular: options.singular,
          project: options.project,
        });
      },
    );

  generate
    .command('library <name>')
    .description('add a shared library package to the workspace')
    .option(
      '--name <package-name>',
      'package name when it differs from the workspace scope + library name (may be scoped, e.g. @acme/contracts)',
    )
    .option(
      '--dir <path>',
      'the library directory, relative to the current directory (default: packages/<name>)',
    )
    .action(async (name: string, options: { name?: string; dir?: string }) => {
      await run.generateLibrary(name, process.cwd(), {
        name: options.name,
        dir: options.dir,
        cliVersion: pkg.version,
      });
    });

  withProjectOption(program.command('doctor'))
    .description('validate project integrity')
    .action(async (options: { project?: string }) => {
      await runDoctor(process.cwd(), { project: options.project });
    });

  return program;
}
