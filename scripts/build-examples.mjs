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
  { name: 'drizzle-api', database: 'drizzle', di: 'native', preset: 'standard' },
  { name: 'prisma-api', database: 'prisma', di: 'native', preset: 'standard' },
  { name: 'awilix-api', database: 'drizzle', di: 'awilix', preset: 'standard' },
  { name: 'minimal-api', database: 'none', di: 'native', preset: 'minimal' },
  { name: 'production-api', database: 'drizzle', di: 'native', preset: 'production' },
];

function run(args, cwd) {
  execFileSync(process.execPath, [cli, ...args], { cwd, stdio: 'inherit' });
}

mkdirSync(examplesDir, { recursive: true });
for (const { name, database, di, preset } of EXAMPLES) {
  const dir = join(examplesDir, name);
  rmSync(dir, { recursive: true, force: true });
  run(
    ['init', name, '--pm', 'npm', '--preset', preset, '--database', database, '--di', di],
    examplesDir,
  );
  run(['generate', 'module', 'orders'], dir);
  // The `g` alias, so CI exercises it too.
  run(['g', 'resource', 'users', '--crud'], dir);
}
console.log(`\nGenerated ${EXAMPLES.map((e) => e.name).join(', ')} in examples/`);
