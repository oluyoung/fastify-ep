#!/usr/bin/env node
// Regenerates examples/ from the built CLI so they can never drift from the templates.
// Usage: npm run build && npm run examples
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'dist', 'cli.js');
const examplesDir = join(root, 'examples');

if (!existsSync(cli)) {
  console.error('dist/cli.js not found. Run `npm run build` first.');
  process.exit(1);
}

const EXAMPLES = [
  { name: 'drizzle-api', database: 'drizzle', di: 'native' },
  { name: 'prisma-api', database: 'prisma', di: 'native' },
  { name: 'awilix-api', database: 'drizzle', di: 'awilix' },
];

function run(args, cwd) {
  execFileSync(process.execPath, [cli, ...args], { cwd, stdio: 'inherit' });
}

mkdirSync(examplesDir, { recursive: true });
for (const { name, database, di } of EXAMPLES) {
  const dir = join(examplesDir, name);
  rmSync(dir, { recursive: true, force: true });
  run(['init', name, '--pm', 'npm', '--database', database, '--di', di], examplesDir);
  run(['generate', 'module', 'orders'], dir);
}
console.log(`\nGenerated ${EXAMPLES.map((e) => e.name).join(', ')} in examples/`);
