import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIN_NODE_MAJOR, SUPPORTED_FASTIFY_MAJOR } from './doctor.js';

interface PackageJson {
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
describe.each(readdirSync(fileURLToPath(new URL('../template-overlays', import.meta.url))))(
  'the %s overlay stays in sync with the base templates',
  (database) => {
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
  },
);
