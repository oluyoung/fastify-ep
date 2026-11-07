import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BaselineUnavailableError, computeBaseline } from './baseline.js';
import { generateModule } from './generate-module.js';
import { generateResource } from './generate-resource.js';
import {
  DATABASE_STRATEGIES,
  DI_STRATEGIES,
  PRESETS,
  readManifest,
  type DatabaseStrategy,
  type DiStrategy,
  type Manifest,
  type Preset,
} from './manifest.js';
import type { PackageManager } from './package-manager.js';
import { scaffoldProject } from './scaffold.js';

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

interface Options {
  preset?: Preset;
  di?: DiStrategy;
  database?: DatabaseStrategy;
  packageManager?: PackageManager;
  name?: string;
  dir?: string;
  workspace?: { servicePath: string; docker: boolean };
}

function scaffold({
  preset = 'standard',
  di = 'native',
  database = 'none',
  packageManager,
  name = 'demo-app',
  dir,
  workspace,
}: Options = {}): string {
  workDir ??= mkdtempSync(join(tmpdir(), 'fastify-ep-baseline-test-'));
  const targetDir = dir ?? join(workDir, 'demo-app');
  scaffoldProject({
    targetDir,
    projectName: name,
    cliVersion: '0.9.0',
    preset,
    di,
    database,
    packageManager,
    workspace,
  });
  return targetDir;
}

/** Rewrites the manifest as a pre-0.9 (schema 2) one and returns what it recorded. */
function toSchema2(dir: string): { recorded: Record<string, string>; manifest: Manifest } {
  const manifestPath = join(dir, '.fastify-ep.json');
  const v3 = readManifest(manifestPath);
  const recorded = v3.files ?? {};
  const manifest: Manifest = { ...v3, schemaVersion: 2 };
  delete manifest.files;
  delete manifest.architectureVersion;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { recorded, manifest };
}

/** Every file and its content, for checking that a call leaves the project alone. */
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

const combinations = PRESETS.flatMap((preset) =>
  DI_STRATEGIES.flatMap((di) => DATABASE_STRATEGIES.map((database) => ({ preset, di, database }))),
);

describe('computeBaseline recovers what generation recorded', () => {
  it.each(combinations)(
    '$preset, $di, $database: scaffold, module, resource --crud',
    ({ preset, di, database }) => {
      const dir = scaffold({ preset, di, database });
      generateModule({ targetDir: dir, moduleName: 'orders' });
      generateResource({ targetDir: dir, resourceName: 'users', crud: true });
      const { recorded, manifest } = toSchema2(dir);

      const baseline = computeBaseline(dir, manifest);

      expect(baseline.files).toEqual(recorded);
      expect(baseline.differing).toEqual([]);
      expect(baseline.missing).toEqual([]);
    },
  );
});

describe('computeBaseline variants', () => {
  it('matches a request-scoped Awilix module, a plain resource and a module without tests', () => {
    const dir = scaffold({ di: 'awilix' });
    generateModule({ targetDir: dir, moduleName: 'orders', scope: 'request' });
    generateResource({ targetDir: dir, resourceName: 'users' });
    generateModule({ targetDir: dir, moduleName: 'notes', withTests: false });
    const { recorded, manifest } = toSchema2(dir);

    const baseline = computeBaseline(dir, manifest);

    expect(baseline.files).toEqual(recorded);
    expect(baseline.differing).toEqual([]);
    expect(baseline.missing).toEqual([]);
  });

  it('matches the pnpm Production Dockerfile and pnpm-workspace.yaml', () => {
    const dir = scaffold({ preset: 'production', packageManager: 'pnpm' });
    const { recorded, manifest } = toSchema2(dir);

    const baseline = computeBaseline(dir, manifest);

    expect(baseline.files).toEqual(recorded);
    expect(baseline.files).toHaveProperty(['Dockerfile']);
    expect(baseline.files).toHaveProperty(['pnpm-workspace.yaml']);
    expect(baseline.differing).toEqual([]);
  });

  it('matches the workspace Dockerfile of a service inside a workspace', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-baseline-test-'));
    writeFileSync(
      join(workDir, 'package.json'),
      '{"name":"root","private":true,"workspaces":["apps/*"]}\n',
    );
    const dir = scaffold({
      preset: 'production',
      packageManager: 'npm',
      dir: join(workDir, 'apps', 'svc'),
      workspace: { servicePath: 'apps/svc', docker: true },
    });
    const { recorded, manifest } = toSchema2(dir);

    const baseline = computeBaseline(dir, manifest);

    expect(baseline.files).toEqual(recorded);
    expect(baseline.differing).toEqual([]);
  });

  it('works with a scoped project name', () => {
    const dir = scaffold({ name: '@acme/payments-api' });
    const { recorded, manifest } = toSchema2(dir);

    expect(computeBaseline(dir, manifest).files).toEqual(recorded);
  });
});

describe('computeBaseline leaves edited and unknown files out', () => {
  it('reports an edited file as differing and a deleted one as missing', () => {
    const dir = scaffold();
    generateModule({ targetDir: dir, moduleName: 'orders' });
    const { recorded, manifest } = toSchema2(dir);
    writeFileSync(
      join(dir, 'src/config/env.ts'),
      `// mine\n${readFileSync(join(dir, 'src/config/env.ts'), 'utf8')}`,
    );
    rmSync(join(dir, 'src/modules/orders/orders.schema.ts'));

    const baseline = computeBaseline(dir, manifest);

    expect(baseline.differing).toEqual(['src/config/env.ts']);
    expect(baseline.missing).toEqual(['src/modules/orders/orders.schema.ts']);
    expect(baseline.files).not.toHaveProperty(['src/config/env.ts']);
    expect(Object.keys(baseline.files)).toHaveLength(Object.keys(recorded).length - 2);
  });

  it('leaves a hand-edited app.ts out instead of rewriting it as pristine', () => {
    const dir = scaffold();
    generateModule({ targetDir: dir, moduleName: 'orders' });
    const { manifest } = toSchema2(dir);
    const appTs = join(dir, 'src/app.ts');
    writeFileSync(appTs, `// mine\n${readFileSync(appTs, 'utf8')}`);

    const baseline = computeBaseline(dir, manifest);

    expect(baseline.differing).toContain('src/app.ts');
    expect(baseline.files).not.toHaveProperty(['src/app.ts']);
  });

  it('treats a module generated with a custom --singular as differing', () => {
    const dir = scaffold();
    generateResource({ targetDir: dir, resourceName: 'people', singular: 'human' });
    const { manifest } = toSchema2(dir);

    const baseline = computeBaseline(dir, manifest);

    expect(baseline.differing.some((path) => path.startsWith('src/modules/people/'))).toBe(true);
    expect(
      Object.keys(baseline.files).some(
        (path) => path.startsWith('src/modules/people/') && path.endsWith('.schema.ts'),
      ),
    ).toBe(false);
  });

  it("never lists the user's own files", () => {
    const dir = scaffold();
    mkdirSync(join(dir, 'src', 'extra'), { recursive: true });
    writeFileSync(join(dir, 'src/extra/mine.ts'), 'export {};\n');
    const { manifest } = toSchema2(dir);

    const baseline = computeBaseline(dir, manifest);

    expect(JSON.stringify(baseline)).not.toContain('mine.ts');
  });
});

describe('computeBaseline safety', () => {
  it('throws BaselineUnavailableError without a usable package.json', () => {
    const dir = scaffold();
    const { manifest } = toSchema2(dir);

    writeFileSync(join(dir, 'package.json'), 'not json');
    expect(() => computeBaseline(dir, manifest)).toThrow(BaselineUnavailableError);

    writeFileSync(join(dir, 'package.json'), '{}');
    expect(() => computeBaseline(dir, manifest)).toThrow(BaselineUnavailableError);

    rmSync(join(dir, 'package.json'));
    expect(() => computeBaseline(dir, manifest)).toThrow(BaselineUnavailableError);
  });

  it('does not write to the project and removes its temp directories', () => {
    const dir = scaffold({ database: 'drizzle' });
    generateResource({ targetDir: dir, resourceName: 'users', crud: true });
    const { manifest } = toSchema2(dir);
    const before = snapshot(dir);

    // Other test files run in parallel and also make baseline temp dirs in the system temp dir, so
    // give this call a private one and check that nothing is left in it.
    const privateTmp = mkdtempSync(join(tmpdir(), 'fastify-ep-private-tmp-'));
    const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
    process.env.TMPDIR = process.env.TEMP = process.env.TMP = privateTmp;
    try {
      computeBaseline(dir, manifest);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    expect(snapshot(dir)).toEqual(before);
    expect(readdirSync(privateTmp)).toEqual([]);
    rmSync(privateTmp, { recursive: true, force: true });
  });

  it('is not confused by a copy of the project elsewhere', () => {
    const dir = scaffold();
    const { manifest } = toSchema2(dir);
    const copy = join(workDir, 'copy');
    cpSync(dir, copy, { recursive: true });

    expect(computeBaseline(copy, manifest).differing).toEqual([]);
  });
});
