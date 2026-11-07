import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashFile } from './file-hashes.js';
import { generateModule } from './generate-module.js';
import { generateResource } from './generate-resource.js';
import { MarkerNotFoundError } from './register-module.js';
import type { DatabaseStrategy, Manifest } from './manifest.js';
import { scaffoldProject } from './scaffold.js';

/* What `generate` does to the manifest's file hashes (schema 3), and that it leaves schema 2 alone. */

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function scaffold(database: DatabaseStrategy = 'none'): string {
  workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-hashes-'));
  const targetDir = join(workDir, 'demo-app');
  scaffoldProject({ targetDir, projectName: 'demo-app', cliVersion: '0.9.0', database });
  return targetDir;
}

function manifestOf(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, '.fastify-ep.json'), 'utf8')) as Manifest;
}

function writeRaw(dir: string, manifest: unknown): void {
  writeFileSync(join(dir, '.fastify-ep.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

describe('generate module / resource record file hashes', () => {
  it('tracks the new module files and keeps the app.ts hash in step with the registration', () => {
    const dir = scaffold();

    generateModule({ targetDir: dir, moduleName: 'orders' });

    const files = manifestOf(dir).files ?? {};
    for (const suffix of ['controller', 'module', 'schema', 'service', 'test']) {
      const path = `src/modules/orders/orders.${suffix}.ts`;
      expect(files[path], path).toBe(hashFile(join(dir, path)));
    }
    expect(files['src/app.ts']).toBe(hashFile(join(dir, 'src/app.ts')));
  });

  it('does not track a test file that was not generated', () => {
    const dir = scaffold();

    generateModule({ targetDir: dir, moduleName: 'orders', withTests: false });

    expect(manifestOf(dir).files).not.toHaveProperty(['src/modules/orders/orders.test.ts']);
  });

  it.each([
    ['drizzle', 'src/infrastructure/database/schema.ts'],
    ['prisma', 'prisma/schema.prisma'],
  ] as const)('refreshes the %s schema file that --crud appends to', (database, schemaPath) => {
    const dir = scaffold(database);
    const before = manifestOf(dir).files?.[schemaPath];

    generateResource({ targetDir: dir, resourceName: 'users', crud: true });

    const after = manifestOf(dir).files?.[schemaPath];
    expect(after).not.toBe(before);
    expect(after).toBe(hashFile(join(dir, schemaPath)));
    expect(manifestOf(dir).files?.['src/modules/users/users.repository.ts']).toBeDefined();
  });

  it('keeps the old hash for an app.ts the user edited, so it stays modified', () => {
    const dir = scaffold();
    const recorded = manifestOf(dir).files?.['src/app.ts'];
    const appTs = join(dir, 'src/app.ts');
    writeFileSync(appTs, `// my own comment\n${readFileSync(appTs, 'utf8')}`);

    generateModule({ targetDir: dir, moduleName: 'orders' });

    const files = manifestOf(dir).files ?? {};
    expect(files['src/app.ts']).toBe(recorded);
    expect(files['src/app.ts']).not.toBe(hashFile(appTs));
    expect(files['src/modules/orders/orders.service.ts']).toBeDefined();
  });

  it('does not start tracking an app.ts the manifest never listed', () => {
    const dir = scaffold();
    const manifest = manifestOf(dir);
    delete manifest.files?.['src/app.ts'];
    writeRaw(dir, manifest);

    generateModule({ targetDir: dir, moduleName: 'orders' });

    expect(manifestOf(dir).files).not.toHaveProperty(['src/app.ts']);
  });

  it('leaves a schema 2 manifest as schema 2 without adding files', () => {
    const dir = scaffold();
    const v2 = manifestOf(dir);
    delete v2.files;
    delete v2.architectureVersion;
    writeRaw(dir, { ...v2, schemaVersion: 2 });

    generateModule({ targetDir: dir, moduleName: 'orders' });
    generateResource({ targetDir: dir, resourceName: 'users' });

    const manifest = manifestOf(dir);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest).not.toHaveProperty('files');
    expect(manifest.modules).toEqual(['health', 'orders', 'users']);
  });

  it('leaves the manifest byte-identical when generation fails', () => {
    const dir = scaffold();
    const appTs = join(dir, 'src/app.ts');
    writeFileSync(appTs, readFileSync(appTs, 'utf8').replace('// fastify-ep:register', '// gone'));
    const before = readFileSync(join(dir, '.fastify-ep.json'), 'utf8');

    expect(() => generateModule({ targetDir: dir, moduleName: 'orders' })).toThrow(
      MarkerNotFoundError,
    );

    expect(readFileSync(join(dir, '.fastify-ep.json'), 'utf8')).toBe(before);
  });
});
