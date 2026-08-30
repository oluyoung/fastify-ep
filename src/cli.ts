#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { PACKAGE_MANAGERS, runInit } from './commands/init.js';

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
    );
  });

program.parse();
