import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDoctorChecks } from '../doctor.js';
import { generateModule } from '../generate-module.js';
import { generateResource } from '../generate-resource.js';
import { readManifest, type DatabaseStrategy, type DiStrategy, type Preset } from '../manifest.js';
import type { PackageManager } from '../package-manager.js';
import { scaffoldProject } from '../scaffold.js';
import { SECURITY_PLUGIN_0_6_0 } from './0.6.0-to-0.6.1.js';
import { applyPlan, MIGRATIONS, MINIMUM_SUPPORTED_VERSION, planUpgrade } from './index.js';

/*
 * Each case builds a project the way the current CLI would, then turns it back into what an older
 * version generated (the only differences since 0.6.0 are the manifest, the Production security
 * plugin and the vitest/vite ranges, see V0.9-DESIGN.md "Delta audit"). Upgrading it must give
 * back exactly the project the current CLI generates. Fixtures from real release tags come in
 * work step 8.
 */

const TARGET = '0.9.0';
const VERSIONS = ['0.6.0', '0.6.1', '0.7.0', '0.8.0'] as const;
type Version = (typeof VERSIONS)[number];

interface Setup {
  preset: Preset;
  di: DiStrategy;
  database: DatabaseStrategy;
  packageManager?: PackageManager;
}

const SETUPS: Setup[] = [
  { preset: 'standard', di: 'native', database: 'none' },
  { preset: 'production', di: 'awilix', database: 'drizzle', packageManager: 'pnpm' },
  { preset: 'minimal', di: 'native', database: 'prisma' },
];

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function snapshot(dir: string, rel = ''): Record<string, string> {
  return Object.assign(
    {},
    ...readdirSync(join(dir, rel), { withFileTypes: true }).map((entry) =>
      entry.isDirectory()
        ? snapshot(dir, `${rel}${entry.name}/`)
        : { [`${rel}${entry.name}`]: readFileSync(join(dir, rel, entry.name), 'utf8') },
    ),
  );
}

function editJson(
  path: string,
  edit: (json: Record<string, Record<string, unknown>>) => void,
): void {
  const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, unknown>>;
  edit(json);
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
}

/** The project the current CLI generates, plus an older-version copy of it. */
function fixture(
  setup: Setup,
  version: Version,
): { old: string; expected: Record<string, string> } {
  workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-migrations-'));
  const old = join(workDir, 'old');
  scaffoldProject({ targetDir: old, projectName: 'demo-app', cliVersion: TARGET, ...setup });
  generateModule({ targetDir: old, moduleName: 'orders' });
  generateResource({ targetDir: old, resourceName: 'users', crud: true });
  const expected = snapshot(old);

  const manifestPath = join(old, '.fastify-ep.json');
  const manifest = readManifest(manifestPath);
  delete manifest.files;
  delete manifest.architectureVersion;
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ ...manifest, schemaVersion: 2, fastifyEpVersion: version }, null, 2)}\n`,
  );
  editJson(join(old, 'package.json'), (pkg) => {
    if (version === '0.6.0' || version === '0.6.1') delete pkg.devDependencies.vite;
    if (version === '0.6.0') pkg.devDependencies.vitest = '^2.0.5';
    if (version === '0.6.1') pkg.devDependencies.vitest = '^4.1.0';
  });
  if (version === '0.6.0' && setup.preset === 'production') {
    writeFileSync(join(old, 'src/infrastructure/http/security.plugin.ts'), SECURITY_PLUGIN_0_6_0);
  }
  return { old, expected };
}

function upgrade(root: string) {
  const manifest = readManifest(join(root, '.fastify-ep.json'));
  return planUpgrade({
    root,
    manifest,
    migrations: MIGRATIONS,
    targetVersion: TARGET,
    minimumVersion: MINIMUM_SUPPORTED_VERSION,
  });
}

describe('upgrading to 0.9.0 gives back what the current CLI generates', () => {
  const cases = SETUPS.flatMap((setup) => VERSIONS.map((version) => ({ setup, version })));

  it.each(cases)('$version, $setup.preset / $setup.di / $setup.database', ({ setup, version }) => {
    const { old, expected } = fixture(setup, version);

    const plan = upgrade(old);
    applyPlan(old, plan);

    expect(plan.review).toEqual([]);
    expect(snapshot(old)).toEqual(expected);
    expect(runDoctorChecks(old).filter((c) => !c.pass)).toEqual([]);
    expect(upgrade(old).upToDate).toBe(true);
  });

  it('plans exactly the migrations from the project version on', () => {
    const { old } = fixture(SETUPS[0], '0.7.0');

    expect(upgrade(old).migrations).toEqual(['0.7.0-to-0.8.0', '0.8.0-to-0.9.0']);
  });
});

describe('upgrading never overwrites what the user changed', () => {
  it('leaves an edited 0.6.0 security plugin alone and reports it', () => {
    const { old, expected } = fixture(SETUPS[1], '0.6.0');
    const pluginPath = join(old, 'src/infrastructure/http/security.plugin.ts');
    const edited = SECURITY_PLUGIN_0_6_0.replace(
      "timeWindow: '1 minute'",
      "timeWindow: '5 minutes'",
    );
    writeFileSync(pluginPath, edited);

    const plan = upgrade(old);
    applyPlan(old, plan);

    expect(readFileSync(pluginPath, 'utf8')).toBe(edited);
    expect(plan.review.map((r) => r.path)).toContain('src/infrastructure/http/security.plugin.ts');
    expect(readManifest(join(old, '.fastify-ep.json')).files).not.toHaveProperty([
      'src/infrastructure/http/security.plugin.ts',
    ]);
    // Everything else still upgraded.
    expect(readFileSync(join(old, 'src/app.ts'), 'utf8')).toBe(expected['src/app.ts']);
    expect(readFileSync(join(old, 'package.json'), 'utf8')).toBe(expected['package.json']);
  });

  it('keeps a vitest range the user pinned and reports it', () => {
    const { old } = fixture(SETUPS[0], '0.6.1');
    editJson(join(old, 'package.json'), (pkg) => {
      pkg.devDependencies.vitest = '^4.9.0';
    });

    const plan = upgrade(old);
    applyPlan(old, plan);

    const pkg = JSON.parse(readFileSync(join(old, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies.vitest).toBe('^4.9.0');
    expect(pkg.devDependencies.vite).toBe('^7.0.0');
    expect(plan.review.some((r) => r.path === 'package.json' && /vitest/.test(r.reason))).toBe(
      true,
    );
  });

  it('leaves an edited file out of the recorded hashes and reports it', () => {
    const { old } = fixture(SETUPS[0], '0.8.0');
    const envPath = join(old, 'src/config/env.ts');
    writeFileSync(envPath, `// mine\n${readFileSync(envPath, 'utf8')}`);

    const plan = upgrade(old);
    applyPlan(old, plan);

    expect(plan.review.map((r) => r.path)).toEqual(['src/config/env.ts']);
    const files = readManifest(join(old, '.fastify-ep.json')).files ?? {};
    expect(files).not.toHaveProperty(['src/config/env.ts']);
    expect(files).toHaveProperty(['src/app.ts']);
    expect(readFileSync(envPath, 'utf8')).toMatch(/^\/\/ mine/);
  });

  it('still converts the manifest when file hashes cannot be computed, and says so', () => {
    const { old } = fixture(SETUPS[0], '0.8.0');
    writeFileSync(join(old, 'package.json'), '{}');

    const plan = upgrade(old);
    applyPlan(old, plan);

    const manifest = readManifest(join(old, '.fastify-ep.json'));
    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.files).toEqual({});
    expect(plan.review.some((r) => r.path === '.fastify-ep.json')).toBe(true);
  });
});

describe('a dry run is the real plan', () => {
  it('writes nothing, and the plan lists what a real run changes', () => {
    const { old } = fixture(SETUPS[1], '0.6.0');
    const before = snapshot(old);

    const plan = upgrade(old);

    expect(snapshot(old)).toEqual(before);
    expect(plan.changes.map((c) => c.path)).toEqual(
      expect.arrayContaining([
        'src/infrastructure/http/security.plugin.ts',
        'package.json',
        '.fastify-ep.json',
      ]),
    );
  });
});
