import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateInit } from './validate-init.js';

describe('validateInit (npm-name half)', () => {
  it('accepts a valid unscoped package name', () => {
    expect(validateInit('my-app', '/tmp')).toEqual({ valid: true });
  });

  it('rejects a name containing spaces', () => {
    const result = validateInit('my app', '/tmp');
    expect(result.valid).toBe(false);
  });

  it('rejects a name containing uppercase letters', () => {
    const result = validateInit('MyApp', '/tmp');
    expect(result.valid).toBe(false);
  });

  it('rejects a name with a leading dot', () => {
    const result = validateInit('.my-app', '/tmp');
    expect(result.valid).toBe(false);
  });

  it('rejects an empty name', () => {
    const result = validateInit('', '/tmp');
    expect(result.valid).toBe(false);
  });
});

describe('validateInit (target-directory-safety half)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'fastify-ep-validate-init-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('accepts a valid name resolving to a non-existent (or empty) directory', () => {
    expect(validateInit('my-app', cwd)).toEqual({ valid: true });
  });

  it('rejects an invalid npm package name before checking the directory', () => {
    const result = validateInit('My App', cwd);
    expect(result.valid).toBe(false);
  });

  it('rejects a name that would escape cwd', () => {
    const result = validateInit('..', cwd);
    expect(result.valid).toBe(false);
  });

  it('rejects a scoped name, since only unscoped names create a directory', () => {
    const result = validateInit('@scope/my-app', cwd);
    expect(result.valid).toBe(false);
  });

  it('rejects a non-empty target directory', () => {
    const targetDir = join(cwd, 'my-app');
    mkdirSync(targetDir);
    writeFileSync(join(targetDir, 'existing-file.txt'), 'hello');

    const result = validateInit('my-app', cwd);
    expect(result.valid).toBe(false);
  });

  it('accepts an existing but empty target directory', () => {
    mkdirSync(join(cwd, 'my-app'));
    expect(validateInit('my-app', cwd)).toEqual({ valid: true });
  });
});
