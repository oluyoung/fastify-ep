import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RULE_CONTROLLER_DATABASE,
  RULE_CROSS_MODULE,
  RULE_SERVER_BOUNDARY,
  RULE_SERVICE_CONTROLLER,
  RULE_TYPEBOX,
  runArchitectureChecks,
} from './architecture-checks.js';

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function write(path: string, content = ''): void {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** A project that follows every rule: two modules, a server entry point, TypeBox schemas. */
function makeProject(): void {
  dir = mkdtempSync(join(tmpdir(), 'fastify-ep-arch-'));
  write(
    'src/server.ts',
    "import { buildApp } from './app.js';\nawait (await buildApp()).listen({});\n",
  );
  write('src/app.ts', 'export async function buildApp() { return {}; }\n');
  for (const name of ['users', 'billing']) {
    write(`src/modules/${name}/${name}.schema.ts`, "import { Type } from '@sinclair/typebox';\n");
    write(
      `src/modules/${name}/${name}.service.ts`,
      `import type { X } from './${name}.schema.js';\n`,
    );
    write(
      `src/modules/${name}/${name}.controller.ts`,
      `import { schema } from './${name}.schema.js';\n`,
    );
  }
}

const failures = (rule: string) =>
  runArchitectureChecks(dir).filter((c) => c.rule === rule && !c.pass);
const passes = (rule: string) =>
  runArchitectureChecks(dir).filter((c) => c.rule === rule && c.pass);

describe('runArchitectureChecks', () => {
  it('passes every rule for a project that follows them', () => {
    makeProject();
    const checks = runArchitectureChecks(dir);
    expect(checks).toHaveLength(5);
    for (const c of checks) {
      expect(c.pass, `${c.name}: ${c.detail}`).toBe(true);
      expect(c.group).toBe('Architecture');
      expect(c.severity).toBe('warning');
      expect(c.rule).toMatch(/^FEP-\d{3}\//);
    }
  });

  describe(RULE_CROSS_MODULE, () => {
    it('flags a service importing another module controller, service or repository', () => {
      makeProject();
      write(
        'src/modules/billing/billing.service.ts',
        "import { a } from '../users/users.controller.js';\nimport { b } from '../users/users.service.js';\nimport { c } from '../users/users.repository.js';\n",
      );
      const found = failures(RULE_CROSS_MODULE);
      expect(found.map((c) => c.name)).toEqual([
        'billing/billing.service.ts imports users/users.controller.ts',
        'billing/billing.service.ts imports users/users.service.ts',
        'billing/billing.service.ts imports users/users.repository.ts',
      ]);
      expect(found[0].detail).toContain('src/modules/billing/billing.service.ts:1');
      expect(found.every((c) => c.severity === 'warning' && !c.pass)).toBe(true);
      expect(passes(RULE_CROSS_MODULE)).toHaveLength(0);
    });

    it.each([
      ['a type-only import', "import type { U } from '../users/users.service.js';"],
      ["another module's schema", "import { UserSchema } from '../users/users.schema.js';"],
      ["another module's table", "import { users } from '../users/users.table.js';"],
      ['a file in its own module', "import { x } from './billing.schema.js';"],
      ['a shared file outside modules', "import { AppError } from '../../errors/app-error.js';"],
      ['a package', "import { x } from 'users';"],
    ])('allows %s', (_label, line) => {
      makeProject();
      write('src/modules/billing/billing.service.ts', `${line}\n`);
      expect(failures(RULE_CROSS_MODULE)).toEqual([]);
    });

    it('ignores wiring outside modules, such as the app and the DI container', () => {
      makeProject();
      write(
        'src/infrastructure/di/container.plugin.ts',
        "import { UsersService } from '../../modules/users/users.service.js';\n",
      );
      write(
        'src/app.ts',
        "export async function buildApp() { return import('./modules/users/users.controller.js'); }\n",
      );
      expect(failures(RULE_CROSS_MODULE)).toEqual([]);
    });
  });

  describe(RULE_CONTROLLER_DATABASE, () => {
    it.each([
      ['drizzle-orm', "import { eq } from 'drizzle-orm';"],
      ['drizzle-orm/pg-core', "import { pgTable } from 'drizzle-orm/pg-core';"],
      ['postgres', "import postgres from 'postgres';"],
      ['@prisma/client', "import { PrismaClient } from '@prisma/client';"],
      [
        'the database folder',
        "import { db } from '../../infrastructure/database/database.plugin.js';",
      ],
      ['generated prisma code', "import { PrismaClient } from '../../generated/prisma/client.js';"],
    ])('flags a controller importing %s', (_label, line) => {
      makeProject();
      write('src/modules/users/users.controller.ts', `${line}\n`);
      const found = failures(RULE_CONTROLLER_DATABASE);
      expect(found).toHaveLength(1);
      expect(found[0].name).toContain('users/users.controller.ts imports');
      expect(found[0].detail).toContain('src/modules/users/users.controller.ts:1');
    });

    it('allows type-only database imports and database use outside controllers', () => {
      makeProject();
      write(
        'src/modules/users/users.controller.ts',
        "import type { PrismaClient } from '@prisma/client';\n",
      );
      write('src/modules/users/users.repository.ts', "import { eq } from 'drizzle-orm';\n");
      expect(failures(RULE_CONTROLLER_DATABASE)).toEqual([]);
      expect(passes(RULE_CONTROLLER_DATABASE)).toHaveLength(1);
    });
  });

  describe(RULE_SERVICE_CONTROLLER, () => {
    it('flags a service importing a controller, its own or another module', () => {
      makeProject();
      write(
        'src/modules/users/users.service.ts',
        "import { a } from './users.controller.js';\nimport { b } from '../billing/billing.controller.js';\n",
      );
      expect(failures(RULE_SERVICE_CONTROLLER).map((c) => c.name)).toEqual([
        'users/users.service.ts imports users/users.controller.ts',
        'users/users.service.ts imports billing/billing.controller.ts',
      ]);
    });

    it('allows a controller importing a service', () => {
      makeProject();
      write('src/modules/users/users.controller.ts', "import { s } from './users.service.js';\n");
      expect(failures(RULE_SERVICE_CONTROLLER)).toEqual([]);
    });
  });

  describe(RULE_TYPEBOX, () => {
    it('flags a module schema that does not import TypeBox', () => {
      makeProject();
      write('src/modules/users/users.schema.ts', "import { z } from 'zod';\n");
      const found = failures(RULE_TYPEBOX);
      expect(found.map((c) => c.name)).toEqual(['users/users.schema.ts does not use TypeBox']);
    });

    it('accepts a schema that imports a TypeBox subpath or re-exports from it', () => {
      makeProject();
      write(
        'src/modules/users/users.schema.ts',
        "import { Value } from '@sinclair/typebox/value';\n",
      );
      write('src/modules/billing/billing.schema.ts', "export * from '@sinclair/typebox';\n");
      expect(failures(RULE_TYPEBOX)).toEqual([]);
    });

    it('does not look at schema files outside modules', () => {
      makeProject();
      write('src/config/env.schema.ts', 'export const x = 1;\n');
      expect(failures(RULE_TYPEBOX)).toEqual([]);
    });
  });

  describe(RULE_SERVER_BOUNDARY, () => {
    it('flags app.ts calling listen()', () => {
      makeProject();
      write(
        'src/app.ts',
        'export async function buildApp() {\n  const f = Fastify();\n  await f.listen({ port: 3000 });\n  return f;\n}\n',
      );
      const found = failures(RULE_SERVER_BOUNDARY);
      expect(found).toHaveLength(1);
      expect(found[0].detail).toContain('src/app.ts:3');
    });

    it('does not mistake a comment or a string for a listen() call', () => {
      makeProject();
      write('src/app.ts', "// f.listen(3000)\nconst s = 'f.listen(3000)';\n");
      expect(failures(RULE_SERVER_BOUNDARY)).toEqual([]);
    });

    it('flags a missing server.ts', () => {
      makeProject();
      rmSync(join(dir, 'src/server.ts'));
      expect(failures(RULE_SERVER_BOUNDARY).map((c) => c.name)).toEqual([
        'src/server.ts is missing',
      ]);
    });
  });

  it('stays silent about a file it cannot tokenise', () => {
    makeProject();
    write('src/modules/users/users.service.ts', "const broken = 'oops;\n");
    expect(runArchitectureChecks(dir).every((c) => c.pass)).toBe(true);
  });
});

describe('fastify-ep-ignore', () => {
  const infos = () => runArchitectureChecks(dir).filter((c) => c.severity === 'info');

  it('silences the named rule on the line below the comment', () => {
    makeProject();
    write(
      'src/modules/billing/billing.service.ts',
      "// fastify-ep-ignore FEP-002/cross-module-import\nimport { a } from '../users/users.service.js';\n",
    );
    expect(failures(RULE_CROSS_MODULE)).toEqual([]);
    expect(passes(RULE_CROSS_MODULE)).toHaveLength(1);
    expect(infos()).toEqual([]);
  });

  it('silences only the findings it names', () => {
    makeProject();
    write(
      'src/modules/users/users.service.ts',
      "// fastify-ep-ignore FEP-002/cross-module-import\nimport { a } from '../billing/billing.controller.js';\n",
    );
    expect(failures(RULE_CROSS_MODULE)).toEqual([]);
    expect(failures(RULE_SERVICE_CONTROLLER)).toHaveLength(1);
  });

  it('can name several rules at once', () => {
    makeProject();
    write(
      'src/modules/users/users.service.ts',
      "// fastify-ep-ignore FEP-002/cross-module-import FEP-004/service-imports-controller\nimport { a } from '../billing/billing.controller.js';\n",
    );
    expect(failures(RULE_CROSS_MODULE)).toEqual([]);
    expect(failures(RULE_SERVICE_CONTROLLER)).toEqual([]);
    expect(infos()).toEqual([]);
  });

  it('does not reach a finding two lines below, or on the same line', () => {
    makeProject();
    write(
      'src/modules/billing/billing.service.ts',
      "// fastify-ep-ignore FEP-002/cross-module-import\n\nimport { a } from '../users/users.service.js';\n",
    );
    expect(failures(RULE_CROSS_MODULE)).toHaveLength(1);
    expect(infos().map((c) => c.name)).toEqual([
      'unused fastify-ep-ignore at src/modules/billing/billing.service.ts:1',
    ]);
    write(
      'src/modules/billing/billing.service.ts',
      "import { a } from '../users/users.service.js'; // fastify-ep-ignore FEP-002/cross-module-import\n",
    );
    expect(failures(RULE_CROSS_MODULE)).toHaveLength(1);
  });

  it('silences a whole-file finding from anywhere in the file', () => {
    makeProject();
    write(
      'src/modules/users/users.schema.ts',
      "import { z } from 'zod';\n\n// fastify-ep-ignore FEP-005/typebox-schemas\nexport const x = z.string();\n",
    );
    expect(failures(RULE_TYPEBOX)).toEqual([]);
    expect(infos()).toEqual([]);
  });

  it('silences the listen() finding in app.ts', () => {
    makeProject();
    write('src/app.ts', '// fastify-ep-ignore FEP-001/server-boundary\nawait f.listen({});\n');
    expect(failures(RULE_SERVER_BOUNDARY)).toEqual([]);
  });

  it('cannot silence a missing server.ts, which has no place to put the comment', () => {
    makeProject();
    rmSync(join(dir, 'src/server.ts'));
    write('src/app.ts', '// fastify-ep-ignore FEP-001/server-boundary\n');
    expect(failures(RULE_SERVER_BOUNDARY)).toHaveLength(1);
    expect(infos()).toHaveLength(1);
  });

  it.each([
    ['// fastify-ep-ignore', 'fastify-ep-ignore at src/app.ts:1 names no rule'],
    [
      '// fastify-ep-ignore FEP-999/nope',
      'fastify-ep-ignore at src/app.ts:1 names an unknown rule',
    ],
    [
      '// fastify-ep-ignore FEP-002/cross-module-import',
      'unused fastify-ep-ignore at src/app.ts:1',
    ],
  ])('reports %s as an info line that does not count', (comment, name) => {
    makeProject();
    write('src/app.ts', `${comment}\n`);
    const found = infos();
    expect(found.map((c) => c.name)).toEqual([name]);
    expect(found[0]).toMatchObject({ group: 'Architecture', pass: true });
    expect(runArchitectureChecks(dir).filter((c) => !c.pass)).toEqual([]);
  });

  it('reports a file it cannot read as an info line', () => {
    makeProject();
    write('src/modules/users/users.service.ts', "const broken = 'oops;\n");
    const found = infos();
    expect(found.map((c) => c.name)).toEqual([
      'src/modules/users/users.service.ts was not scanned',
    ]);
    expect(found[0].detail).toContain('unterminated string');
  });
});
