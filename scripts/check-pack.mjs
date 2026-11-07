// Release-integrity check: the npm tarball must contain what the CLI needs at runtime
// and nothing that should not ship. Run after `npm run build`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const [{ files }] = JSON.parse(out);
const paths = files.map((f) => f.path);

const problems = [];

const required = [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  pkg.bin['fastify-ep'],
  'dist/program.js',
];
for (const file of required) {
  if (!paths.includes(file)) problems.push(`missing from tarball: ${file}`);
}

// Every directory in `files` must contribute at least one file.
for (const entry of pkg.files ?? []) {
  const prefix = entry.replace(/\/$/, '');
  if (!paths.some((p) => p === prefix || p.startsWith(`${prefix}/`))) {
    problems.push(`"files" entry matches nothing: ${entry}`);
  }
}

const forbidden = [
  /^src\//,
  /^examples\//,
  /^scripts\//,
  /^\.github\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.env$/,
  /^dist\/.*\.test\.js(\.map)?$/,
  /^dist\/.*\.test\.d\.ts$/,
  /(^|\/)tsconfig\.tsbuildinfo$/,
];
for (const p of paths) {
  if (forbidden.some((re) => re.test(p))) problems.push(`must not ship: ${p}`);
}

if (problems.length > 0) {
  console.error(`Pack check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Pack check passed: ${paths.length} files in ${pkg.name}@${pkg.version}`);
