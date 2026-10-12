import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InvalidManifestError, LegacyManifestError, readManifest } from './manifest.js';

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
