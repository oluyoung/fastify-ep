import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIN_NODE_MAJOR, SUPPORTED_FASTIFY_MAJOR } from './doctor.js';

interface PackageJson {
  version?: string;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(relativePath: string): PackageJson {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
}

function majorOf(range: string | undefined): number {
  const match = /(\d+)/.exec(range ?? '');
  return match ? Number.parseInt(match[1], 10) : NaN;
}

const cli = readPackageJson('../package.json');
const template = readPackageJson('../templates/package.json');

describe('CLI and generated-project manifests stay in sync', () => {
  it('templates/package.json depends on the Fastify major that doctor supports', () => {
    const range = template.dependencies?.fastify;
    expect(
      majorOf(range),
      `templates/package.json has "fastify": "${range}" but src/doctor.ts SUPPORTED_FASTIFY_MAJOR is ${SUPPORTED_FASTIFY_MAJOR}`,
    ).toBe(SUPPORTED_FASTIFY_MAJOR);
  });

  it("doctor's minimum Node major matches the CLI's engines.node", () => {
    const range = cli.engines?.node;
    expect(
      majorOf(range),
      `package.json has "engines.node": "${range}" but src/doctor.ts MIN_NODE_MAJOR is ${MIN_NODE_MAJOR}`,
    ).toBe(MIN_NODE_MAJOR);
  });

  it("the template's engines.node matches doctor's minimum Node major", () => {
    const range = template.engines?.node;
    expect(
      majorOf(range),
      `templates/package.json has "engines.node": "${range}" but src/doctor.ts MIN_NODE_MAJOR is ${MIN_NODE_MAJOR}`,
    ).toBe(MIN_NODE_MAJOR);
  });

  it.each(['typescript', 'vitest', 'tsx', '@types/node'])(
    'uses the same %s major in the CLI and the generated project',
    (name) => {
      const cliRange = cli.devDependencies?.[name];
      const templateRange = template.devDependencies?.[name];
      expect(
        majorOf(templateRange),
        `"${name}" is "${cliRange}" in package.json but "${templateRange}" in templates/package.json`,
      ).toBe(majorOf(cliRange));
    },
  );
});

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

/** Overlay files that replace a base file wholesale must stay the base file plus the database lines. */
describe.each(
  // `di/`, `preset/`, `docker/` and `docker-workspace/` hold overlays that add files rather than replace base ones.
  readdirSync(fileURLToPath(new URL('../template-overlays', import.meta.url))).filter(
    (name) => !['di', 'preset', 'docker', 'docker-workspace'].includes(name),
  ),
)('the %s overlay stays in sync with the base templates', (database) => {
  it('src/config/env.ts is the base env.ts plus DATABASE_URL lines', () => {
    const overlay = readText(`../template-overlays/${database}/src/config/env.ts`);
    const withoutDatabase = overlay
      .split('\n')
      .filter((line) => !line.includes('DATABASE_URL'))
      .join('\n');
    expect(withoutDatabase).toBe(readText('../templates/src/config/env.ts'));
    expect(overlay).toContain('DATABASE_URL');
  });

  it('vitest.config.ts is the base config plus the test env', () => {
    const overlay = readText(`../template-overlays/${database}/vitest.config.ts`);
    const withoutDatabase = overlay
      .split('\n')
      .filter(
        (line) =>
          !line.includes('DATABASE_URL') && !line.trim().startsWith('// Clients connect lazily'),
      )
      .join('\n');
    expect(withoutDatabase).toBe(readText('../templates/vitest.config.ts'));
  });

  it('does not redeclare tooling that the base template already pins', () => {
    const overlay = readPackageJson(`../template-overlays/${database}/package.json`);
    for (const name of ['typescript', 'vitest', 'tsx', '@types/node']) {
      expect(
        overlay.devDependencies?.[name],
        `overlay should not redeclare ${name}`,
      ).toBeUndefined();
    }
  });
});

/**
 * The repo's own .gitignore (e.g. `.env.*`) once silently ignored `.env.example` in the overlays: the
 * file existed on disk, so tests passed locally, but it was never committed and CI failed.
 */
describe('template files are not git-ignored', () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));

  function listFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      return entry.isDirectory() ? listFiles(path) : [path];
    });
  }

  function isIgnoredByGit(path: string): boolean | undefined {
    try {
      execFileSync('git', ['check-ignore', '-q', path], { cwd: repoRoot, stdio: 'ignore' });
      return true;
    } catch (err) {
      const status = (err as { status?: number }).status;
      return status === 1 ? false : undefined; // 128 / ENOENT: not a git checkout, nothing to check
    }
  }

  it.each([
    'templates',
    'template-overlays',
    'module-template',
    'module-template-awilix',
    'resource-template',
    'resource-template-awilix',
    'resource-template-crud',
    'resource-template-crud-awilix',
    'resource-template-crud-drizzle',
    'resource-template-crud-orm',
    'resource-template-crud-prisma',
  ])('%s/', (dir) => {
    const files = listFiles(`${repoRoot}${dir}`).map((file) => file.slice(repoRoot.length));
    const ignored = files.filter((file) => isIgnoredByGit(file) === true);
    expect(ignored, `git would not commit these template files: ${ignored.join(', ')}`).toEqual([]);
  });
});

/** npm silently omits these names from a published tarball, so a template can't ship them as-is. */
describe('template files survive `npm pack`', () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const dropped = new Set(['.gitignore', '.npmignore']);

  function listFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      return entry.isDirectory() ? listFiles(path) : [path];
    });
  }

  it.each([
    'templates',
    'template-overlays',
    'module-template',
    'module-template-awilix',
    'resource-template',
    'resource-template-awilix',
    'resource-template-crud',
    'resource-template-crud-awilix',
    'resource-template-crud-drizzle',
    'resource-template-crud-orm',
    'resource-template-crud-prisma',
  ])('%s/', (dir) => {
    const offenders = listFiles(`${repoRoot}${dir}`)
      .filter((file) => dropped.has(file.slice(file.lastIndexOf('/') + 1)))
      .map((file) => file.slice(repoRoot.length));
    expect(
      offenders,
      `npm drops these from the tarball; ship them under another name and rename on copy: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});

/** examples/ is generated by `npm run examples`; CI diffs it, this catches a hand-edited or stale manifest earlier. */
describe('examples/', () => {
  const examplesDir = fileURLToPath(new URL('../examples', import.meta.url));

  it.each([
    ['drizzle-api', 'drizzle'],
    ['prisma-api', 'prisma'],
    ['awilix-api', 'drizzle'],
  ])('%s is a %s project at the current CLI version', (name, database) => {
    const manifest = JSON.parse(
      readFileSync(`${examplesDir}/${name}/.fastify-ep.json`, 'utf8'),
    ) as {
      fastifyEpVersion: string;
      architecture: { database: string; di: string };
    };
    expect(manifest.architecture.database).toBe(database);
    expect(manifest.architecture.di).toBe(name === 'awilix-api' ? 'awilix' : 'native');
    expect(
      manifest.fastifyEpVersion,
      'examples are stale: run `npm run build && npm run examples`',
    ).toBe(cli.version);
  });
});
