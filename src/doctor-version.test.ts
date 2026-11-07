import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDoctorReport,
  doctorFails,
  runDoctorChecks,
  summarizeChecks,
  versionCheck,
} from './doctor.js';
import { LIBRARY_MARKER } from './find-project.js';
import { runLibraryChecks } from './library-doctor.js';
import { scaffoldProject } from './scaffold.js';

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function service(version: string): string {
  workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-doctor-'));
  const root = join(workDir, 'demo-app');
  scaffoldProject({ targetDir: root, projectName: 'demo-app', cliVersion: version });
  return root;
}

const NAME = 'created or migrated by this fastify-ep version';

describe('versionCheck', () => {
  it('passes when the versions match', () => {
    expect(versionCheck('Project', '0.9.0', '0.9.0')).toMatchObject({
      pass: true,
      severity: 'warning',
    });
  });

  it('warns to upgrade when the project is older, and to update when it is newer', () => {
    expect(versionCheck('Project', '0.8.0', '0.9.0')).toMatchObject({
      pass: false,
      severity: 'warning',
      detail: expect.stringContaining('fastify-ep upgrade'),
    });
    expect(versionCheck('Project', '1.0.0', '0.9.0').detail).toMatch(/update fastify-ep/);
  });

  it('warns about a version it cannot read instead of throwing', () => {
    expect(versionCheck('Project', 'dev', '0.9.0')).toMatchObject({ pass: false });
  });
});

describe('doctor and the project version', () => {
  it('has no such check unless the CLI version is given', () => {
    const root = service('0.8.0');

    expect(runDoctorChecks(root).some((c) => c.name === NAME)).toBe(false);
  });

  it('passes for a current project and warns for a stale one', () => {
    const current = runDoctorChecks(service('0.9.0'), { cliVersion: '0.9.0' });
    expect(current.find((c) => c.name === NAME)?.pass).toBe(true);
    expect(summarizeChecks(current)).toMatchObject({ errors: 0, warnings: 0 });

    const stale = runDoctorChecks(service('0.8.0'), { cliVersion: '0.9.0' });
    const summary = summarizeChecks(stale);
    expect(stale.find((c) => c.name === NAME)).toMatchObject({ pass: false, group: 'Project' });
    expect(summary).toMatchObject({ errors: 0, warnings: 1 });
    // A warning: plain doctor passes, --strict fails.
    expect(doctorFails(summary, false)).toBe(false);
    expect(doctorFails(summary, true)).toBe(true);
  });

  it('checks a library marker the same way', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-doctor-'));
    const dir = join(workDir, 'contracts');
    mkdirSync(dir);
    writeFileSync(
      join(dir, LIBRARY_MARKER),
      JSON.stringify({ schemaVersion: 1, kind: 'library', fastifyEpVersion: '0.7.0' }),
    );

    const check = runLibraryChecks(dir, { cliVersion: '0.9.0' }).find((c) => c.name === NAME);

    expect(check).toMatchObject({ pass: false, group: 'Libraries', severity: 'warning' });
  });
});

describe('buildDoctorReport (doctor --json, format 1)', () => {
  it('describes a clean project', () => {
    const root = service('0.9.0');
    const checks = runDoctorChecks(root, { cliVersion: '0.9.0' });

    const report = buildDoctorReport(root, 'service', checks, false);

    expect(report).toMatchObject({
      format: 1,
      project: root,
      kind: 'service',
      strict: false,
      ok: true,
      summary: { errors: 0, warnings: 0, total: checks.length },
    });
    expect(report.checks).toEqual(checks);
    expect(report.checks[0]).toEqual(
      expect.objectContaining({
        group: 'Project',
        severity: 'error',
        name: expect.any(String),
        pass: true,
      }),
    );
  });

  it('is ok with a warning unless strict, and never ok with an error', () => {
    const root = service('0.8.0');
    const checks = runDoctorChecks(root, { cliVersion: '0.9.0' });

    expect(buildDoctorReport(root, 'service', checks, false).ok).toBe(true);
    expect(buildDoctorReport(root, 'service', checks, true).ok).toBe(false);

    const broken = [
      ...checks,
      { group: 'Project' as const, severity: 'error' as const, name: 'x', pass: false },
    ];
    expect(buildDoctorReport(root, 'service', broken, false).ok).toBe(false);
  });

  it('round-trips through JSON and keeps rule ids and details', () => {
    const root = service('0.8.0');
    const checks = [
      ...runDoctorChecks(root, { cliVersion: '0.9.0' }),
      {
        group: 'Architecture' as const,
        severity: 'warning' as const,
        name: 'a.service.ts imports b.controller.ts',
        pass: false,
        rule: 'FEP-004/service-imports-controller',
      },
    ];

    const report = buildDoctorReport(root, 'service', checks, true);
    const parsed = JSON.parse(JSON.stringify(report)) as typeof report;

    expect(parsed.checks.at(-1)).toMatchObject({ rule: 'FEP-004/service-imports-controller' });
    expect(parsed.summary).toEqual(report.summary);
  });
});
