import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scaffoldProject } from './scaffold.js';

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

/** A minimal fake templates dir whose app.ts has no `fastify-ep:register` marker. */
function makeUnmarkedTemplatesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fastify-ep-templates-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/app.ts'), 'export const app = 1;\n');
  writeFileSync(join(dir, 'package.json'), '{"name":"{{projectName}}"}\n');
  return dir;
}

describe('scaffoldProject', () => {
  it('copies the template tree, renders {{projectName}}, and writes a valid manifest last', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));
    const targetDir = join(workDir, 'my-app');

    scaffoldProject({ targetDir, projectName: 'my-app', cliVersion: '0.1.0' });

    expect(existsSync(join(targetDir, 'src/app.ts'))).toBe(true);
    expect(existsSync(join(targetDir, 'src/modules/health/health.module.ts'))).toBe(true);

    const appTs = readFileSync(join(targetDir, 'src/app.ts'), 'utf8');
    expect(appTs).toContain(
      "await fastify.register((await import('./modules/health/health.module.js')).default);",
    );

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')) as {
      name: string;
    };
    expect(pkg.name).toBe('my-app');

    const buildPkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')) as {
      scripts: { build: string; typecheck: string };
    };
    expect(buildPkg.scripts.build).toBe('tsc -p tsconfig.build.json');
    const buildConfig = JSON.parse(
      readFileSync(join(targetDir, 'tsconfig.build.json'), 'utf8'),
    ) as { extends: string; exclude: string[] };
    expect(buildConfig.extends).toBe('./tsconfig.json');
    expect(buildConfig.exclude).toContain('src/**/*.test.ts');

    const manifest = JSON.parse(readFileSync(join(targetDir, '.fastify-ep.json'), 'utf8'));
    expect(manifest).toEqual({
      schemaVersion: 2,
      fastifyEpVersion: '0.1.0',
      architecture: { schema: 'typebox', di: 'native', database: 'none' },
      modules: ['health'],
    });
  });

  it('rolls back the directory it created when the marker is missing', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));
    const targetDir = join(workDir, 'my-app');
    const templatesDir = makeUnmarkedTemplatesDir();

    expect(() =>
      scaffoldProject({ targetDir, projectName: 'my-app', cliVersion: '0.1.0', templatesDir }),
    ).toThrow(/fastify-ep:register/);
    expect(existsSync(targetDir)).toBe(false);
  });

  it('leaves a pre-existing target directory in place, rolling back only what it wrote', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));
    const targetDir = join(workDir, 'my-app');
    mkdirSync(targetDir);
    const templatesDir = makeUnmarkedTemplatesDir();

    expect(() =>
      scaffoldProject({ targetDir, projectName: 'my-app', cliVersion: '0.1.0', templatesDir }),
    ).toThrow(/fastify-ep:register/);
    expect(existsSync(targetDir)).toBe(true);
    expect(existsSync(join(targetDir, 'src'))).toBe(false);
    expect(existsSync(join(targetDir, 'package.json'))).toBe(false);
    expect(existsSync(join(targetDir, '.fastify-ep.json'))).toBe(false);
  });
});

describe('scaffoldProject with a database', () => {
  const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8');
  interface PackageJson {
    name: string;
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    engines: Record<string, string>;
  }
  const readJson = <T = PackageJson>(dir: string, file: string) => JSON.parse(read(dir, file)) as T;

  it.each(['drizzle', 'prisma'] as const)(
    '%s: overlays files, registers the plugin, records the strategy',
    (database) => {
      workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));
      const targetDir = join(workDir, 'my-app');

      scaffoldProject({ targetDir, projectName: 'my-app', cliVersion: '0.3.0', database });

      for (const file of [
        'src/infrastructure/database/database.plugin.ts',
        'src/infrastructure/database/database.types.ts',
        'docker-compose.yml',
        '.env.example',
      ]) {
        expect(existsSync(join(targetDir, file)), file).toBe(true);
      }
      expect(read(targetDir, 'src/config/env.ts')).toContain("required: ['DATABASE_URL']");
      expect(read(targetDir, 'vitest.config.ts')).toContain('DATABASE_URL');

      const appTs = read(targetDir, 'src/app.ts');
      const plugin =
        "await fastify.register((await import('./infrastructure/database/database.plugin.js')).default);";
      expect(appTs).toContain(plugin);
      // The database plugin is registered after env config and before any module.
      expect(appTs.indexOf('envPlugin);')).toBeLessThan(appTs.indexOf(plugin));
      expect(appTs.indexOf(plugin)).toBeLessThan(appTs.indexOf('health.module.js'));

      expect(
        readJson<{ architecture: { database: string } }>(targetDir, '.fastify-ep.json').architecture
          .database,
      ).toBe(database);
    },
  );

  it('drizzle: merges its dependencies into the base package.json', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));
    const targetDir = join(workDir, 'my-app');

    scaffoldProject({ targetDir, projectName: 'my-app', cliVersion: '0.3.0', database: 'drizzle' });

    const pkg = readJson(targetDir, 'package.json');
    expect(pkg.name).toBe('my-app');
    expect(pkg.dependencies).toMatchObject({
      fastify: expect.any(String),
      'drizzle-orm': expect.any(String),
      postgres: expect.any(String),
    });
    expect(pkg.devDependencies).toMatchObject({
      vitest: expect.any(String),
      'drizzle-kit': expect.any(String),
    });
    expect(pkg.scripts).toMatchObject({
      dev: expect.any(String),
      'db:generate': expect.any(String),
      'db:migrate': expect.any(String),
    });
    expect(existsSync(join(targetDir, 'drizzle.config.ts'))).toBe(true);
    expect(Object.keys(pkg.dependencies)).toEqual([...Object.keys(pkg.dependencies)].sort());
  });

  it('prisma: adds the Prisma 7 config, generate-on-install, and a Node floor', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));
    const targetDir = join(workDir, 'my-app');

    scaffoldProject({ targetDir, projectName: 'my-app', cliVersion: '0.3.0', database: 'prisma' });

    const pkg = readJson(targetDir, 'package.json');
    expect(pkg.scripts.postinstall).toBe('prisma generate');
    expect(pkg.engines.node).toBe('>=22.12');
    expect(pkg.dependencies['@prisma/client']).toMatch(/^\^7\./);
    expect(pkg.devDependencies.prisma).toMatch(/^\^7\./);
    expect(existsSync(join(targetDir, 'prisma/schema.prisma'))).toBe(true);
    expect(existsSync(join(targetDir, 'prisma.config.ts'))).toBe(true);
    expect(read(targetDir, '.gitignore')).toContain('src/generated/');
  });

  it('writes the template `gitignore` as `.gitignore` (npm drops files with that name)', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));
    const targetDir = join(workDir, 'my-app');

    scaffoldProject({ targetDir, projectName: 'my-app', cliVersion: '0.3.0' });

    expect(read(targetDir, '.gitignore')).toContain('node_modules/');
    expect(existsSync(join(targetDir, 'gitignore'))).toBe(false);
  });

  it('none: adds no database files and leaves package.json dependencies as the base', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));
    const targetDir = join(workDir, 'my-app');

    scaffoldProject({ targetDir, projectName: 'my-app', cliVersion: '0.3.0' });

    expect(existsSync(join(targetDir, 'src/infrastructure'))).toBe(false);
    expect(existsSync(join(targetDir, 'docker-compose.yml'))).toBe(false);
    expect(existsSync(join(targetDir, 'pnpm-workspace.yaml'))).toBe(false);
    expect(readJson(targetDir, 'package.json').dependencies).not.toHaveProperty('drizzle-orm');
  });

  it('writes pnpm-workspace.yaml allowBuilds only for pnpm, with Prisma builds enabled', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));

    scaffoldProject({
      targetDir: join(workDir, 'a'),
      projectName: 'a',
      cliVersion: '0.3.0',
      packageManager: 'pnpm',
    });
    scaffoldProject({
      targetDir: join(workDir, 'b'),
      projectName: 'b',
      cliVersion: '0.3.0',
      database: 'prisma',
      packageManager: 'pnpm',
    });
    scaffoldProject({
      targetDir: join(workDir, 'c'),
      projectName: 'c',
      cliVersion: '0.3.0',
      packageManager: 'yarn',
    });

    expect(read(join(workDir, 'a'), 'pnpm-workspace.yaml')).toContain('  esbuild: false');
    const prisma = read(join(workDir, 'b'), 'pnpm-workspace.yaml');
    expect(prisma).toContain('  prisma: true');
    expect(prisma).toContain("  '@prisma/engines': true");
    expect(existsSync(join(workDir, 'c', 'pnpm-workspace.yaml'))).toBe(false);
  });

  it('fails clearly when the database overlay does not exist', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));
    const targetDir = join(workDir, 'my-app');

    expect(() =>
      scaffoldProject({
        targetDir,
        projectName: 'my-app',
        cliVersion: '0.3.0',
        database: 'prisma',
        overlaysDir: join(workDir, 'nope'),
      }),
    ).toThrow(/no template overlay for database "prisma"/);
    expect(existsSync(targetDir)).toBe(false);
  });

  it('rolls back overlay files too when the infrastructure marker is missing, in a pre-existing dir', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));
    const targetDir = join(workDir, 'my-app');
    mkdirSync(targetDir);
    const templatesDir = makeUnmarkedTemplatesDir();
    const overlaysDir = join(workDir, 'overlays');
    mkdirSync(join(overlaysDir, 'drizzle'), { recursive: true });
    writeFileSync(join(overlaysDir, 'drizzle', 'docker-compose.yml'), 'services: {}\n');

    expect(() =>
      scaffoldProject({
        targetDir,
        projectName: 'my-app',
        cliVersion: '0.3.0',
        database: 'drizzle',
        templatesDir,
        overlaysDir,
      }),
    ).toThrow(/fastify-ep:infrastructure/);
    expect(existsSync(targetDir)).toBe(true);
    expect(existsSync(join(targetDir, 'docker-compose.yml'))).toBe(false);
    expect(existsSync(join(targetDir, 'src'))).toBe(false);
    expect(existsSync(join(targetDir, '.fastify-ep.json'))).toBe(false);
  });

  it('merges an overlay package.json into the base: objects combine, scripts keep base order, scalars replace', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));
    const targetDir = join(workDir, 'my-app');
    const templatesDir = mkdtempSync(join(tmpdir(), 'fastify-ep-templates-'));
    mkdirSync(join(templatesDir, 'src'), { recursive: true });
    writeFileSync(
      join(templatesDir, 'src/app.ts'),
      '// fastify-ep:infrastructure\n// fastify-ep:register\n',
    );
    writeFileSync(
      join(templatesDir, 'package.json'),
      JSON.stringify({
        name: '{{projectName}}',
        scripts: { dev: 'a', test: 'b' },
        dependencies: { zeta: '1', alpha: '1' },
      }),
    );
    const overlaysDir = join(workDir, 'overlays');
    mkdirSync(join(overlaysDir, 'drizzle'), { recursive: true });
    writeFileSync(
      join(overlaysDir, 'drizzle', 'package.json'),
      JSON.stringify({
        scripts: { 'db:migrate': 'c', test: 'override' },
        dependencies: { mid: '2' },
        engines: { node: '>=20' },
      }),
    );

    scaffoldProject({
      targetDir,
      projectName: 'my-app',
      cliVersion: '0.3.0',
      database: 'drizzle',
      templatesDir,
      overlaysDir,
    });
    rmSync(templatesDir, { recursive: true, force: true });

    const pkg = readJson(targetDir, 'package.json');
    expect(Object.keys(pkg.scripts)).toEqual(['dev', 'test', 'db:migrate']);
    expect(pkg.scripts.test).toBe('override');
    expect(Object.keys(pkg.dependencies)).toEqual(['alpha', 'mid', 'zeta']);
    expect(pkg.engines).toEqual({ node: '>=20' });
    expect(pkg.name).toBe('my-app');
  });
});
