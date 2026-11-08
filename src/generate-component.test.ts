import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDoctorChecks } from './doctor.js';
import {
  generateComponent,
  ComponentInputError,
  ModuleNotFoundError,
} from './generate-component.js';
import { GenerationConflictError } from './generate-core.js';
import { generateModule } from './generate-module.js';
import { generateResource } from './generate-resource.js';
import { readManifest, type DatabaseStrategy, type DiStrategy } from './manifest.js';
import { scaffoldProject } from './scaffold.js';

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function project(database: DatabaseStrategy = 'none', di: DiStrategy = 'native'): string {
  workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-component-'));
  const dir = join(workDir, 'demo-app');
  scaffoldProject({ targetDir: dir, projectName: 'demo-app', cliVersion: '0.12.0', database, di });
  generateModule({ targetDir: dir, moduleName: 'orders' });
  if (database !== 'none') generateResource({ targetDir: dir, resourceName: 'users', crud: true });
  return dir;
}

const read = (dir: string, path: string): string => readFileSync(join(dir, path), 'utf8');
const failures = (dir: string) => runDoctorChecks(dir).filter((c) => !c.pass);

describe('generateComponent service', () => {
  it.each(['native', 'awilix'] as const)('adds and registers a service (%s)', (di) => {
    const dir = project('none', di);

    const result = generateComponent({
      targetDir: dir,
      kind: 'service',
      name: 'notifications',
      module: 'orders',
    });

    expect(result.wired).toBe(true);
    expect(result.files).toEqual([
      'src/modules/orders/notifications.service.test.ts',
      'src/modules/orders/notifications.service.ts',
    ]);
    expect(read(dir, 'src/modules/orders/notifications.service.ts')).toContain(
      'class NotificationsService',
    );
    const moduleFile = read(dir, 'src/modules/orders/orders.module.ts');
    expect(moduleFile).toContain("from './notifications.service.js'");
    expect(moduleFile).toContain('notificationsService');
    const files = readManifest(join(dir, '.fastify-ep.json')).files ?? {};
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        'src/modules/orders/notifications.service.ts',
        'src/modules/orders/orders.module.ts',
      ]),
    );
    expect(failures(dir)).toEqual([]);
  });

  it('uses a request-scoped lifetime when asked (Awilix)', () => {
    const dir = project('none', 'awilix');
    generateComponent({
      targetDir: dir,
      kind: 'service',
      name: 'notifications',
      module: 'orders',
      scope: 'request',
    });
    expect(read(dir, 'src/modules/orders/orders.module.ts')).toContain('Lifetime.SCOPED');
  });

  it('skips the test with withTests: false', () => {
    const dir = project();
    const result = generateComponent({
      targetDir: dir,
      kind: 'service',
      name: 'notifications',
      module: 'orders',
      withTests: false,
    });
    expect(result.files).toEqual(['src/modules/orders/notifications.service.ts']);
  });

  it('writes the file but leaves an edited module file alone, and says what to add', () => {
    const dir = project();
    const modulePath = join(dir, 'src/modules/orders/orders.module.ts');
    const edited = `// mine\n${read(dir, 'src/modules/orders/orders.module.ts').replace('registerDependencies', 'setUp')}`;
    writeFileSync(modulePath, edited);

    const result = generateComponent({
      targetDir: dir,
      kind: 'service',
      name: 'notifications',
      module: 'orders',
    });

    expect(result.wired).toBe(false);
    expect(read(dir, 'src/modules/orders/orders.module.ts')).toBe(edited);
    expect(existsSync(join(dir, 'src/modules/orders/notifications.service.ts'))).toBe(true);
    expect(result.notes.join('\n')).toContain("fastify.decorate('notificationsService'");
  });

  it('refuses an unknown module, and lists the real ones', () => {
    const dir = project();
    expect(() =>
      generateComponent({ targetDir: dir, kind: 'service', name: 'x', module: 'nope' }),
    ).toThrow(ModuleNotFoundError);
    expect(() =>
      generateComponent({ targetDir: dir, kind: 'service', name: 'x', module: 'nope' }),
    ).toThrow(/orders/);
    expect(() =>
      generateComponent({ targetDir: dir, kind: 'service', name: 'x', module: 'health' }),
    ).toThrow(ModuleNotFoundError);
  });

  it('refuses a file that already exists, including the module own service', () => {
    const dir = project();
    expect(() =>
      generateComponent({ targetDir: dir, kind: 'service', name: 'orders', module: 'orders' }),
    ).toThrow(GenerationConflictError);
  });

  it('refuses a key that another module already registers, and changes nothing', () => {
    const dir = project();
    generateModule({ targetDir: dir, moduleName: 'billing' });
    generateComponent({ targetDir: dir, kind: 'service', name: 'notifications', module: 'orders' });
    const before = read(dir, 'src/modules/billing/billing.module.ts');
    const manifest = read(dir, '.fastify-ep.json');

    expect(() =>
      generateComponent({
        targetDir: dir,
        kind: 'service',
        name: 'notifications',
        module: 'billing',
      }),
    ).toThrow(/already registered in orders\.module\.ts/);

    expect(read(dir, 'src/modules/billing/billing.module.ts')).toBe(before);
    expect(read(dir, '.fastify-ep.json')).toBe(manifest);
    expect(existsSync(join(dir, 'src/modules/billing/notifications.service.ts'))).toBe(false);
  });

  it('rejects an invalid name', () => {
    const dir = project();
    expect(() =>
      generateComponent({ targetDir: dir, kind: 'service', name: 'Bad Name', module: 'orders' }),
    ).toThrow(/invalid module name/);
  });

  it('refuses --model on a service', () => {
    const dir = project();
    expect(() =>
      generateComponent({
        targetDir: dir,
        kind: 'service',
        name: 'x',
        module: 'orders',
        model: 'User',
      }),
    ).toThrow(ComponentInputError);
  });
});

describe('generateComponent schema', () => {
  it('adds a schema file and registers nothing', () => {
    const dir = project();
    const moduleBefore = read(dir, 'src/modules/orders/orders.module.ts');

    const result = generateComponent({
      targetDir: dir,
      kind: 'schema',
      name: 'payments',
      module: 'orders',
    });

    expect(result.files).toEqual(['src/modules/orders/payments.schema.ts']);
    expect(read(dir, 'src/modules/orders/payments.schema.ts')).toContain('paymentsSchema');
    expect(read(dir, 'src/modules/orders/orders.module.ts')).toBe(moduleBefore);
    expect(failures(dir)).toEqual([]);
  });
});

describe('generateComponent repository', () => {
  it('needs a database', () => {
    const dir = project('none');
    expect(() =>
      generateComponent({
        targetDir: dir,
        kind: 'repository',
        name: 'audit',
        module: 'orders',
        model: 'User',
      }),
    ).toThrow(/needs a database/);
  });

  it('needs --model', () => {
    const dir = project('prisma');
    expect(() =>
      generateComponent({ targetDir: dir, kind: 'repository', name: 'audit', module: 'orders' }),
    ).toThrow(/needs --model/);
  });

  it('reads an existing Prisma model', () => {
    const dir = project('prisma');

    const result = generateComponent({
      targetDir: dir,
      kind: 'repository',
      name: 'audit',
      module: 'orders',
      model: 'User',
    });

    expect(result.wired).toBe(true);
    const repository = read(dir, 'src/modules/orders/audit.repository.ts');
    expect(repository).toContain('class AuditRepository');
    expect(repository).toContain('this.db.user.findMany()');
    expect(read(dir, 'src/modules/orders/orders.module.ts')).toContain(
      'new AuditRepository({ db: fastify.db })',
    );
    expect(read(dir, 'src/modules/orders/audit.repository.test.ts')).toContain('TEST_DATABASE_URL');
    expect(failures(dir)).toEqual([]);
  });

  it('reads an existing Drizzle table', () => {
    const dir = project('drizzle');

    generateComponent({
      targetDir: dir,
      kind: 'repository',
      name: 'audit',
      module: 'orders',
      model: 'usersTable',
    });

    const repository = read(dir, 'src/modules/orders/audit.repository.ts');
    expect(repository).toContain(
      "import { usersTable } from '../../infrastructure/database/schema.js';",
    );
    expect(failures(dir)).toEqual([]);
  });

  it('registers a repository with Awilix as a singleton', () => {
    const dir = project('drizzle', 'awilix');
    generateComponent({
      targetDir: dir,
      kind: 'repository',
      name: 'audit',
      module: 'orders',
      model: 'usersTable',
      scope: 'request',
    });
    expect(read(dir, 'src/modules/orders/orders.module.ts')).toContain(
      'auditRepository: asClass(AuditRepository, { lifetime: Lifetime.SINGLETON })',
    );
  });

  it.each([
    ['prisma', 'Ghost', /no model named Ghost/],
    ['prisma', 'user', /starts with a capital letter/],
    ['drizzle', 'ghostTable', /does not export a table named ghostTable/],
    ['drizzle', 'not valid', /not a valid identifier/],
  ] as const)('rejects a bad %s model (%s)', (database, model, message) => {
    const dir = project(database);
    expect(() =>
      generateComponent({
        targetDir: dir,
        kind: 'repository',
        name: 'audit',
        module: 'orders',
        model,
      }),
    ).toThrow(message);
  });

  it('rejects a model without a string id', () => {
    const dir = project('prisma');
    writeFileSync(
      join(dir, 'prisma/schema.prisma'),
      `${read(dir, 'prisma/schema.prisma')}\nmodel Counter {\n  n Int @id\n}\n`,
    );
    expect(() =>
      generateComponent({
        targetDir: dir,
        kind: 'repository',
        name: 'counts',
        module: 'orders',
        model: 'Counter',
      }),
    ).toThrow(/needs an "id String" field/);
  });
});
