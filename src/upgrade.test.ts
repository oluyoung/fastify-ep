import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LIBRARY_MARKER } from './find-project.js';
import { readManifest } from './manifest.js';
import { ProjectNewerThanCliError, UnsupportedVersionError } from './migrations/types.js';
import { scaffoldProject } from './scaffold.js';
import { upgradeProject } from './upgrade.js';

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function snapshot(dir: string, rel = ''): Record<string, string> {
  return Object.assign(
    {},
    ...readdirSync(join(dir, rel), { withFileTypes: true }).map((entry) =>
      entry.isDirectory()
        ? snapshot(dir, `${rel}${entry.name}/`)
        : { [`${rel}${entry.name}`]: readFileSync(join(dir, rel, entry.name), 'utf8') },
    ),
  );
}

/** A service that an older fastify-ep created: schema 2 manifest, old vitest range, no vite. */
function oldService(version = '0.7.0'): string {
  workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-upgrade-'));
  const root = join(workDir, 'demo-app');
  scaffoldProject({ targetDir: root, projectName: 'demo-app', cliVersion: '0.9.0' });
  const manifestPath = join(root, '.fastify-ep.json');
  const manifest = readManifest(manifestPath);
  delete manifest.files;
  delete manifest.architectureVersion;
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ ...manifest, schemaVersion: 2, fastifyEpVersion: version }, null, 2)}\n`,
  );
  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    devDependencies: Record<string, string>;
  };
  pkg.devDependencies.vitest = '^4.1.0';
  delete pkg.devDependencies.vite;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return root;
}

function oldLibrary(version: string): string {
  workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-upgrade-'));
  const root = join(workDir, 'contracts');
  mkdirSync(root);
  writeFileSync(
    join(root, LIBRARY_MARKER),
    `${JSON.stringify({ schemaVersion: 1, kind: 'library', fastifyEpVersion: version }, null, 2)}\n`,
  );
  return root;
}

describe('upgradeProject (service)', () => {
  it('reports what it did, applies it, and is up to date afterwards', () => {
    const root = oldService('0.6.1');

    const report = upgradeProject({ root, kind: 'service', cliVersion: '0.9.0' });

    expect(report).toMatchObject({
      format: 1,
      kind: 'service',
      from: '0.6.1',
      to: '0.9.0',
      dryRun: false,
      upToDate: false,
      installNeeded: true,
      review: [],
    });
    expect(report.migrations).toEqual(['0.6.1-to-0.7.0', '0.7.0-to-0.8.0', '0.8.0-to-0.9.0']);
    expect(readManifest(join(root, '.fastify-ep.json'))).toMatchObject({
      schemaVersion: 3,
      fastifyEpVersion: '0.9.0',
    });

    const again = upgradeProject({ root, kind: 'service', cliVersion: '0.9.0' });
    expect(again).toMatchObject({
      upToDate: true,
      changes: [],
      migrations: [],
      installNeeded: false,
    });
  });

  it('with dryRun writes nothing and reports the same changes a real run makes', () => {
    const root = oldService('0.7.0');
    const before = snapshot(root);

    const dry = upgradeProject({ root, kind: 'service', cliVersion: '0.9.0', dryRun: true });

    expect(snapshot(root)).toEqual(before);
    expect(dry.dryRun).toBe(true);
    const real = upgradeProject({ root, kind: 'service', cliVersion: '0.9.0' });
    expect(real.changes).toEqual(dry.changes);
    expect(real.review).toEqual(dry.review);
  });

  it('lists a file needing review once, however many migrations flagged it', () => {
    const root = oldService('0.6.1');
    const pkgPath = join(root, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    pkg.devDependencies.vitest = '^4.9.0';
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    const envPath = join(root, 'src/config/env.ts');
    writeFileSync(envPath, `// mine\n${readFileSync(envPath, 'utf8')}`);

    const report = upgradeProject({ root, kind: 'service', cliVersion: '0.9.0' });

    expect(report.review.map((r) => r.path).sort()).toEqual(['package.json', 'src/config/env.ts']);
    expect(report.review.every((r) => r.reasons.length >= 1)).toBe(true);
  });

  it('is JSON-serialisable without loss', () => {
    const root = oldService('0.7.0');

    const report = upgradeProject({ root, kind: 'service', cliVersion: '0.9.0', dryRun: true });

    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it('refuses a project older than 0.6.0 or newer than the CLI, leaving it untouched', () => {
    const old = oldService('0.5.0');
    const before = snapshot(old);
    expect(() => upgradeProject({ root: old, kind: 'service', cliVersion: '0.9.0' })).toThrow(
      UnsupportedVersionError,
    );
    expect(snapshot(old)).toEqual(before);

    const newer = oldService('1.2.0');
    expect(() => upgradeProject({ root: newer, kind: 'service', cliVersion: '0.9.0' })).toThrow(
      ProjectNewerThanCliError,
    );
  });
});

describe('upgradeProject (library)', () => {
  it('bumps only the marker version', () => {
    const root = oldLibrary('0.7.0');

    const report = upgradeProject({ root, kind: 'library', cliVersion: '0.9.0' });

    expect(report).toMatchObject({ kind: 'library', from: '0.7.0', to: '0.9.0', upToDate: false });
    expect(report.changes).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(root, LIBRARY_MARKER), 'utf8'))).toEqual({
      schemaVersion: 1,
      kind: 'library',
      fastifyEpVersion: '0.9.0',
    });
    expect(upgradeProject({ root, kind: 'library', cliVersion: '0.9.0' }).upToDate).toBe(true);
  });

  it('does not write in a dry run, and rejects unsupported or newer versions', () => {
    const root = oldLibrary('0.7.0');
    const before = snapshot(root);

    upgradeProject({ root, kind: 'library', cliVersion: '0.9.0', dryRun: true });
    expect(snapshot(root)).toEqual(before);

    expect(() =>
      upgradeProject({ root: oldLibrary('0.4.0'), kind: 'library', cliVersion: '0.9.0' }),
    ).toThrow(UnsupportedVersionError);
    expect(() =>
      upgradeProject({ root: oldLibrary('2.0.0'), kind: 'library', cliVersion: '0.9.0' }),
    ).toThrow(ProjectNewerThanCliError);
  });
});
