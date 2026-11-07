import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runDoctorChecks } from './doctor.js';
import { hashFile } from './file-hashes.js';
import { generateModule } from './generate-module.js';
import { generateResource } from './generate-resource.js';
import { DATABASE_STRATEGIES, DI_STRATEGIES, PRESETS, readManifest } from './manifest.js';
import { scaffoldProject } from './scaffold.js';

/*
 * The architecture rules and the generators must never disagree: whatever the CLI writes has to
 * pass `doctor --strict`. A template change that breaks a rule fails here, not in a user's CI.
 */

let workDir: string | undefined;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  workDir = undefined;
});

/** Every failed check, and every note, in readable form; empty when the project is clean. */
function problems(projectDir: string): string[] {
  return runDoctorChecks(projectDir)
    .filter((c) => !c.pass || c.severity === 'info')
    .map(
      (c) =>
        `[${c.severity}] ${c.name}${c.detail ? ` — ${c.detail}` : ''}${c.rule ? ` [${c.rule}]` : ''}`,
    );
}

/** Project files the manifest deliberately does not hash. */
const UNTRACKED = new Set(['package.json', '.fastify-ep.json']);

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name), root)
      : [relative(root, join(dir, entry.name)).split('\\').join('/')],
  );
}

/** Hashes that no longer match the disk, and generated files the manifest does not list. */
function hashProblems(projectDir: string): string[] {
  const files = readManifest(join(projectDir, '.fastify-ep.json')).files ?? {};
  const onDisk = listFiles(projectDir).filter((path) => !UNTRACKED.has(path));
  return [
    ...Object.entries(files)
      .filter(([path, hash]) => hashFile(join(projectDir, path)) !== hash)
      .map(([path]) => `stale hash: ${path}`),
    ...onDisk.filter((path) => !(path in files)).map((path) => `not recorded: ${path}`),
  ];
}

const combinations = PRESETS.flatMap((preset) =>
  DI_STRATEGIES.flatMap((di) => DATABASE_STRATEGIES.map((database) => ({ preset, di, database }))),
);

describe('generated projects pass doctor --strict', () => {
  it('covers every preset, DI and database combination', () => {
    expect(combinations).toHaveLength(
      PRESETS.length * DI_STRATEGIES.length * DATABASE_STRATEGIES.length,
    );
    expect(combinations.length).toBeGreaterThanOrEqual(18);
  });

  it.each(combinations)(
    '$preset, $di, $database: after init, generate module and generate resource --crud',
    ({ preset, di, database }) => {
      workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-drift-'));
      const targetDir = join(workDir, 'demo-app');

      scaffoldProject({
        targetDir,
        projectName: 'demo-app',
        cliVersion: '0.8.0',
        preset,
        di,
        database,
      });
      expect(problems(targetDir), 'after init').toEqual([]);
      expect(hashProblems(targetDir), 'after init hashes').toEqual([]);

      generateModule({ targetDir, moduleName: 'orders' });
      expect(problems(targetDir), 'after generate module').toEqual([]);
      expect(hashProblems(targetDir), 'after generate module hashes').toEqual([]);

      generateResource({ targetDir, resourceName: 'users', crud: true });
      expect(problems(targetDir), 'after generate resource --crud').toEqual([]);
      expect(hashProblems(targetDir), 'after generate resource --crud hashes').toEqual([]);
    },
  );
});

describe('committed examples pass doctor --strict', () => {
  const examplesDir = fileURLToPath(new URL('../examples', import.meta.url));

  it.each(['drizzle-api', 'prisma-api', 'awilix-api', 'minimal-api', 'production-api'])(
    '%s',
    (example) => {
      expect(problems(join(examplesDir, example))).toEqual([]);
    },
  );
});
