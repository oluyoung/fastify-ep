import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDoctorChecks } from './doctor.js';

let projectDir: string;

afterEach(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

function check(name: string, checks: ReturnType<typeof runDoctorChecks>) {
  const found = checks.find((c) => c.name === name);
  if (!found) throw new Error(`no check named "${name}"`);
  return found;
}

function makeValidProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fastify-ep-doctor-'));

  writeFileSync(
    join(dir, '.fastify-ep.json'),
    JSON.stringify({
      schemaVersion: 2,
      fastifyEpVersion: '0.2.0',
      architecture: { schema: 'typebox', di: 'native', database: 'none' },
      modules: ['health'],
    }),
  );

  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', dependencies: { fastify: '^5.0.0' } }),
  );

  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true } }),
  );

  mkdirSync(join(dir, 'src', 'config'), { recursive: true });
  writeFileSync(join(dir, 'src', 'config', 'env.ts'), '// env config\n');

  const healthDir = join(dir, 'src', 'modules', 'health');
  mkdirSync(healthDir, { recursive: true });
  for (const file of ['health.module.ts', 'health.controller.ts', 'health.service.ts', 'health.schema.ts']) {
    writeFileSync(join(healthDir, file), '// stub\n');
  }

  writeFileSync(
    join(dir, 'src', 'app.ts'),
    "await fastify.register((await import('./modules/health/health.module.js')).default);\n" +
      '// fastify-ep:register\n',
  );

  return dir;
}

describe('runDoctorChecks', () => {
  it('passes all checks for a well-formed project', () => {
    projectDir = makeValidProject();
    const checks = runDoctorChecks(projectDir);
    for (const c of checks) {
      expect(c.pass, `${c.name}: ${c.detail}`).toBe(true);
    }
  });

  it('fails "valid fastify-ep project" when the manifest is missing', () => {
    projectDir = makeValidProject();
    unlinkSync(join(projectDir, '.fastify-ep.json'));
    const checks = runDoctorChecks(projectDir);
    expect(check('valid fastify-ep project', checks).pass).toBe(false);
    expect(check('manifest schema valid', checks).pass).toBe(false);
  });

  it('fails "manifest schema valid" for a legacy manifest', () => {
    projectDir = makeValidProject();
    writeFileSync(
      join(projectDir, '.fastify-ep.json'),
      JSON.stringify({ version: '0.1.0', diStrategy: 'native', modules: ['health'] }),
    );
    const checks = runDoctorChecks(projectDir);
    expect(check('manifest schema valid', checks).pass).toBe(false);
  });

  it('fails "supported Fastify version" for an unsupported major', () => {
    projectDir = makeValidProject();
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { fastify: '^4.0.0' } }),
    );
    const checks = runDoctorChecks(projectDir);
    expect(check('supported Fastify version', checks).pass).toBe(false);
  });

  it('fails "all tracked modules exist" when a tracked module is missing on disk', () => {
    projectDir = makeValidProject();
    rmSync(join(projectDir, 'src', 'modules', 'health'), { recursive: true, force: true });
    const checks = runDoctorChecks(projectDir);
    expect(check('all tracked modules exist', checks).pass).toBe(false);
  });

  it('fails "all generated modules registered" when app.ts lacks the register line', () => {
    projectDir = makeValidProject();
    writeFileSync(join(projectDir, 'src', 'app.ts'), '// fastify-ep:register\n');
    const checks = runDoctorChecks(projectDir);
    expect(check('all generated modules registered', checks).pass).toBe(false);
  });

  it('fails "TypeScript strict mode enabled" when strict is false', () => {
    projectDir = makeValidProject();
    writeFileSync(
      join(projectDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: false } }),
    );
    const checks = runDoctorChecks(projectDir);
    expect(check('TypeScript strict mode enabled', checks).pass).toBe(false);
  });

  it('fails "environment configuration present" when src/config/env.ts is missing', () => {
    projectDir = makeValidProject();
    unlinkSync(join(projectDir, 'src', 'config', 'env.ts'));
    const checks = runDoctorChecks(projectDir);
    expect(check('environment configuration present', checks).pass).toBe(false);
  });

  it('fails "health module present" when a health file is missing', () => {
    projectDir = makeValidProject();
    unlinkSync(join(projectDir, 'src', 'modules', 'health', 'health.schema.ts'));
    const checks = runDoctorChecks(projectDir);
    expect(check('health module present', checks).pass).toBe(false);
  });
});
