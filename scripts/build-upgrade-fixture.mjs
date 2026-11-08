#!/usr/bin/env node
// Builds the CLI as it was at a release tag and uses it to generate a project, so `upgrade` can be
// tested against what that release really produced (not a copy edited by hand).
// Usage: node scripts/build-upgrade-fixture.mjs <tag> <outDir> <preset> <database> <di>
// Creates <outDir>/demo-app with a `orders` module and a `users` CRUD resource. Needs the tag in the
// local git history (in CI: fetch-depth 0), network for `npm ci`, and Node 24.
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [tag, outDirArg, preset, database, di] = process.argv.slice(2);
if (!tag || !outDirArg || !preset || !database || !di) {
  console.error('usage: build-upgrade-fixture.mjs <tag> <outDir> <preset> <database> <di>');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(outDirArg);
const source = mkdtempSync(join(tmpdir(), `fastify-ep-${tag}-`));

try {
  console.log(`Building fastify-ep ${tag} in ${source}`);
  execSync(`git archive --format=tar ${tag} | tar -x -C "${source}"`, {
    cwd: root,
    stdio: 'inherit',
  });
  execSync('npm ci --no-audit --no-fund', { cwd: source, stdio: 'inherit' });
  execSync('npm run build', { cwd: source, stdio: 'inherit' });

  const cli = join(source, 'dist', 'cli.js');
  const run = (args, cwd) =>
    execFileSync(process.execPath, [cli, ...args], { cwd, stdio: 'inherit' });

  mkdirSync(outDir, { recursive: true });
  run(
    ['init', 'demo-app', '--pm', 'npm', '--preset', preset, '--database', database, '--di', di],
    outDir,
  );
  const project = join(outDir, 'demo-app');
  run(['generate', 'module', 'orders'], project);
  run(['g', 'resource', 'users', '--crud'], project);
  console.log(`\nGenerated ${tag} fixture in ${project}`);
} finally {
  rmSync(source, { recursive: true, force: true });
}
