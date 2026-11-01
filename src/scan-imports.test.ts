import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analyzeSource,
  extractImports,
  fileRole,
  findMethodCalls,
  moduleOf,
  scanProject,
} from './scan-imports.js';

const specifiers = (source: string) => extractImports(source).map((i) => i.specifier);

describe('extractImports', () => {
  it('finds default, named, namespace and side-effect imports', () => {
    const source = [
      "import fastify from 'fastify';",
      "import { a, b as c } from './a.js';",
      "import * as ns from './ns.js';",
      "import def, { x } from './def.js';",
      "import './side-effect.js';",
    ].join('\n');
    expect(specifiers(source)).toEqual([
      'fastify',
      './a.js',
      './ns.js',
      './def.js',
      './side-effect.js',
    ]);
    expect(extractImports(source).every((i) => i.kind === 'static' && !i.typeOnly)).toBe(true);
  });

  it('reads multi-line imports and records the line of the import keyword', () => {
    const source = "const x = 1;\nimport {\n  a,\n  b,\n} from './multi.js';\n";
    expect(extractImports(source)).toEqual([
      { specifier: './multi.js', kind: 'static', typeOnly: false, line: 2 },
    ]);
  });

  describe('type-only imports', () => {
    it.each([
      ["import type { A } from './a.js';", true],
      ["import type A from './a.js';", true],
      ["import type * as T from './a.js';", true],
      ["import { type A, type B } from './a.js';", true],
      ["import { type A, B } from './a.js';", false],
      ["import { A } from './a.js';", false],
      ["import def, { type A } from './a.js';", false],
      ["import type from './a.js';", false],
    ])('%s -> typeOnly %s', (source, typeOnly) => {
      expect(extractImports(source)[0].typeOnly).toBe(typeOnly);
    });
  });

  it('finds re-exports', () => {
    const source = [
      "export * from './all.js';",
      "export * as ns from './ns.js';",
      "export { a } from './a.js';",
      "export type { T } from './t.js';",
    ].join('\n');
    const refs = extractImports(source);
    expect(refs.map((r) => [r.specifier, r.kind, r.typeOnly])).toEqual([
      ['./all.js', 'export-from', false],
      ['./ns.js', 'export-from', false],
      ['./a.js', 'export-from', false],
      ['./t.js', 'export-from', true],
    ]);
  });

  it('ignores exports that are not re-exports', () => {
    const source = 'export { a };\nexport const b = 1;\nexport default function f() {}\n';
    expect(extractImports(source)).toEqual([]);
  });

  it('finds dynamic imports with a string argument only', () => {
    const source =
      "const m = await import('./lazy.js');\nawait import(name);\nawait import(`./x/${n}.js`);\n";
    expect(extractImports(source).map((i) => [i.specifier, i.kind])).toEqual([
      ['./lazy.js', 'dynamic'],
    ]);
  });

  it('does not treat import.meta or member access as an import', () => {
    expect(extractImports('const u = import.meta.url;\nconst x = obj.import("a");\n')).toEqual([]);
  });

  it('skips comments', () => {
    const source = [
      "// import { a } from './line-comment.js';",
      "/* import { b } from './block-comment.js';",
      "   import { c } from './still-block.js'; */",
      "import { d } from './real.js';",
    ].join('\n');
    expect(specifiers(source)).toEqual(['./real.js']);
  });

  it('skips strings and template literals that look like imports', () => {
    const source = [
      'const a = "import x from \'./in-string.js\'";',
      'const b = \'import y from "./single.js"\';',
      "const c = `import z from './template.js'`;",
      "const d = `${(() => { return `import q from './nested.js'`; })()}`;",
      "import { real } from './real.js';",
    ].join('\n');
    expect(specifiers(source)).toEqual(['./real.js']);
  });

  it('survives regular expressions that contain quotes and slashes', () => {
    const source = [
      "const a = /'/;",
      "const b = x.replace(/[/']+/g, '');",
      'const half = total / 2 / 4;',
      "import { real } from './real.js';",
    ].join('\n');
    expect(specifiers(source)).toEqual(['./real.js']);
  });

  it('keeps counting lines through templates and comments', () => {
    const source = "/* a\nb */\nconst t = `x\ny`;\nimport { a } from './a.js';\n";
    expect(extractImports(source)[0].line).toBe(5);
  });

  it.each([
    ["const a = 'unterminated;\n"],
    ['/* never closed'],
    ['const t = `never closed'],
    ['const r = /never closed\n'],
  ])('throws for source that cannot be tokenised: %s', (source) => {
    expect(() => extractImports(source)).toThrow();
  });
});

describe('fastify-ep-ignore comments', () => {
  const ignores = (source: string) => analyzeSource(source).ignores;

  it('reads the rule ids and the line of a line comment', () => {
    const source =
      "const a = 1;\n// fastify-ep-ignore FEP-002/cross-module-import\nimport { x } from './x.js';\n";
    expect(ignores(source)).toEqual([{ line: 2, rules: ['FEP-002/cross-module-import'] }]);
  });

  it('reads several rule ids, with commas or spaces, and a reason after them', () => {
    const source =
      '// fastify-ep-ignore FEP-002/cross-module-import, FEP-004/service-imports-controller legacy code\n';
    expect(ignores(source)[0].rules).toEqual([
      'FEP-002/cross-module-import',
      'FEP-004/service-imports-controller',
    ]);
  });

  it('uses the last line of a block comment', () => {
    const source =
      '/*\n  fastify-ep-ignore FEP-003/no-database-in-controller\n*/\nimport x from "drizzle-orm";\n';
    expect(ignores(source)).toEqual([{ line: 3, rules: ['FEP-003/no-database-in-controller'] }]);
  });

  it('reports a bare directive with no rules', () => {
    expect(ignores('// fastify-ep-ignore\n')).toEqual([{ line: 1, rules: [] }]);
  });

  it('ignores the marker inside strings and templates', () => {
    const source =
      "const a = '// fastify-ep-ignore FEP-002/x';\nconst b = `// fastify-ep-ignore FEP-002/x`;\n";
    expect(ignores(source)).toEqual([]);
  });
});

describe('findMethodCalls', () => {
  it('finds calls by method name with their lines', () => {
    const source = 'a.listen(1);\nb?.listen(2);\nlisten(3);\nc.listenTo(4);\nd.listen;\n';
    expect(findMethodCalls(source, 'listen')).toEqual([1, 2]);
  });

  it('ignores comments and strings', () => {
    expect(findMethodCalls("// a.listen(1)\nconst s = 'a.listen(1)';\n", 'listen')).toEqual([]);
  });
});

describe('fileRole and moduleOf', () => {
  it.each([
    ['src/modules/users/users.controller.ts', 'controller'],
    ['src/modules/users/users.service.ts', 'service'],
    ['src/modules/users/users.repository.ts', 'repository'],
    ['src/modules/users/users.schema.ts', 'schema'],
    ['src/modules/users/users.module.ts', 'module'],
    ['src/modules/users/users.table.ts', 'table'],
    ['src/modules/users/users.test.ts', 'test'],
    ['src/app.ts', 'other'],
  ])('%s is a %s', (path, role) => {
    expect(fileRole(path)).toBe(role);
  });

  it('names the module a path belongs to', () => {
    expect(moduleOf('src/modules/users/users.service.ts')).toBe('users');
    expect(moduleOf('src/modules/users/nested/helper.ts')).toBe('users');
    expect(moduleOf('src/app.ts')).toBeUndefined();
    expect(moduleOf('src/modules/stray.ts')).toBeUndefined();
  });
});

describe('scanProject', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function write(path: string, content: string): void {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  it('resolves relative imports to .ts files and names bare packages', () => {
    dir = mkdtempSync(join(tmpdir(), 'fastify-ep-scan-'));
    write(
      'src/modules/billing/billing.service.ts',
      [
        "import { fastify } from 'fastify';",
        "import { Type } from '@sinclair/typebox/value';",
        "import { readFileSync } from 'node:fs';",
        "import { Users } from '../users/users.controller.js';",
        "import type { User } from '../users/users.schema.js';",
        "import { AppError } from '../../errors/app-error.js';",
      ].join('\n'),
    );
    write('src/modules/users/users.controller.ts', '');
    write('src/errors/app-error.ts', '');

    const scan = scanProject(dir);
    const service = scan.files.find((f) => f.path === 'src/modules/billing/billing.service.ts');
    expect(service).toMatchObject({ module: 'billing', role: 'service' });
    expect(service?.imports.map((i) => i.package ?? i.resolved)).toEqual([
      'fastify',
      '@sinclair/typebox',
      'node:fs',
      'src/modules/users/users.controller.ts',
      'src/modules/users/users.schema.ts',
      'src/errors/app-error.ts',
    ]);
    expect(service?.imports[4].typeOnly).toBe(true);
  });

  it('resolves a directory import to its index file', () => {
    dir = mkdtempSync(join(tmpdir(), 'fastify-ep-scan-'));
    write('src/app.ts', "import { x } from './lib/index.js';\nimport { y } from './util';\n");
    write('src/lib/index.ts', '');
    write('src/util/index.ts', '');
    const imports = scanProject(dir).files.find((f) => f.path === 'src/app.ts')?.imports;
    expect(imports?.map((i) => i.resolved)).toEqual(['src/lib/index.ts', 'src/util/index.ts']);
  });

  it('leaves out tests, declaration files, node_modules, dist and dot directories', () => {
    dir = mkdtempSync(join(tmpdir(), 'fastify-ep-scan-'));
    write('src/app.ts', '');
    write('src/app.test.ts', '');
    write('src/types.d.ts', '');
    write('src/node_modules/x/index.ts', '');
    write('src/dist/out.ts', '');
    write('src/.hidden/secret.ts', '');
    expect(scanProject(dir).files.map((f) => f.path)).toEqual(['src/app.ts']);
  });

  it('reports a file it cannot tokenise and keeps scanning the rest', () => {
    dir = mkdtempSync(join(tmpdir(), 'fastify-ep-scan-'));
    write('src/broken.ts', "const a = 'oops;\n");
    write('src/ok.ts', "import { a } from './a.js';\n");
    const scan = scanProject(dir);
    expect(scan.files.map((f) => f.path)).toEqual(['src/ok.ts']);
    expect(scan.unparsed).toHaveLength(1);
    expect(scan.unparsed[0].path).toBe('src/broken.ts');
    expect(scan.unparsed[0].reason).toContain('unterminated string');
  });

  it('returns nothing for a project without src', () => {
    dir = mkdtempSync(join(tmpdir(), 'fastify-ep-scan-'));
    expect(scanProject(dir)).toEqual({ files: [], unparsed: [] });
  });
});
