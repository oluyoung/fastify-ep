import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashContent } from '../file-hashes.js';
import { readManifest, type Manifest } from '../manifest.js';
import { scaffoldProject } from '../scaffold.js';
import { planUpgrade } from './plan.js';
import {
  InvalidMigrationError,
  ProjectNewerThanCliError,
  UnsupportedVersionError,
  type Migration,
  type MigrationRequest,
} from './types.js';

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

/** A real scaffolded project whose manifest says it was created by 0.8.0. */
function project(): { root: string; manifest: Manifest } {
  workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-plan-'));
  const root = join(workDir, 'demo-app');
  scaffoldProject({ targetDir: root, projectName: 'demo-app', cliVersion: '0.8.0' });
  return { root, manifest: readManifest(join(root, '.fastify-ep.json')) };
}

function migration(
  id: string,
  from: string,
  to: string,
  requests: MigrationRequest[] | ((ctx: Parameters<Migration['plan']>[0]) => MigrationRequest[]),
): Migration {
  return {
    id,
    from,
    to,
    plan: (ctx) => (typeof requests === 'function' ? requests(ctx) : requests),
  };
}

function plan(root: string, manifest: Manifest, migrations: Migration[], target = '0.9.0') {
  return planUpgrade({
    root,
    manifest,
    migrations,
    targetVersion: target,
    minimumVersion: '0.6.0',
  });
}

function snapshot(dir: string, rel = ''): Record<string, string> {
  return Object.assign(
    {},
    ...readdirSync(join(dir, rel), { withFileTypes: true }).map((entry) =>
      entry.isDirectory()
        ? snapshot(dir, `${rel}${entry.name}/`)
        : { [`${rel}${entry.name}`]: readFileSync(join(dir, rel, entry.name), 'utf8') },
    ),
  );
}

describe('planUpgrade versions', () => {
  it('is up to date when the project already has the target version', () => {
    const { root, manifest } = project();

    const result = plan(root, manifest, [], '0.8.0');

    expect(result.upToDate).toBe(true);
    expect(result.changes).toEqual([]);
    expect(result.manifest).toBeUndefined();
  });

  it('only stamps the new version when no migration applies', () => {
    const { root, manifest } = project();

    const result = plan(root, manifest, []);

    expect(result.upToDate).toBe(false);
    expect(result.manifest?.fastifyEpVersion).toBe('0.9.0');
    expect(result.changes).toHaveLength(1);
    expect(result.files.size).toBe(0);
  });

  it('rejects a project older than the minimum, with an unreadable version, or newer than the CLI', () => {
    const { root, manifest } = project();

    expect(() => plan(root, { ...manifest, fastifyEpVersion: '0.5.0' }, [])).toThrow(
      UnsupportedVersionError,
    );
    expect(() => plan(root, { ...manifest, fastifyEpVersion: 'dev' }, [])).toThrow(
      UnsupportedVersionError,
    );
    expect(() => plan(root, { ...manifest, fastifyEpVersion: '1.0.0' }, [])).toThrow(
      ProjectNewerThanCliError,
    );
  });

  it('rejects duplicate ids, a from that is not below to, and paths outside the project', () => {
    const { root, manifest } = project();

    expect(() =>
      plan(root, manifest, [
        migration('a', '0.8.0', '0.9.0', []),
        migration('a', '0.7.0', '0.8.0', []),
      ]),
    ).toThrow(InvalidMigrationError);
    expect(() => plan(root, manifest, [migration('a', '0.9.0', '0.8.0', [])])).toThrow(
      InvalidMigrationError,
    );
    expect(() =>
      plan(root, manifest, [
        migration('a', '0.8.0', '0.9.0', [{ kind: 'write', path: '../x.ts', content: '' }]),
      ]),
    ).toThrow(InvalidMigrationError);
  });
});

describe('planUpgrade chain', () => {
  it('runs only the migrations between the project version and the target, in order of "to"', () => {
    const { root, manifest } = project();
    const order: string[] = [];
    const record = (id: string) => () => {
      order.push(id);
      return [];
    };

    const result = plan(root, manifest, [
      migration('c', '0.9.0', '1.0.0', record('c')),
      migration('b', '0.8.0', '0.9.0', record('b')),
      migration('a', '0.7.0', '0.8.0', record('a')),
    ]);

    expect(order).toEqual(['b']);
    expect(result.migrations).toEqual(['b']);
  });

  it('lets a later migration see what an earlier one planned', () => {
    const { root, manifest } = project();
    const first = migration('first', '0.7.0', '0.8.5', [
      { kind: 'write', path: 'notes/new.txt', content: 'one\n' },
    ]);
    const second = migration('second', '0.8.5', '0.9.0', (ctx) => [
      {
        kind: 'patch',
        path: 'notes/new.txt',
        anchor: ctx.read('notes/new.txt') ?? 'MISSING',
        replacement: 'two\n',
      },
    ]);

    const result = plan(root, { ...manifest, fastifyEpVersion: '0.8.0' }, [second, first]);

    expect(result.files.get('notes/new.txt')).toBe('two\n');
    expect(result.review).toEqual([]);
  });

  it('plans without touching the project', () => {
    const { root, manifest } = project();
    const before = snapshot(root);

    plan(root, manifest, [
      migration('m', '0.8.0', '0.9.0', [
        { kind: 'write', path: 'new.txt', content: 'x' },
        { kind: 'patch', path: 'src/app.ts', anchor: 'fastify', replacement: 'FASTIFY' },
      ]),
    ]);

    expect(snapshot(root)).toEqual(before);
  });
});

describe('planUpgrade write', () => {
  const run = (root: string, manifest: Manifest, path: string, content: string) =>
    plan(root, manifest, [migration('m', '0.8.0', '0.9.0', [{ kind: 'write', path, content }])]);

  it('creates a missing file and replaces a pristine one, refreshing its hash', () => {
    const { root, manifest } = project();

    const created = run(root, manifest, 'docs/new.md', 'hello\n');
    const replaced = run(root, manifest, 'src/app.ts', 'export {};\n');

    expect(created.files.get('docs/new.md')).toBe('hello\n');
    // A file the migration creates is generated, so it is tracked like one.
    expect(created.manifest?.files?.['docs/new.md']).toBe(hashContent('hello\n'));
    expect(replaced.files.get('src/app.ts')).toBe('export {};\n');
    expect(replaced.manifest?.files?.['src/app.ts']).toBe(hashContent('export {};\n'));
    expect(replaced.review).toEqual([]);
  });

  it('sends a modified file to review and keeps it untouched', () => {
    const { root, manifest } = project();
    writeFileSync(join(root, 'src/app.ts'), '// mine\n');

    const result = run(root, manifest, 'src/app.ts', 'export {};\n');

    expect(result.files.size).toBe(0);
    expect(result.review).toMatchObject([{ path: 'src/app.ts', migration: 'm' }]);
    expect(result.review[0].reason).toMatch(/local modifications/);
  });

  it('sends an existing untracked file to review', () => {
    const { root, manifest } = project();
    writeFileSync(join(root, 'mine.ts'), 'x');

    const result = run(root, manifest, 'mine.ts', 'y');

    expect(result.review[0].reason).toMatch(/not tracked/);
    expect(result.files.size).toBe(0);
  });

  it('does nothing when the file already has the new content', () => {
    const { root, manifest } = project();

    const result = run(
      root,
      manifest,
      'src/app.ts',
      readFileSync(join(root, 'src/app.ts'), 'utf8'),
    );

    expect(result.files.size).toBe(0);
    expect(result.review).toEqual([]);
  });
});

describe('planUpgrade patch', () => {
  const run = (
    root: string,
    manifest: Manifest,
    anchor: string,
    replacement: string,
    path = 'src/app.ts',
  ) =>
    plan(root, manifest, [
      migration('m', '0.8.0', '0.9.0', [{ kind: 'patch', path, anchor, replacement }]),
    ]);

  it('replaces an exact snippet that occurs once, even in an edited file', () => {
    const { root, manifest } = project();
    const appTs = join(root, 'src/app.ts');
    writeFileSync(appTs, `// mine\n${readFileSync(appTs, 'utf8')}`);

    const result = run(root, manifest, 'fastify-ep:register', 'fastify-ep:REGISTER');

    expect(result.files.get('src/app.ts')).toContain('fastify-ep:REGISTER');
    expect(result.files.get('src/app.ts')).toContain('// mine');
    // The file was already modified, so its recorded hash is not adopted.
    expect(result.manifest?.files?.['src/app.ts']).toBe(manifest.files?.['src/app.ts']);
  });

  it('does not apply an insertion twice when the replacement still contains the anchor', () => {
    const { root, manifest } = project();
    const insertion = 'fastify-ep:register\n  // added\n';

    const first = run(root, manifest, 'fastify-ep:register\n', insertion);
    writeFileSync(join(root, 'src/app.ts'), first.files.get('src/app.ts') as string);
    const second = run(root, manifest, 'fastify-ep:register\n', insertion);

    expect(first.files.get('src/app.ts')).toContain('// added');
    expect(second.files.size).toBe(0);
    expect(second.review).toEqual([]);
  });

  it('refreshes the hash of a pristine tracked file', () => {
    const { root, manifest } = project();

    const result = run(root, manifest, 'fastify-ep:register', 'fastify-ep:REGISTER');

    expect(result.manifest?.files?.['src/app.ts']).toBe(
      hashContent(result.files.get('src/app.ts') as string),
    );
  });

  it('reviews a snippet that is missing, ambiguous or in a missing file', () => {
    const { root, manifest } = project();

    expect(run(root, manifest, 'no such text', 'zzz-unique-replacement').review).toHaveLength(1);
    expect(run(root, manifest, 'e', 'E').review).toHaveLength(1);
    expect(run(root, manifest, 'a', 'b', 'src/nope.ts').review[0].reason).toMatch(/does not exist/);
  });

  it('is a no-op when the replacement is already there', () => {
    const { root, manifest } = project();
    const once = run(root, manifest, 'fastify-ep:register', 'fastify-ep:REGISTER');
    writeFileSync(join(root, 'src/app.ts'), once.files.get('src/app.ts') as string);

    const again = run(root, manifest, 'fastify-ep:register', 'fastify-ep:REGISTER');

    expect(again.files.size).toBe(0);
    expect(again.review).toEqual([]);
  });
});

describe('planUpgrade json-key', () => {
  const run = (root: string, manifest: Manifest, from: unknown, to: unknown) =>
    plan(root, manifest, [
      migration('m', '0.8.0', '0.9.0', [
        {
          kind: 'json-key',
          path: 'package.json',
          keyPath: ['devDependencies', 'vitest'],
          from,
          to,
        },
      ]),
    ]);

  function vitestRange(root: string): string {
    return (
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        devDependencies: { vitest: string };
      }
    ).devDependencies.vitest;
  }

  it('sets the key when it still holds the generated value', () => {
    const { root, manifest } = project();

    const result = run(root, manifest, vitestRange(root), '^9.0.0');

    const written = JSON.parse(result.files.get('package.json') as string) as {
      devDependencies: { vitest: string };
    };
    expect(written.devDependencies.vitest).toBe('^9.0.0');
    expect(result.manifest?.files).not.toHaveProperty(['package.json']);
  });

  it('reviews a key the user changed, and does nothing when already at the new value', () => {
    const { root, manifest } = project();

    const changed = run(root, manifest, '^1.0.0', '^9.0.0');
    const already = run(root, manifest, '^1.0.0', vitestRange(root));

    expect(changed.files.size).toBe(0);
    expect(changed.review[0].reason).toContain('devDependencies.vitest');
    expect(already.review).toEqual([]);
    expect(already.files.size).toBe(0);
  });

  it('reviews a file that is not formatted the way fastify-ep writes it, or is not JSON', () => {
    const { root, manifest } = project();
    const range = vitestRange(root);
    const pkgPath = join(root, 'package.json');
    const text = readFileSync(pkgPath, 'utf8');

    writeFileSync(pkgPath, text.replace(/\n {2}/g, '\n    '));
    expect(run(root, manifest, range, '^9.0.0').review[0].reason).toMatch(/formatted/);

    writeFileSync(pkgPath, 'nope');
    expect(run(root, manifest, range, '^9.0.0').review[0].reason).toMatch(/JSON/);
  });
});

describe('planUpgrade manifest and review requests', () => {
  it('merges files key by key and replaces other fields', () => {
    const { root, manifest } = project();

    const result = plan(root, manifest, [
      migration('m', '0.8.0', '0.9.0', [
        {
          kind: 'manifest',
          changes: { architectureVersion: 2, files: { 'extra.ts': `sha256:${'a'.repeat(64)}` } },
        },
        { kind: 'review', path: 'src/app.ts', reason: 'look at this' },
      ]),
    ]);

    expect(result.manifest?.architectureVersion).toBe(2);
    expect(result.manifest?.files).toMatchObject({
      'extra.ts': `sha256:${'a'.repeat(64)}`,
      'src/app.ts': manifest.files?.['src/app.ts'],
    });
    expect(result.review).toEqual([{ migration: 'm', path: 'src/app.ts', reason: 'look at this' }]);
  });
});
