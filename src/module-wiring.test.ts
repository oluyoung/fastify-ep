import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { wireModule, wiringSnippets, type WiringParams } from './module-wiring.js';

const template = (dir: string): string =>
  readFileSync(fileURLToPath(new URL(`../${dir}/module.module.ts`, import.meta.url)), 'utf8');

const native: WiringParams = {
  di: 'native',
  kind: 'service',
  className: 'NotificationsService',
  key: 'notificationsService',
  importFile: 'notifications.service.js',
  withDb: false,
  lifetime: 'SINGLETON',
};

describe('wireModule', () => {
  it('adds the import, the type entry and the decorator to a native module', () => {
    const wired = wireModule(template('module-template'), native) as string;

    expect(wired).toContain(
      "import { NotificationsService } from './notifications.service.js';\n\ndeclare module 'fastify'",
    );
    expect(wired).toContain('    notificationsService: NotificationsService;\n  }\n}');
    expect(wired).toContain(
      "  fastify.decorate('notificationsService', new NotificationsService());\n}\n",
    );
  });

  it('passes the database to a repository', () => {
    const wired = wireModule(template('resource-template-crud-orm'), {
      ...native,
      kind: 'repository',
      className: 'AuditRepository',
      key: 'auditRepository',
      importFile: 'audit.repository.js',
      withDb: true,
    }) as string;

    expect(wired).toContain(
      "fastify.decorate('auditRepository', new AuditRepository({ db: fastify.db }));",
    );
  });

  it('adds a cradle entry and an asClass registration to an Awilix module', () => {
    const wired = wireModule(template('module-template-awilix'), {
      ...native,
      di: 'awilix',
      lifetime: 'SCOPED',
    }) as string;

    expect(wired).toContain('    notificationsService: NotificationsService;\n  }\n}');
    expect(wired).toContain(
      '    notificationsService: asClass(NotificationsService, { lifetime: Lifetime.SCOPED }),\n  });',
    );
  });

  it.each([
    ['no declare module block', 'export default 1;\n'],
    [
      'no registerDependencies',
      template('module-template').replace('registerDependencies', 'setUp'),
    ],
    [
      'an edited interface',
      template('module-template').replace('interface FastifyInstance', 'interface Mine'),
    ],
  ])('changes nothing when the module has %s', (_label, content) => {
    expect(wireModule(content, native)).toBeUndefined();
  });

  it('describes the three edits for a manual fix', () => {
    expect(wiringSnippets(native)).toEqual({
      importLine: "import { NotificationsService } from './notifications.service.js';",
      augmentation: '    notificationsService: NotificationsService;',
      registration: "  fastify.decorate('notificationsService', new NotificationsService());",
    });
  });
});
