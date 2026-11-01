import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateLibrary } from './generate-library.js';
import { LIBRARY_MARKER } from './find-project.js';
import { runLibraryChecks } from './library-doctor.js';

let root: string;
let library: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fastify-ep-library-doctor-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@acme/repo', private: true }));
  library = generateLibrary({ cwd: root, name: 'contracts', cliVersion: '0.7.0' }).targetDir;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function edit(file: string, change: (json: Record<string, unknown>) => void): void {
  const path = join(library, file);
  const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  change(json);
  writeFileSync(path, JSON.stringify(json));
}

const find = (name: string) => {
  const found = runLibraryChecks(library).find((c) => c.name === name);
  if (!found) throw new Error(`no check named "${name}"`);
  return found;
};

describe('runLibraryChecks', () => {
  it('passes every check for a freshly generated library', () => {
    const checks = runLibraryChecks(library);
    expect(checks).toHaveLength(7);
    for (const c of checks) {
      expect(c.pass, `${c.name}: ${c.detail}`).toBe(true);
      expect(c.group).toBe('Libraries');
      expect(c.severity).toBe('error');
    }
  });

  describe('marker', () => {
    it('fails when the marker is missing', () => {
      rmSync(join(library, LIBRARY_MARKER));
      expect(find('library marker valid').pass).toBe(false);
      expect(find('library marker valid').detail).toContain('not found');
    });

    it('fails when the marker is not JSON', () => {
      writeFileSync(join(library, LIBRARY_MARKER), '{ nope');
      expect(find('library marker valid').detail).toContain('not valid JSON');
    });

    it.each([
      ['schemaVersion', 2],
      ['kind', 'service'],
      ['fastifyEpVersion', 7],
    ])('fails when %s is wrong', (field, value) => {
      edit(LIBRARY_MARKER, (json) => {
        json[field] = value;
      });
      const found = find('library marker valid');
      expect(found.pass).toBe(false);
      expect(found.detail).toContain(field);
    });
  });

  describe('package.json', () => {
    it('stops at one failure when package.json is missing', () => {
      rmSync(join(library, 'package.json'));
      const checks = runLibraryChecks(library);
      expect(checks.map((c) => c.name)).toEqual([
        'library marker valid',
        'package.json readable',
        'library is a workspace package',
      ]);
      expect(find('package.json readable').pass).toBe(false);
    });

    it('fails on a missing or invalid name', () => {
      edit('package.json', (json) => {
        delete json.name;
      });
      expect(find('package name valid').detail).toContain('missing');
      edit('package.json', (json) => {
        json.name = 'Not A Name';
      });
      expect(find('package name valid').pass).toBe(false);
    });

    it('fails when the package is not an ES module', () => {
      edit('package.json', (json) => {
        delete json.type;
      });
      expect(find('package is an ES module').pass).toBe(false);
    });

    it('fails when exports is missing', () => {
      edit('package.json', (json) => {
        delete json.exports;
      });
      expect(find('exports point at dist').detail).toContain('missing');
    });

    it('fails when an export points outside dist, however deeply nested', () => {
      edit('package.json', (json) => {
        json.exports = { '.': { types: './dist/index.d.ts', default: './src/index.ts' } };
      });
      const found = find('exports point at dist');
      expect(found.pass).toBe(false);
      expect(found.detail).toContain('./src/index.ts');
    });

    it('accepts a string export and the package.json export', () => {
      edit('package.json', (json) => {
        json.exports = { '.': './dist/index.js', './package.json': './package.json' };
      });
      expect(find('exports point at dist').pass).toBe(true);
    });

    it('fails when files does not include dist', () => {
      edit('package.json', (json) => {
        json.files = ['src'];
      });
      expect(find('files include dist').pass).toBe(false);
    });

    it('fails when a script is missing and names it', () => {
      edit('package.json', (json) => {
        json.scripts = { build: 'tsc' };
      });
      const found = find('build and typecheck scripts present');
      expect(found.pass).toBe(false);
      expect(found.detail).toContain('typecheck');
    });
  });

  describe('workspace', () => {
    it('fails when the library directory is outside the workspace packages', () => {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
      const found = find('library is a workspace package');
      expect(found.pass).toBe(false);
      expect(found.detail).toContain("- 'packages/*'");
    });

    it('fails outside any workspace', () => {
      rmSync(join(root, 'pnpm-workspace.yaml'));
      const found = find('library is a workspace package');
      expect(found.pass).toBe(false);
      expect(found.detail).toContain('not inside a workspace');
    });

    it('passes in an npm workspace', () => {
      rmSync(join(root, 'pnpm-workspace.yaml'));
      writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
      expect(find('library is a workspace package').pass).toBe(true);
    });
  });
});

describe('directory without a package', () => {
  it('reports the marker and the package as failures', () => {
    const empty = join(root, 'packages', 'empty');
    mkdirSync(empty, { recursive: true });
    const failed = runLibraryChecks(empty).filter((c) => !c.pass);
    expect(failed.map((c) => c.name)).toEqual(['library marker valid', 'package.json readable']);
  });
});
