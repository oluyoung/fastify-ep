#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { runGenerateModule } from './commands/generate.js';
import { runInit } from './commands/init.js';
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
  .action(async (name: string | undefined, options: { pm?: string }) => {
    if (options.pm && !PACKAGE_MANAGERS.includes(options.pm as (typeof PACKAGE_MANAGERS)[number])) {
      program.error(
        `error: option '--pm <manager>' must be one of: ${PACKAGE_MANAGERS.join(', ')}`,
      );
    }
    await runInit(
      name,
      { pm: options.pm as (typeof PACKAGE_MANAGERS)[number] | undefined },
      process.cwd(),
      pkg.version,
    );
  });

const generate = program.command('generate').description('generate code in a scaffolded project');

generate
  .command('module <name>')
  .description('add a new domain module')
  .action(async (name: string) => {
    await runGenerateModule(name, process.cwd());
  });

program.parse();
