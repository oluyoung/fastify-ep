import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashContent } from './file-hashes.js';
import { classifyTracked, fileState } from './file-state.js';
import type { Manifest } from './manifest.js';

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-state-'));
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

describe('fileState', () => {
  it('reports pristine, modified, missing and untracked', () => {
    const root = project({ 'a.ts': 'one\n', 'b.ts': 'two\n', 'other.ts': 'mine\n' });
    const manifest = manifestWith({
      'a.ts': hashContent('one\n'),
      'b.ts': hashContent('something else\n'),
      'gone.ts': hashContent('x'),
    });

    expect(fileState(manifest, root, 'a.ts')).toBe('pristine');
    expect(fileState(manifest, root, 'b.ts')).toBe('modified');
    expect(fileState(manifest, root, 'gone.ts')).toBe('missing');
    expect(fileState(manifest, root, 'other.ts')).toBe('untracked');
  });

  it('treats every path as untracked in a schema 2 manifest', () => {
    const root = project({ 'a.ts': 'one\n' });

    expect(fileState(manifestWith(), root, 'a.ts')).toBe('untracked');
  });

  it('still counts a file as pristine when only its line endings changed', () => {
    const root = project({ 'a.ts': 'one\r\ntwo\r\n' });

    expect(fileState(manifestWith({ 'a.ts': hashContent('one\ntwo\n') }), root, 'a.ts')).toBe(
      'pristine',
    );
  });
});

describe('classifyTracked', () => {
  it('returns a state for every tracked path and nothing else', () => {
    const root = project({ 'a.ts': 'one\n', 'other.ts': 'mine\n' });
    const manifest = manifestWith({ 'a.ts': hashContent('one\n'), 'gone.ts': hashContent('x') });

    expect(classifyTracked(manifest, root)).toEqual({ 'a.ts': 'pristine', 'gone.ts': 'missing' });
    expect(classifyTracked(manifestWith(), root)).toEqual({});
  });
});
