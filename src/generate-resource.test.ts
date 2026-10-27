import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  InvalidModuleNameError,
  ModuleCollisionError,
  NotScaffoldedError,
  generateModule,
} from './generate-module.js';
import { InvalidSingularNameError, generateResource } from './generate-resource.js';
import { GenerationConflictError, ProjectFileMissingError } from './generate-core.js';
import { MarkerNotFoundError } from './register-module.js';

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

/** A minimal fake scaffolded project: an app.ts with the marker + a manifest. */
function makeScaffoldedProject(
  database: 'none' | 'drizzle' | 'prisma' = 'none',
  di: 'native' | 'awilix' = 'native',
): string {
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
  if (database === 'drizzle') {
    mkdirSync(join(dir, 'src/infrastructure/database'), { recursive: true });
    writeFileSync(
      join(dir, 'src/infrastructure/database/schema.ts'),
      '// Define your tables here.\nexport {};\n',
    );
  }
  if (database === 'prisma') {
    mkdirSync(join(dir, 'prisma'), { recursive: true });
    writeFileSync(
      join(dir, 'prisma/schema.prisma'),
      'datasource db {\n  provider = "postgresql"\n}\n',
    );
  }
  writeFileSync(
    join(dir, '.fastify-ep.json'),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        fastifyEpVersion: '0.5.0',
        architecture: { schema: 'typebox', di, database },
        modules: ['health'],
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}

function read(relativePath: string): string {
  return readFileSync(join(workDir, relativePath), 'utf8');
}

describe('generateResource (native)', () => {
  it('writes the module files plus a repository, registers it and records it in the manifest', () => {
    workDir = makeScaffoldedProject();

    generateResource({ targetDir: workDir, resourceName: 'users' });

    for (const suffix of ['controller', 'module', 'schema', 'service', 'repository', 'test']) {
      expect(existsSync(join(workDir, `src/modules/users/users.${suffix}.ts`))).toBe(true);
    }
    expect(read('src/app.ts')).toContain(
      "await fastify.register((await import('./modules/users/users.module.js')).default);",
    );
    expect(JSON.parse(read('.fastify-ep.json')).modules).toEqual(['health', 'users']);
  });

  it('renders the entity name from the singular of the resource name', () => {
    workDir = makeScaffoldedProject();

    generateResource({ targetDir: workDir, resourceName: 'user-profiles' });

    const schema = read('src/modules/user-profiles/user-profiles.schema.ts');
    expect(schema).toContain('export type UserProfile = Static<typeof userProfileSchema>');
    const repository = read('src/modules/user-profiles/user-profiles.repository.ts');
    expect(repository).toContain('class UserProfilesRepository');
    expect(repository).toContain('Promise<UserProfile[]>');
  });

  it('uses --singular instead of the naive singular', () => {
    workDir = makeScaffoldedProject();

    generateResource({ targetDir: workDir, resourceName: 'people', singular: 'person' });

    expect(read('src/modules/people/people.schema.ts')).toContain('export type Person =');
  });

  it('decorates the repository and hands it to the service', () => {
    workDir = makeScaffoldedProject();

    generateResource({ targetDir: workDir, resourceName: 'users' });

    const moduleTs = read('src/modules/users/users.module.ts');
    expect(moduleTs).toContain("fastify.decorate('usersRepository', new UsersRepository())");
    expect(moduleTs).toContain('usersRepository: fastify.usersRepository');
    expect(moduleTs).not.toContain('awilix');
  });

  it('skips the test file with withTests: false', () => {
    workDir = makeScaffoldedProject();

    generateResource({ targetDir: workDir, resourceName: 'users', withTests: false });

    expect(existsSync(join(workDir, 'src/modules/users/users.test.ts'))).toBe(false);
    expect(existsSync(join(workDir, 'src/modules/users/users.repository.ts'))).toBe(true);
  });

  it('leaves no unrendered placeholders', () => {
    workDir = makeScaffoldedProject();

    generateResource({ targetDir: workDir, resourceName: 'user-profiles' });

    for (const suffix of ['controller', 'module', 'schema', 'service', 'repository', 'test']) {
      expect(read(`src/modules/user-profiles/user-profiles.${suffix}.ts`)).not.toContain('{{');
    }
  });
});

describe('generateResource (safety)', () => {
  it.each(['../x', 'Foo Bar', 'userProfiles', ''])(
    'refuses the invalid resource name "%s" without writing anything',
    (resourceName) => {
      workDir = makeScaffoldedProject();

      expect(() => generateResource({ targetDir: workDir, resourceName })).toThrow(
        InvalidModuleNameError,
      );
      expect(existsSync(join(workDir, 'src/modules'))).toBe(false);
    },
  );

  it('refuses an invalid --singular without writing anything', () => {
    workDir = makeScaffoldedProject();

    expect(() =>
      generateResource({ targetDir: workDir, resourceName: 'users', singular: 'User!' }),
    ).toThrow(InvalidSingularNameError);
    expect(existsSync(join(workDir, 'src/modules'))).toBe(false);
  });

  it('refuses when the target is not a scaffolded project', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-project-'));

    expect(() => generateResource({ targetDir: workDir, resourceName: 'users' })).toThrow(
      NotScaffoldedError,
    );
  });

  it('collides with an existing module of the same name', () => {
    workDir = makeScaffoldedProject();
    generateModule({ targetDir: workDir, moduleName: 'users' });

    expect(() => generateResource({ targetDir: workDir, resourceName: 'users' })).toThrow(
      ModuleCollisionError,
    );
  });

  it('collides with an existing resource of the same name', () => {
    workDir = makeScaffoldedProject();
    generateResource({ targetDir: workDir, resourceName: 'users' });

    expect(() => generateResource({ targetDir: workDir, resourceName: 'users' })).toThrow(
      ModuleCollisionError,
    );
  });

  it('rolls back when the registration marker is missing', () => {
    workDir = makeScaffoldedProject();
    const appTsPath = join(workDir, 'src/app.ts');
    const appTsBefore = read('src/app.ts').replace('// fastify-ep:register\n', '');
    writeFileSync(appTsPath, appTsBefore);

    expect(() => generateResource({ targetDir: workDir, resourceName: 'users' })).toThrow(
      MarkerNotFoundError,
    );

    expect(existsSync(join(workDir, 'src/modules/users'))).toBe(false);
    expect(read('src/app.ts')).toBe(appTsBefore);
    expect(JSON.parse(read('.fastify-ep.json')).modules).toEqual(['health']);
  });
});

describe('generateResource (Awilix)', () => {
  it('registers repository and service in the container', () => {
    workDir = makeScaffoldedProject('none', 'awilix');

    generateResource({ targetDir: workDir, resourceName: 'users' });

    const moduleTs = read('src/modules/users/users.module.ts');
    expect(moduleTs).toContain("declare module '@fastify/awilix'");
    expect(moduleTs).toContain('usersRepository: asClass(UsersRepository, {');
    expect(moduleTs).toContain(
      'usersService: asClass(UsersService, { lifetime: Lifetime.SINGLETON })',
    );
    expect(moduleTs).not.toContain('fastify.decorate');
    expect(read('src/modules/users/users.controller.ts')).toContain(
      "request.diScope.resolve('usersService')",
    );
    expect(read('src/modules/users/users.service.ts')).toContain('constructor({ usersRepository }');
  });

  it('scopes the service per request but keeps the repository a singleton', () => {
    workDir = makeScaffoldedProject('none', 'awilix');

    generateResource({ targetDir: workDir, resourceName: 'users', scope: 'request' });

    const moduleTs = read('src/modules/users/users.module.ts');
    expect(moduleTs).toContain('lifetime: Lifetime.SCOPED');
    expect(moduleTs).toContain('lifetime: Lifetime.SINGLETON,');
  });

  it('still writes the repository and schema from the base template', () => {
    workDir = makeScaffoldedProject('none', 'awilix');

    generateResource({ targetDir: workDir, resourceName: 'users' });

    expect(existsSync(join(workDir, 'src/modules/users/users.repository.ts'))).toBe(true);
    expect(read('src/modules/users/users.schema.ts')).toContain('export type User =');
  });
});

const CRUD_ROUTES = [
  "'/users'",
  "'/users/:id'",
  'fastify.post<',
  'fastify.get(',
  'fastify.get<',
  'fastify.patch<',
  'fastify.delete<',
];

describe('generateResource --crud (no database)', () => {
  it('serves the five CRUD routes from an in-memory repository', () => {
    workDir = makeScaffoldedProject();

    const result = generateResource({ targetDir: workDir, resourceName: 'users', crud: true });

    const controller = read('src/modules/users/users.controller.ts');
    for (const fragment of CRUD_ROUTES) expect(controller).toContain(fragment);
    expect(read('src/modules/users/users.repository.ts')).toContain('new Map<string, User>()');
    expect(read('src/modules/users/users.service.ts')).toContain("new AppError('NOT_FOUND'");
    expect(read('src/modules/users/users.test.ts')).toContain('buildApp');
    expect(result.notes).toEqual([]);
    expect(existsSync(join(workDir, 'src/modules/users/users.table.ts'))).toBe(false);
  });

  it('renders create/update schemas from the entity name', () => {
    workDir = makeScaffoldedProject();

    generateResource({ targetDir: workDir, resourceName: 'user-profiles', crud: true });

    const schema = read('src/modules/user-profiles/user-profiles.schema.ts');
    expect(schema).toContain('export const createUserProfileBodySchema');
    expect(schema).toContain('export const updateUserProfileBodySchema = Type.Partial(');
    expect(schema).toContain('export const userProfilesListSchema');
  });

  it('leaves no unrendered placeholders', () => {
    for (const [database, di] of [
      ['none', 'native'],
      ['none', 'awilix'],
      ['drizzle', 'native'],
      ['drizzle', 'awilix'],
      ['prisma', 'native'],
      ['prisma', 'awilix'],
    ] as const) {
      workDir = makeScaffoldedProject(database, di);
      generateResource({ targetDir: workDir, resourceName: 'user-profiles', crud: true });
      for (const file of [
        'controller',
        'module',
        'schema',
        'service',
        'repository',
        'test',
        ...(database === 'drizzle' ? ['table'] : []),
      ]) {
        expect(
          read(`src/modules/user-profiles/user-profiles.${file}.ts`),
          `${database}/${di} ${file}`,
        ).not.toContain('{{');
      }
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('resolves the service from the request scope in Awilix projects', () => {
    workDir = makeScaffoldedProject('none', 'awilix');

    generateResource({ targetDir: workDir, resourceName: 'users', crud: true });

    const controller = read('src/modules/users/users.controller.ts');
    expect(controller).toContain("request.diScope.resolve('usersService').create(request.body)");
    expect(controller).toContain("request.diScope.resolve('usersService').list()");
    expect(controller).not.toContain('fastify.usersService');
    expect(read('src/modules/users/users.module.ts')).toContain("declare module '@fastify/awilix'");
  });
});

describe('generateResource --crud (drizzle)', () => {
  it('generates a table, a drizzle repository and exports the table from schema.ts', () => {
    workDir = makeScaffoldedProject('drizzle');

    const result = generateResource({
      targetDir: workDir,
      resourceName: 'user-profiles',
      crud: true,
    });

    expect(read('src/modules/user-profiles/user-profiles.table.ts')).toContain(
      "pgTable('user_profiles'",
    );
    const repository = read('src/modules/user-profiles/user-profiles.repository.ts');
    expect(repository).toContain("from './user-profiles.table.js'");
    expect(repository).toContain("FastifyInstance['db']");
    expect(read('src/modules/user-profiles/user-profiles.module.ts')).toContain(
      'new UserProfilesRepository({ db: fastify.db })',
    );
    expect(read('src/infrastructure/database/schema.ts')).toBe(
      "// Define your tables here.\nexport {};\nexport * from '../../modules/user-profiles/user-profiles.table.js';\n",
    );
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('db:generate');
  });

  it('tests the service against a stand-in repository, not the database', () => {
    workDir = makeScaffoldedProject('drizzle');

    generateResource({ targetDir: workDir, resourceName: 'users', crud: true });

    const test = read('src/modules/users/users.test.ts');
    expect(test).toContain('fakeRepository');
    expect(test).not.toContain('buildApp');
  });

  it('registers the repository in the container with the database as a dependency (Awilix)', () => {
    workDir = makeScaffoldedProject('drizzle', 'awilix');

    generateResource({ targetDir: workDir, resourceName: 'users', crud: true });

    const moduleTs = read('src/modules/users/users.module.ts');
    expect(moduleTs).toContain('usersRepository: asClass(UsersRepository');
    expect(moduleTs).not.toContain('fastify.db');
    expect(read('src/modules/users/users.repository.ts')).toContain('constructor({ db }');
  });

  it('refuses when schema.ts already defines the table, writing nothing', () => {
    workDir = makeScaffoldedProject('drizzle');
    const schemaPath = join(workDir, 'src/infrastructure/database/schema.ts');
    writeFileSync(schemaPath, "export const users = pgTable('users', {});\n");

    expect(() =>
      generateResource({ targetDir: workDir, resourceName: 'users', crud: true }),
    ).toThrow(GenerationConflictError);

    expect(existsSync(join(workDir, 'src/modules/users'))).toBe(false);
    expect(read('src/app.ts')).not.toContain('users');
  });

  it('refuses when schema.ts is missing', () => {
    workDir = makeScaffoldedProject('drizzle');
    rmSync(join(workDir, 'src/infrastructure/database/schema.ts'));

    expect(() =>
      generateResource({ targetDir: workDir, resourceName: 'users', crud: true }),
    ).toThrow(ProjectFileMissingError);
    expect(existsSync(join(workDir, 'src/modules/users'))).toBe(false);
  });

  it('restores schema.ts and everything else when the manifest cannot be written', () => {
    workDir = makeScaffoldedProject('drizzle');
    const schemaPath = join(workDir, 'src/infrastructure/database/schema.ts');
    const schemaBefore = readFileSync(schemaPath, 'utf8');
    const appTsBefore = read('src/app.ts');
    chmodSync(join(workDir, '.fastify-ep.json'), 0o444);

    // root ignores file permissions, so the write would not fail
    if (process.getuid?.() === 0) return;
    expect(() =>
      generateResource({ targetDir: workDir, resourceName: 'users', crud: true }),
    ).toThrow(/EACCES/);

    expect(readFileSync(schemaPath, 'utf8')).toBe(schemaBefore);
    expect(read('src/app.ts')).toBe(appTsBefore);
    expect(existsSync(join(workDir, 'src/modules/users'))).toBe(false);
  });

  it('does not touch schema.ts without --crud', () => {
    workDir = makeScaffoldedProject('drizzle');
    const schemaBefore = read('src/infrastructure/database/schema.ts');

    generateResource({ targetDir: workDir, resourceName: 'users' });

    expect(read('src/infrastructure/database/schema.ts')).toBe(schemaBefore);
    expect(existsSync(join(workDir, 'src/modules/users/users.table.ts'))).toBe(false);
  });
});

describe('generateResource --crud (prisma)', () => {
  it('appends a model to schema.prisma and generates a prisma repository', () => {
    workDir = makeScaffoldedProject('prisma');

    const result = generateResource({
      targetDir: workDir,
      resourceName: 'user-profiles',
      crud: true,
    });

    const schema = read('prisma/schema.prisma');
    expect(schema).toContain('model UserProfile {');
    expect(schema).toContain('id   String @id @default(uuid())');
    expect(schema).toContain('@@map("user_profiles")');
    expect(schema.startsWith('datasource db {')).toBe(true);
    expect(read('src/modules/user-profiles/user-profiles.repository.ts')).toContain(
      'this.db.userProfile.findMany()',
    );
    expect(existsSync(join(workDir, 'src/modules/user-profiles/user-profiles.table.ts'))).toBe(
      false,
    );
    expect(result.notes[0]).toContain('UserProfile model');
  });

  it('refuses when the model already exists, writing nothing', () => {
    workDir = makeScaffoldedProject('prisma');
    const schemaPath = join(workDir, 'prisma/schema.prisma');
    writeFileSync(schemaPath, 'model User {\n  id String @id\n}\n');

    expect(() =>
      generateResource({ targetDir: workDir, resourceName: 'users', crud: true }),
    ).toThrow(GenerationConflictError);

    expect(existsSync(join(workDir, 'src/modules/users'))).toBe(false);
    expect(readFileSync(schemaPath, 'utf8')).toBe('model User {\n  id String @id\n}\n');
  });

  it('restores schema.prisma when registration fails after the module was written', () => {
    workDir = makeScaffoldedProject('prisma');
    const schemaBefore = read('prisma/schema.prisma');
    writeFileSync(
      join(workDir, 'src/app.ts'),
      read('src/app.ts').replace('// fastify-ep:register\n', ''),
    );

    expect(() =>
      generateResource({ targetDir: workDir, resourceName: 'users', crud: true }),
    ).toThrow(MarkerNotFoundError);

    expect(read('prisma/schema.prisma')).toBe(schemaBefore);
  });
});
