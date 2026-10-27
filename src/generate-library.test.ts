import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY_MARKER, LibraryGenerationError, generateLibrary } from './generate-library.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fastify-ep-lib-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function npmWorkspace(extra: Record<string, unknown> = {}, globs = ['apps/*', 'packages/*']): void {
  writeJson(join(root, 'package.json'), {
    name: 'root',
    private: true,
    workspaces: globs,
    ...extra,
  });
}

const generate = (overrides = {}) =>
  generateLibrary({ cwd: root, name: 'contracts', cliVersion: '0.7.0', ...overrides });

const readPkg = (dir: string) =>
  JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;

describe('generateLibrary', () => {
  it('creates packages/<name> with the library files and a marker', () => {
    npmWorkspace();
    const result = generate();

    expect(result.targetDir).toBe(join(root, 'packages', 'contracts'));
    for (const file of [
      'package.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'vitest.config.ts',
      'src/index.ts',
      'src/index.test.ts',
      LIBRARY_MARKER,
    ]) {
      expect(existsSync(join(result.targetDir, file)), file).toBe(true);
    }
    expect(JSON.parse(readFileSync(join(result.targetDir, LIBRARY_MARKER), 'utf8'))).toEqual({
      schemaVersion: 1,
      kind: 'library',
      fastifyEpVersion: '0.7.0',
    });
    expect(existsSync(join(result.targetDir, '.fastify-ep.json'))).toBe(false);
  });

  it('renders the package name and the example schema', () => {
    npmWorkspace();
    const { targetDir } = generate({ name: 'user-contracts' });

    expect(readPkg(targetDir)).toMatchObject({
      name: 'user-contracts',
      type: 'module',
      files: ['dist'],
      exports: { '.': { default: './dist/index.js' } },
    });
    const index = readFileSync(join(targetDir, 'src/index.ts'), 'utf8');
    expect(index).toContain('export const UserContractsSchema');
    expect(readFileSync(join(targetDir, 'src/index.test.ts'), 'utf8')).not.toContain('{{');
  });

  it('uses the scope of the root package name, or of a scoped service', () => {
    npmWorkspace({ name: '@acme/repo' });
    expect(generate().packageName).toBe('@acme/contracts');
    rmSync(join(root, 'packages'), { recursive: true, force: true });

    writeJson(join(root, 'package.json'), { name: 'root', workspaces: ['apps/*', 'packages/*'] });
    writeJson(join(root, 'apps', 'svc', 'package.json'), { name: '@corp/svc' });
    writeFileSync(join(root, 'apps', 'svc', '.fastify-ep.json'), '{}');
    expect(generate().packageName).toBe('@corp/contracts');
  });

  it('prefers --name over the derived package name, and validates it', () => {
    npmWorkspace({ name: '@acme/repo' });
    expect(generate({ packageName: '@other/shared' }).packageName).toBe('@other/shared');
    expect(() => generate({ packageName: 'Not Valid', dir: 'libs/x' })).toThrow(
      LibraryGenerationError,
    );
  });

  it('puts the library under the workspace glob that ends in libs/* or packages/*', () => {
    npmWorkspace({}, ['apps/*', 'shared/libs/*']);
    expect(generate().targetDir).toBe(join(root, 'shared', 'libs', 'contracts'));
  });

  it('falls back to packages/<name> and says to add the glob when none matches', () => {
    npmWorkspace({}, ['apps/*']);
    const result = generate();
    expect(result.targetDir).toBe(join(root, 'packages', 'contracts'));
    expect(result.notes[0]).toContain('is not matched by "workspaces"');
    expect(result.notes[0]).toContain('"packages/*"');
  });

  it('honours --dir, relative to cwd, and works from a subfolder', () => {
    npmWorkspace();
    mkdirSync(join(root, 'apps', 'svc'), { recursive: true });
    const result = generate({
      cwd: join(root, 'apps', 'svc'),
      dir: '../../packages/shared-contracts',
    });
    expect(result.targetDir).toBe(join(root, 'packages', 'shared-contracts'));
  });

  it('prints no glob note when the library is covered', () => {
    npmWorkspace();
    expect(generate().notes.join('\n')).not.toContain('is not matched');
  });

  it.each([
    ['npm', {}, '"contracts": "*"', 'npm run build -w contracts'],
    ['pnpm', { pnpm: true }, '"contracts": "workspace:*"', 'pnpm --filter contracts build'],
    [
      'yarn berry',
      { packageManager: 'yarn@4.9.2' },
      '"contracts": "workspace:*"',
      'yarn workspace contracts build',
    ],
    [
      'yarn classic',
      { packageManager: 'yarn@1.22.22' },
      '"contracts": "*"',
      'yarn workspace contracts build',
    ],
  ] as const)('%s: prints the dependency line and the build command', (_pm, setup, dep, build) => {
    if ('pnpm' in setup) {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');
    } else {
      npmWorkspace(setup);
    }
    const notes = generate().notes.join('\n');
    expect(notes).toContain(dep);
    expect(notes).toContain(build);
  });

  it('does not touch any file outside the new directory', () => {
    npmWorkspace();
    const before = readFileSync(join(root, 'package.json'), 'utf8');
    generate();
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before);
  });
});

describe('generateLibrary errors', () => {
  it('requires a workspace', () => {
    expect(() => generate()).toThrow(/not inside a workspace/);
  });

  it('rejects names that are not lowercase kebab-case', () => {
    npmWorkspace();
    expect(() => generate({ name: 'Contracts' })).toThrow(/invalid library name/);
    expect(() => generate({ name: '../x' })).toThrow(/invalid library name/);
  });

  it('rejects a directory outside the workspace and the workspace root itself', () => {
    npmWorkspace();
    expect(() => generate({ dir: '../outside' })).toThrow(/inside the workspace root/);
    expect(() => generate({ dir: '.' })).toThrow(/inside the workspace root/);
  });

  it('rejects a non-empty target and leaves it alone', () => {
    npmWorkspace();
    const target = join(root, 'packages', 'contracts');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'keep.txt'), 'x');
    expect(() => generate()).toThrow(/not empty/);
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('x');
  });

  it('removes a half-written library when the template is missing', () => {
    npmWorkspace();
    expect(() => generate({ libraryTemplateDir: join(root, 'no-such-templates') })).toThrow();
    expect(existsSync(join(root, 'packages', 'contracts'))).toBe(false);
  });
});
