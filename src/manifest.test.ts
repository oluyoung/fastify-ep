import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  InvalidManifestError,
  LegacyManifestError,
  NewerManifestError,
  readManifest,
} from './manifest.js';

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function writeManifest(contents: string): string {
  workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-manifest-'));
  const manifestPath = join(workDir, '.fastify-ep.json');
  writeFileSync(manifestPath, contents);
  return manifestPath;
}

describe('readManifest', () => {
  it('reads a valid v2 manifest', () => {
    const manifestPath = writeManifest(
      JSON.stringify({
        schemaVersion: 2,
        fastifyEpVersion: '0.2.0',
        architecture: { schema: 'typebox', di: 'native', database: 'none' },
        modules: ['health'],
      }),
    );

    expect(readManifest(manifestPath)).toEqual({
      schemaVersion: 2,
      fastifyEpVersion: '0.2.0',
      architecture: { schema: 'typebox', di: 'native', database: 'none' },
      modules: ['health'],
    });
  });

  it.each(['drizzle', 'prisma'] as const)('accepts database "%s"', (database) => {
    const manifestPath = writeManifest(
      JSON.stringify({
        schemaVersion: 2,
        fastifyEpVersion: '0.3.0',
        architecture: { schema: 'typebox', di: 'native', database },
        modules: ['health'],
      }),
    );

    expect(readManifest(manifestPath).architecture.database).toBe(database);
  });

  it('throws InvalidManifestError for an unsupported database strategy', () => {
    const manifestPath = writeManifest(
      JSON.stringify({
        schemaVersion: 2,
        fastifyEpVersion: '0.3.0',
        architecture: { schema: 'typebox', di: 'native', database: 'mongo' },
        modules: ['health'],
      }),
    );

    expect(() => readManifest(manifestPath)).toThrow(InvalidManifestError);
  });

  it('accepts DI strategy "awilix"', () => {
    const manifestPath = writeManifest(
      JSON.stringify({
        schemaVersion: 2,
        fastifyEpVersion: '0.4.0',
        architecture: { schema: 'typebox', di: 'awilix', database: 'none' },
        modules: ['health'],
      }),
    );

    expect(readManifest(manifestPath).architecture.di).toBe('awilix');
  });

  it('throws InvalidManifestError for an unsupported DI strategy', () => {
    const manifestPath = writeManifest(
      JSON.stringify({
        schemaVersion: 2,
        fastifyEpVersion: '0.4.0',
        architecture: { schema: 'typebox', di: 'inversify', database: 'none' },
        modules: ['health'],
      }),
    );

    expect(() => readManifest(manifestPath)).toThrow(InvalidManifestError);
  });

  it('throws LegacyManifestError for a v1 manifest', () => {
    const manifestPath = writeManifest(
      JSON.stringify({ version: '0.1.0', diStrategy: 'native', modules: ['health'] }),
    );

    expect(() => readManifest(manifestPath)).toThrow(LegacyManifestError);
  });

  it('throws InvalidManifestError for garbage JSON', () => {
    const manifestPath = writeManifest('not json');

    expect(() => readManifest(manifestPath)).toThrow(InvalidManifestError);
  });

  it('throws InvalidManifestError for unrecognized JSON shapes', () => {
    const manifestPath = writeManifest(JSON.stringify({ foo: 'bar' }));

    expect(() => readManifest(manifestPath)).toThrow(InvalidManifestError);
  });
});

describe('readManifest preset', () => {
  const base = {
    schemaVersion: 2,
    fastifyEpVersion: '0.6.0',
    modules: ['health'],
  };

  function read(architecture: Record<string, unknown>) {
    const dir = mkdtempSync(join(tmpdir(), 'fastify-ep-manifest-'));
    const path = join(dir, '.fastify-ep.json');
    writeFileSync(path, JSON.stringify({ ...base, architecture }));
    try {
      return readManifest(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('accepts a manifest without a preset (v0.5 and Standard)', () => {
    expect(read({ schema: 'typebox', di: 'native', database: 'none' }).architecture.preset).toBe(
      undefined,
    );
  });

  it('accepts a known preset and rejects an unknown one', () => {
    const architecture = { schema: 'typebox', di: 'native', database: 'none' };
    expect(read({ ...architecture, preset: 'production' }).architecture.preset).toBe('production');
    expect(() => read({ ...architecture, preset: 'enterprise' })).toThrow(InvalidManifestError);
  });

  describe('schema 3', () => {
    const hash = `sha256:${'a'.repeat(64)}`;
    const v3 = (overrides: Record<string, unknown> = {}): string =>
      JSON.stringify({
        schemaVersion: 3,
        fastifyEpVersion: '0.9.0',
        architectureVersion: 1,
        architecture: { schema: 'typebox', di: 'native', database: 'none' },
        modules: ['health'],
        files: { 'src/app.ts': hash },
        ...overrides,
      });

    it('reads a valid v3 manifest with file hashes', () => {
      const manifest = readManifest(writeManifest(v3()));

      expect(manifest.schemaVersion).toBe(3);
      expect(manifest.architectureVersion).toBe(1);
      expect(manifest.files).toEqual({ 'src/app.ts': hash });
    });

    it.each([
      ['a hash without the sha256 prefix', { files: { 'src/app.ts': 'abc' } }],
      ['a non-string hash', { files: { 'src/app.ts': 1 } }],
      ['a parent-directory path', { files: { '../outside.ts': hash } }],
      ['an absolute path', { files: { '/etc/passwd': hash } }],
      ['a backslash path', { files: { 'src\\app.ts': hash } }],
      ['a files list instead of a map', { files: [] }],
      ['no files', { files: undefined }],
      ['no architectureVersion', { architectureVersion: undefined }],
    ])('throws InvalidManifestError for %s', (_label, overrides) => {
      expect(() => readManifest(writeManifest(v3(overrides)))).toThrow(InvalidManifestError);
    });

    it('throws NewerManifestError for a schema this version does not know', () => {
      expect(() => readManifest(writeManifest(v3({ schemaVersion: 4 })))).toThrow(
        NewerManifestError,
      );
    });
  });
});
