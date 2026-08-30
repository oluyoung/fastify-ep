#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('fastify-ep')
  .description(
    'Scaffolds and keeps scaffolding a domain-driven module structure on native Fastify.',
  )
  .version(pkg.version);

program.parse();
