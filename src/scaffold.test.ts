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
      scaffoldProject({
        targetDir,
        projectName: 'my-app',
        cliVersion: '0.1.0',
        templatesDir,
        preset: 'minimal',
      }),
    ).toThrow(/fastify-ep:register/);
    expect(existsSync(targetDir)).toBe(false);
  });

  it('leaves a pre-existing target directory in place, rolling back only what it wrote', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));
    const targetDir = join(workDir, 'my-app');
    mkdirSync(targetDir);
    const templatesDir = makeUnmarkedTemplatesDir();

    expect(() =>
      scaffoldProject({
        targetDir,
        projectName: 'my-app',
        cliVersion: '0.1.0',
        templatesDir,
        preset: 'minimal',
      }),
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
        preset: 'minimal',
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
        preset: 'minimal',
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
      preset: 'minimal',
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

describe('scaffoldProject with Awilix', () => {
  const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8');

  function scaffold(database: 'none' | 'drizzle' | 'prisma', di: 'native' | 'awilix' = 'awilix') {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));
    const targetDir = join(workDir, 'my-app');
    scaffoldProject({ targetDir, projectName: 'my-app', cliVersion: '0.4.0', database, di });
    return targetDir;
  }

  it('overlays the container plugin, merges dependencies, registers it, records the strategy', () => {
    const targetDir = scaffold('none');

    expect(existsSync(join(targetDir, 'src/infrastructure/di/container.plugin.ts'))).toBe(true);
    expect(existsSync(join(targetDir, 'src/infrastructure/di/di.types.ts'))).toBe(true);
    const pkg = JSON.parse(read(targetDir, 'package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies).toHaveProperty('@fastify/awilix');
    expect(pkg.dependencies).toHaveProperty('awilix');
    expect(pkg.dependencies).toHaveProperty('fastify');

    const appTs = read(targetDir, 'src/app.ts');
    const plugin =
      "await fastify.register((await import('./infrastructure/di/container.plugin.js')).default);";
    expect(appTs.indexOf('envPlugin);')).toBeLessThan(appTs.indexOf(plugin));
    expect(appTs.indexOf(plugin)).toBeLessThan(appTs.indexOf('health.module.js'));

    const manifest = JSON.parse(read(targetDir, '.fastify-ep.json')) as {
      architecture: { di: string };
    };
    expect(manifest.architecture.di).toBe('awilix');
  });

  it('without a database, leaves the container free of db registrations and unused imports', () => {
    const targetDir = scaffold('none');

    const plugin = read(targetDir, 'src/infrastructure/di/container.plugin.ts');
    expect(plugin).not.toContain('asValue');
    expect(plugin).not.toContain('diContainer');
    expect(read(targetDir, 'src/infrastructure/di/di.types.ts')).not.toContain('FastifyInstance');
  });

  it.each(['drizzle', 'prisma'] as const)(
    '%s: registers the db client in the container, after the database plugin',
    (database) => {
      const targetDir = scaffold(database);

      const plugin = read(targetDir, 'src/infrastructure/di/container.plugin.ts');
      expect(plugin).toContain("import { asValue } from 'awilix';");
      expect(plugin).toContain('diContainer.register({ db: asValue(fastify.db) });');
      expect(read(targetDir, 'src/infrastructure/di/di.types.ts')).toContain(
        "db: FastifyInstance['db'];",
      );

      const appTs = read(targetDir, 'src/app.ts');
      expect(appTs.indexOf('database.plugin.js')).toBeLessThan(
        appTs.indexOf('container.plugin.js'),
      );
    },
  );

  it('native: adds no DI files', () => {
    const targetDir = scaffold('none', 'native');

    expect(existsSync(join(targetDir, 'src/infrastructure/di'))).toBe(false);
    expect(read(targetDir, 'package.json')).not.toContain('awilix');
  });

  it('fails clearly when the DI overlay does not exist', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-scaffold-'));
    const targetDir = join(workDir, 'my-app');
    const overlaysDir = join(workDir, 'overlays');
    mkdirSync(overlaysDir);

    expect(() =>
      scaffoldProject({
        targetDir,
        projectName: 'my-app',
        cliVersion: '0.4.0',
        di: 'awilix',
        overlaysDir,
        preset: 'minimal',
      }),
    ).toThrow(/no template overlay for DI strategy "awilix"/);
    expect(existsSync(targetDir)).toBe(false);
  });
});

describe('scaffoldProject presets', () => {
  function scaffold(options: Partial<Parameters<typeof scaffoldProject>[0]>) {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-preset-'));
    const targetDir = join(workDir, 'my-app');
    scaffoldProject({ targetDir, projectName: 'my-app', cliVersion: '0.1.0', ...options });
    return targetDir;
  }
  const read = (dir: string, path: string) => readFileSync(join(dir, path), 'utf8');
  const manifestOf = (dir: string) =>
    JSON.parse(read(dir, '.fastify-ep.json')) as { architecture: { preset?: string } };
  const depsOf = (dir: string) =>
    (JSON.parse(read(dir, 'package.json')) as { dependencies: Record<string, string> })
      .dependencies;

  it('standard is the default: Swagger, no preset key, no security plugin, no Dockerfile', () => {
    const dir = scaffold({});
    expect(read(dir, 'src/app.ts')).toContain('swaggerUi');
    expect(depsOf(dir)['@fastify/swagger']).toBeDefined();
    expect(manifestOf(dir).architecture).not.toHaveProperty('preset');
    expect(existsSync(join(dir, 'Dockerfile'))).toBe(false);
    expect(existsSync(join(dir, 'src/infrastructure/http/security.plugin.ts'))).toBe(false);
    expect(read(dir, 'src/config/env.ts')).not.toContain('CORS_ORIGIN');
  });

  it('minimal has no Swagger and records the preset', () => {
    const dir = scaffold({ preset: 'minimal' });
    expect(read(dir, 'src/app.ts')).not.toContain('swagger');
    expect(depsOf(dir)['@fastify/swagger']).toBeUndefined();
    expect(depsOf(dir)['@fastify/swagger-ui']).toBeUndefined();
    expect(manifestOf(dir).architecture.preset).toBe('minimal');
    expect(existsSync(join(dir, 'src/errors/error-handler.ts'))).toBe(true);
  });

  it.each(['none', 'drizzle', 'prisma'] as const)(
    'production (%s) adds the security plugin, its dependencies and env keys',
    (database) => {
      const dir = scaffold({ preset: 'production', database });
      const appTs = read(dir, 'src/app.ts');
      expect(appTs).toContain(
        "await fastify.register((await import('./infrastructure/http/security.plugin.js')).default);",
      );
      expect(appTs).toContain('swaggerUi');
      const deps = depsOf(dir);
      for (const name of ['@fastify/helmet', '@fastify/cors', '@fastify/rate-limit']) {
        expect(deps[name], name).toBeDefined();
      }
      const env = read(dir, 'src/config/env.ts');
      expect(env).toContain("CORS_ORIGIN: { type: 'string', default: '' },");
      expect(env).toContain('RATE_LIMIT_MAX: number;');
      expect(read(dir, 'src/infrastructure/http/security.plugin.ts')).toContain("'RATE_LIMITED'");
      expect(manifestOf(dir).architecture.preset).toBe('production');
    },
  );

  it.each(['npm', 'pnpm', 'yarn'] as const)(
    'production generates only the %s Dockerfile',
    (packageManager) => {
      const dir = scaffold({ preset: 'production', packageManager });
      const dockerfile = read(dir, 'Dockerfile');
      const lockfile = { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' }[
        packageManager
      ];
      expect(dockerfile).toContain(lockfile);
      for (const other of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
        if (other !== lockfile) expect(dockerfile).not.toContain(other);
      }
      expect(existsSync(join(dir, '.dockerignore'))).toBe(true);
    },
  );

  it('production registers the security plugin before the DI container', () => {
    const dir = scaffold({ preset: 'production', database: 'drizzle', di: 'awilix' });
    const appTs = read(dir, 'src/app.ts');
    expect(appTs.indexOf('security.plugin')).toBeGreaterThan(-1);
    expect(appTs.indexOf('security.plugin')).toBeLessThan(appTs.indexOf('container.plugin'));
  });

  it('rolls back a production scaffold that fails', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-preset-'));
    const targetDir = join(workDir, 'my-app');
    expect(() =>
      scaffoldProject({
        targetDir,
        projectName: 'my-app',
        cliVersion: '0.1.0',
        preset: 'production',
        overlaysDir: join(workDir, 'nope'),
      }),
    ).toThrow(/no template overlay for preset "production"/);
    expect(existsSync(targetDir)).toBe(false);
  });
});
