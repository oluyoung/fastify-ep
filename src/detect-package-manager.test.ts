import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectPackageManager } from './detect-package-manager.js';

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('detectPackageManager', () => {
  it('returns undefined when no lockfile is found up to the filesystem root', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-pm-'));
    expect(detectPackageManager(workDir)).toBeUndefined();
  });

  it('detects a pnpm-lock.yaml in cwd', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-pm-'));
    writeFileSync(join(workDir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(workDir)).toBe('pnpm');
  });

  it('detects a yarn.lock in cwd', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-pm-'));
    writeFileSync(join(workDir, 'yarn.lock'), '');
    expect(detectPackageManager(workDir)).toBe('yarn');
  });

  it('detects a lockfile in an ancestor directory', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-pm-'));
    writeFileSync(join(workDir, 'pnpm-lock.yaml'), '');
    const nested = join(workDir, 'packages', 'my-app');
    mkdirSync(nested, { recursive: true });
    expect(detectPackageManager(nested)).toBe('pnpm');
  });

  it('prefers pnpm over yarn when both are present in the same directory', () => {
    workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-pm-'));
    writeFileSync(join(workDir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(workDir, 'yarn.lock'), '');
    expect(detectPackageManager(workDir)).toBe('pnpm');
  });
});
