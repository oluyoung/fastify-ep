import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  hashContent,
  hashFile,
  isPristine,
  recordFiles,
  refreshIfPristine,
  writeManifest,
} from './file-hashes.js';
import type { Manifest } from './manifest.js';

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-hashes-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(workDir, path, '..'), { recursive: true });
    writeFileSync(join(workDir, path), content);
  }
  return workDir;
}

function manifestWith(files?: Record<string, string>): Manifest {
  return {
    schemaVersion: files ? 3 : 2,
    fastifyEpVersion: '0.9.0',
    architecture: { schema: 'typebox', di: 'native', database: 'none' },
    modules: ['health'],
    ...(files ? { architectureVersion: 1, files } : {}),
  };
}

describe('hashContent', () => {
  it('is prefixed sha256 and ignores CRLF versus LF', () => {
    expect(hashContent('a\nb\n')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashContent('a\r\nb\r\n')).toBe(hashContent('a\nb\n'));
  });

  it('changes when the content changes', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});

describe('recordFiles and isPristine', () => {
  it('hashes files as they are on disk', () => {
    const root = project({ 'src/app.ts': 'one\n' });

    expect(recordFiles(root, ['src/app.ts'])).toEqual({
      'src/app.ts': hashFile(join(root, 'src/app.ts')),
    });
  });

  it('is pristine until the file changes, and false when untracked or missing', () => {
    const root = project({ 'src/app.ts': 'one\n' });
    const manifest = manifestWith(recordFiles(root, ['src/app.ts']));

    expect(isPristine(manifest, root, 'src/app.ts')).toBe(true);
    writeFileSync(join(root, 'src/app.ts'), 'two\n');
    expect(isPristine(manifest, root, 'src/app.ts')).toBe(false);
    expect(isPristine(manifest, root, 'src/other.ts')).toBe(false);
    expect(isPristine(manifestWith(), root, 'src/app.ts')).toBe(false);
  });
});

describe('refreshIfPristine', () => {
  it('updates the hash after editing a pristine file', () => {
    const root = project({ 'src/app.ts': 'one\n' });
    const manifest = manifestWith(recordFiles(root, ['src/app.ts']));

    refreshIfPristine(manifest, root, 'src/app.ts', () =>
      writeFileSync(join(root, 'src/app.ts'), 'two\n'),
    );

    expect(isPristine(manifest, root, 'src/app.ts')).toBe(true);
    expect(manifest.files?.['src/app.ts']).toBe(hashContent('two\n'));
  });

  it('leaves the recorded hash alone when the user had already edited the file', () => {
    const root = project({ 'src/app.ts': 'one\n' });
    const manifest = manifestWith(recordFiles(root, ['src/app.ts']));
    const recorded = manifest.files?.['src/app.ts'];
    writeFileSync(join(root, 'src/app.ts'), 'edited by the user\n');

    refreshIfPristine(manifest, root, 'src/app.ts', () =>
      writeFileSync(join(root, 'src/app.ts'), 'edited by the user\nplus generated\n'),
    );

    expect(manifest.files?.['src/app.ts']).toBe(recorded);
    expect(isPristine(manifest, root, 'src/app.ts')).toBe(false);
  });

  it('does not start tracking an untracked file, and ignores a schema 2 manifest', () => {
    const root = project({ 'src/app.ts': 'one\n' });
    const untracked = manifestWith({});
    const v2 = manifestWith();

    for (const manifest of [untracked, v2]) {
      refreshIfPristine(manifest, root, 'src/app.ts', () =>
        writeFileSync(join(root, 'src/app.ts'), 'two\n'),
      );
      writeFileSync(join(root, 'src/app.ts'), 'one\n');
    }

    expect(untracked.files).toEqual({});
    expect(v2.files).toBeUndefined();
  });
});

describe('writeManifest', () => {
  it('sorts files by path and ends with a newline', () => {
    const root = project({});
    const path = join(root, '.fastify-ep.json');

    writeManifest(path, manifestWith({ 'src/b.ts': 'sha256:b', 'src/a.ts': 'sha256:a' }));

    const text = readFileSync(path, 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(Object.keys((JSON.parse(text) as Manifest).files ?? {})).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  it('writes a schema 2 manifest without adding files', () => {
    const root = project({});
    const path = join(root, '.fastify-ep.json');

    writeManifest(path, manifestWith());

    expect(JSON.parse(readFileSync(path, 'utf8'))).not.toHaveProperty('files');
  });
});
