import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateInit } from './validate-init.js';

describe('validateInit (npm-name half)', () => {
  it('accepts a valid unscoped package name', () => {
    expect(validateInit('my-app', '/tmp')).toEqual({
      valid: true,
      targetDir: '/tmp/my-app',
      packageName: 'my-app',
    });
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
    expect(validateInit('my-app', cwd)).toEqual({
      valid: true,
      targetDir: join(cwd, 'my-app'),
      packageName: 'my-app',
    });
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
    expect(validateInit('my-app', cwd)).toMatchObject({ valid: true });
  });
});

describe('validateInit (paths and --name)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'fastify-ep-validate-init-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('accepts a nested path and names the package after its last segment', () => {
    expect(validateInit('apps/payments-api', cwd)).toEqual({
      valid: true,
      targetDir: join(cwd, 'apps', 'payments-api'),
      packageName: 'payments-api',
    });
  });

  it('ignores a trailing slash', () => {
    expect(validateInit('apps/payments-api/', cwd)).toMatchObject({
      valid: true,
      packageName: 'payments-api',
    });
  });

  it('uses --name for the package name, including a scoped one', () => {
    expect(validateInit('apps/payments-api', cwd, '@acme/payments-api')).toEqual({
      valid: true,
      targetDir: join(cwd, 'apps', 'payments-api'),
      packageName: '@acme/payments-api',
    });
  });

  it('accepts a directory whose name is not a valid package name when --name is given', () => {
    expect(validateInit('apps/Payments_API', cwd, 'payments-api')).toMatchObject({ valid: true });
  });

  it('rejects an invalid last segment and says how to fix it', () => {
    const result = validateInit('apps/Payments', cwd);
    expect(result).toMatchObject({ valid: false });
    expect(result.valid === false && result.reason).toContain('--name');
  });

  it('rejects an invalid --name', () => {
    expect(validateInit('apps/payments-api', cwd, 'Not Valid')).toMatchObject({ valid: false });
  });

  it('rejects a path that escapes cwd, however it is written', () => {
    expect(validateInit('apps/../../escape', cwd)).toMatchObject({ valid: false });
    expect(validateInit('/tmp/elsewhere', cwd)).toMatchObject({ valid: false });
  });

  it('rejects the current directory', () => {
    expect(validateInit('.', cwd)).toMatchObject({ valid: false });
    expect(validateInit('apps/..', cwd)).toMatchObject({ valid: false });
  });

  it('points a scoped target at --name', () => {
    const result = validateInit('@acme/payments-api', cwd);
    expect(result.valid === false && result.reason).toContain('--name');
  });

  it('rejects a non-empty nested target directory', () => {
    const targetDir = join(cwd, 'apps', 'payments-api');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'existing-file.txt'), 'hello');
    expect(validateInit('apps/payments-api', cwd)).toMatchObject({ valid: false });
  });
});
