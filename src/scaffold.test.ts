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
