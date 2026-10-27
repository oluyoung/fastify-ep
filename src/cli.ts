#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { runDoctor } from './commands/doctor.js';
import { runGenerateModule } from './commands/generate.js';
import { runInit } from './commands/init.js';
import {
  DATABASE_STRATEGIES,
  DI_SCOPES,
  DI_STRATEGIES,
  type DiScope,
  type DatabaseStrategy,
  type DiStrategy,
} from './manifest.js';
import { PACKAGE_MANAGERS } from './package-manager.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('fastify-ep')
  .description(
    'Scaffolds and keeps scaffolding a domain-driven module structure on native Fastify.',
  )
  .version(pkg.version);

program
  .command('init')
  .description('scaffold a new project')
  .argument('[name]', 'project name')
  .option('--pm <manager>', `package manager (${PACKAGE_MANAGERS.join(', ')})`)
  .option('--database <strategy>', `database (${DATABASE_STRATEGIES.join(', ')})`)
  .option('--di <strategy>', `dependency management (${DI_STRATEGIES.join(', ')})`)
  .action(
    async (name: string | undefined, options: { pm?: string; database?: string; di?: string }) => {
      if (
        options.pm &&
        !PACKAGE_MANAGERS.includes(options.pm as (typeof PACKAGE_MANAGERS)[number])
      ) {
        program.error(
          `error: option '--pm <manager>' must be one of: ${PACKAGE_MANAGERS.join(', ')}`,
        );
      }
      if (options.database && !DATABASE_STRATEGIES.includes(options.database as DatabaseStrategy)) {
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
          pm: options.pm as (typeof PACKAGE_MANAGERS)[number] | undefined,
          database: options.database as DatabaseStrategy | undefined,
          di: options.di as DiStrategy | undefined,
        },
        process.cwd(),
        pkg.version,
      );
    },
  );

const generate = program.command('generate').description('generate code in a scaffolded project');

generate
  .command('module <name>')
  .description('add a new domain module')
  .option('--no-test', 'skip generating the module test file')
  .option(
    '--scope <scope>',
    `service lifetime for Awilix projects (${DI_SCOPES.join(', ')})`,
    'singleton',
  )
  .action(async (name: string, options: { test: boolean; scope: string }) => {
    if (!DI_SCOPES.includes(options.scope as DiScope)) {
      program.error(`error: option '--scope <scope>' must be one of: ${DI_SCOPES.join(', ')}`);
    }
    await runGenerateModule(name, process.cwd(), {
      withTests: options.test,
      scope: options.scope as DiScope,
    });
  });

program
  .command('doctor')
  .description('validate project integrity')
  .action(async () => {
    await runDoctor(process.cwd());
  });

program.parse();
