import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModuleCollisionError, NotScaffoldedError, generateModule } from './generate-module.js';
import { LegacyManifestError } from './manifest.js';
import { MarkerNotFoundError } from './register-module.js';

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

/** A minimal fake scaffolded project: an app.ts with the marker + a manifest. */
function makeScaffoldedProject(database: 'none' | 'drizzle' | 'prisma' = 'none'): string {
  const dir = mkdtempSync(join(tmpdir(), 'fastify-ep-project-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src/app.ts'),
    [
      'export async function buildApp() {',
      '  // fastify-ep:register',
      '  return app;',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, '.fastify-ep.json'),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        fastifyEpVersion: '0.1.0',
        architecture: { schema: 'typebox', di: 'native', database },
        modules: ['health'],
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}

/** A minimal fake scaffolded project with a v1 (legacy) manifest. */
function makeLegacyScaffoldedProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fastify-ep-project-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src/app.ts'),
    [
      'export async function buildApp() {',
      '  // fastify-ep:register',
      '  return app;',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, '.fastify-ep.json'),
    `${JSON.stringify({ version: '0.1.0', diStrategy: 'native', modules: ['health'] }, null, 2)}\n`,
  );
  return dir;
}

describe('generateModule', () => {
  it('writes the 5 module files (including the test), inserts the register call, and appends to the manifest', () => {
    workDir = makeScaffoldedProject();

    generateModule({ targetDir: workDir, moduleName: 'orders' });

    for (const suffix of ['schema', 'service', 'controller', 'module', 'test']) {
      expect(existsSync(join(workDir, `src/modules/orders/orders.${suffix}.ts`))).toBe(true);
    }

    const appTs = readFileSync(join(workDir, 'src/app.ts'), 'utf8');
    expect(appTs).toContain(
      "await fastify.register((await import('./modules/orders/orders.module.js')).default);",
    );

    const manifest = JSON.parse(readFileSync(join(workDir, '.fastify-ep.json'), 'utf8'));
    expect(manifest.modules).toEqual(['health', 'orders']);
  });

  it('skips the test file when withTests is false', () => {
    workDir = makeScaffoldedProject();

    generateModule({ targetDir: workDir, moduleName: 'orders', withTests: false });

    expect(existsSync(join(workDir, 'src/modules/orders/orders.module.ts'))).toBe(true);
    expect(existsSync(join(workDir, 'src/modules/orders/orders.test.ts'))).toBe(false);
  });

  it('produces valid identifiers for hyphenated module names', () => {
    workDir = makeScaffoldedProject();

    generateModule({ targetDir: workDir, moduleName: 'user-profiles' });

    const serviceTs = readFileSync(
      join(workDir, 'src/modules/user-profiles/user-profiles.service.ts'),
      'utf8',
    );
    expect(serviceTs).toContain('class UserProfilesService');

    const moduleTs = readFileSync(
      join(workDir, 'src/modules/user-profiles/user-profiles.module.ts'),
      'utf8',
    );
    expect(moduleTs).toContain("fastify.decorate('userProfilesService'");
  });

  it('refuses when the target is not a scaffolded project', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-project-'));

    expect(() => generateModule({ targetDir: workDir, moduleName: 'orders' })).toThrow(
      NotScaffoldedError,
    );
    expect(existsSync(join(workDir, 'src/modules/orders'))).toBe(false);
  });

  it('refuses on module-name collision with the manifest', () => {
    workDir = makeScaffoldedProject();

    expect(() => generateModule({ targetDir: workDir, moduleName: 'health' })).toThrow(
      ModuleCollisionError,
    );
  });

  it('refuses on module-name collision with an existing directory', () => {
    workDir = makeScaffoldedProject();
    mkdirSync(join(workDir, 'src/modules/orders'), { recursive: true });

    expect(() => generateModule({ targetDir: workDir, moduleName: 'orders' })).toThrow(
      ModuleCollisionError,
    );
  });

  it('rolls back the module directory and leaves app.ts/manifest untouched when the marker is missing', () => {
    workDir = makeScaffoldedProject();
    const appTsPath = join(workDir, 'src/app.ts');
    const appTsBefore = readFileSync(appTsPath, 'utf8').replace('// fastify-ep:register\n', '');
    writeFileSync(appTsPath, appTsBefore);

    expect(() => generateModule({ targetDir: workDir, moduleName: 'orders' })).toThrow(
      MarkerNotFoundError,
    );

    expect(existsSync(join(workDir, 'src/modules/orders'))).toBe(false);
    expect(readFileSync(appTsPath, 'utf8')).toBe(appTsBefore);

    const manifest = JSON.parse(readFileSync(join(workDir, '.fastify-ep.json'), 'utf8'));
    expect(manifest.modules).toEqual(['health']);
  });

  it('refuses to operate on a legacy (v1) manifest with an explanatory error', () => {
    workDir = makeLegacyScaffoldedProject();

    expect(() => generateModule({ targetDir: workDir, moduleName: 'orders' })).toThrow(
      LegacyManifestError,
    );
    expect(existsSync(join(workDir, 'src/modules/orders'))).toBe(false);
  });

  it('exposes the project database strategy to module templates as {{database}}', () => {
    workDir = makeScaffoldedProject('drizzle');
    const moduleTemplateDir = mkdtempSync(join(tmpdir(), 'fastify-ep-module-template-'));
    writeFileSync(join(moduleTemplateDir, 'module.service.ts'), '// database: {{database}}\n');

    try {
      generateModule({ targetDir: workDir, moduleName: 'orders', moduleTemplateDir });
    } finally {
      rmSync(moduleTemplateDir, { recursive: true, force: true });
    }

    expect(readFileSync(join(workDir, 'src/modules/orders/orders.service.ts'), 'utf8')).toBe(
      '// database: drizzle\n',
    );
  });
});
