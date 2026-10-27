import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Manifest,
  MANIFEST_SCHEMA_VERSION,
  type DatabaseStrategy,
  type DiStrategy,
} from './manifest.js';
import type { PackageManager } from './package-manager.js';
import { insertInfrastructureRegistration, insertModuleRegistration } from './register-module.js';
import { renderTemplate } from './template-engine.js';

const TEMPLATES_DIR = fileURLToPath(new URL('../templates', import.meta.url));
const OVERLAYS_DIR = fileURLToPath(new URL('../template-overlays', import.meta.url));

/** Where each database overlay's plugin lives, relative to `src/` and without extension. */
export const DATABASE_PLUGIN_PATH = 'infrastructure/database/database.plugin';

/** Where the Awilix container plugin lives, relative to `src/` and without extension. */
export const DI_PLUGIN_PATH = 'infrastructure/di/container.plugin';

const DI_REGISTRATIONS_MARKER = '// fastify-ep:di-registrations';
const DI_CRADLE_MARKER = '// fastify-ep:cradle';

/**
 * pnpm 11 fails `install` while any dependency build script is neither approved nor denied.
 * esbuild works without its postinstall (it ships prebuilt binaries); Prisma's scripts are needed.
 */
const PNPM_ALLOWED_BUILDS: Record<DatabaseStrategy, Record<string, boolean>> = {
  none: { esbuild: false },
  drizzle: { esbuild: false },
  prisma: { esbuild: false, prisma: true, '@prisma/engines': true },
};

export interface ScaffoldOptions {
  targetDir: string;
  projectName: string;
  cliVersion: string;
  /** Defaults to `none`. */
  database?: DatabaseStrategy;
  /** Defaults to `native`. */
  di?: DiStrategy;
  /** Package manager the project will use; pnpm gets a `pnpm-workspace.yaml`. */
  packageManager?: PackageManager;
  /** Override for tests; defaults to this package's real `templates/` dir. */
  templatesDir?: string;
  /** Override for tests; defaults to this package's real `template-overlays/` dir. */
  overlaysDir?: string;
}

type Json = Record<string, unknown>;

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Objects merge key by key (sorted); anything else is replaced by the overlay's value. */
function deepMerge(base: Json, overlay: Json): Json {
  const merged: Json = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = merged[key];
    merged[key] =
      isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
  }
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

function mergePackageJson(destPath: string, overlayContent: string): string {
  const base = JSON.parse(readFileSync(destPath, 'utf8')) as Json;
  const overlay = JSON.parse(overlayContent) as Json;
  // Keep the base's key order for top-level fields and scripts; only sort dependency maps.
  const merged: Json = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = merged[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      const combined = deepMerge(existing, value);
      merged[key] = key === 'scripts' ? { ...existing, ...value } : combined;
    } else {
      merged[key] = value;
    }
  }
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/**
 * npm never publishes a file named `.gitignore`, so templates ship it as `gitignore` and it is renamed
 * on the way out. Only the project root needs this.
 */
function destinationName(name: string, isRoot: boolean): string {
  return isRoot && name === 'gitignore' ? '.gitignore' : name;
}

/** Copies `srcDir` over `destDir`. A top-level `package.json` already in `destDir` is merged, not replaced. */
function copyTemplateDir(
  srcDir: string,
  destDir: string,
  projectName: string,
  isRoot = true,
): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, destinationName(entry.name, isRoot));
    if (entry.isDirectory()) {
      copyTemplateDir(srcPath, destPath, projectName, false);
      continue;
    }
    const content = renderTemplate(readFileSync(srcPath, 'utf8'), { projectName });
    if (isRoot && entry.name === 'package.json' && existsSync(destPath)) {
      writeFileSync(destPath, mergePackageJson(destPath, content));
    } else {
      writeFileSync(destPath, content);
    }
  }
}

function pnpmWorkspaceYaml(database: DatabaseStrategy): string {
  const lines = Object.entries(PNPM_ALLOWED_BUILDS[database]).map(
    ([name, allowed]) => `  ${/^[\w-]+$/.test(name) ? name : `'${name}'`}: ${allowed}`,
  );
  return [
    '# pnpm 11 refuses to install until every dependency build script is allowed (true) or denied (false).',
    'allowBuilds:',
    ...lines,
    '',
  ].join('\n');
}

function insertLineAboveMarker(filePath: string, marker: string, line: string): void {
  const lines = readFileSync(filePath, 'utf8').split('\n');
  const index = lines.findIndex((l) => l.trim() === marker);
  if (index === -1) throw new Error(`could not find the "${marker}" marker in "${filePath}".`);
  const indent = /^\s*/.exec(lines[index])?.[0] ?? '';
  lines.splice(index, 0, `${indent}${line}`);
  writeFileSync(filePath, lines.join('\n'));
}

function replaceInFile(filePath: string, search: string, replacement: string): void {
  const content = readFileSync(filePath, 'utf8');
  if (!content.includes(search)) throw new Error(`could not find "${search}" in "${filePath}".`);
  writeFileSync(filePath, content.replace(search, replacement));
}

function prependToFile(filePath: string, text: string): void {
  writeFileSync(filePath, text + readFileSync(filePath, 'utf8'));
}

/** Makes the database client (`fastify.db`) injectable, so services can depend on `{ db }`. */
function registerDatabaseInContainer(targetDir: string): void {
  const diDir = join(targetDir, 'src', 'infrastructure', 'di');
  const pluginPath = join(diDir, 'container.plugin.ts');
  const typesPath = join(diDir, 'di.types.ts');
  replaceInFile(
    pluginPath,
    "import { fastifyAwilixPlugin } from '@fastify/awilix';",
    "import { diContainer, fastifyAwilixPlugin } from '@fastify/awilix';\nimport { asValue } from 'awilix';",
  );
  prependToFile(typesPath, "import type { FastifyInstance } from 'fastify';\n\n");
  insertLineAboveMarker(
    pluginPath,
    DI_REGISTRATIONS_MARKER,
    'diContainer.register({ db: asValue(fastify.db) });',
  );
  insertLineAboveMarker(typesPath, DI_CRADLE_MARKER, "db: FastifyInstance['db'];");
}

export function scaffoldProject({
  targetDir,
  projectName,
  cliVersion,
  database = 'none',
  di = 'native',
  packageManager,
  templatesDir = TEMPLATES_DIR,
  overlaysDir = OVERLAYS_DIR,
}: ScaffoldOptions): void {
  const alreadyExisted = existsSync(targetDir);
  const overlayDir = database === 'none' ? undefined : join(overlaysDir, database);
  const diOverlayDir = di === 'native' ? undefined : join(overlaysDir, 'di', di);
  const writtenTopLevel = new Set<string>(['.fastify-ep.json', 'pnpm-workspace.yaml']);

  try {
    if (overlayDir !== undefined && !existsSync(overlayDir)) {
      throw new Error(`no template overlay for database "${database}" at "${overlayDir}".`);
    }

    if (diOverlayDir !== undefined && !existsSync(diOverlayDir)) {
      throw new Error(`no template overlay for DI strategy "${di}" at "${diOverlayDir}".`);
    }

    readdirSync(templatesDir).forEach((name) => writtenTopLevel.add(destinationName(name, true)));
    copyTemplateDir(templatesDir, targetDir, projectName);

    if (overlayDir !== undefined) {
      readdirSync(overlayDir).forEach((name) => writtenTopLevel.add(destinationName(name, true)));
      copyTemplateDir(overlayDir, targetDir, projectName);
    }

    if (diOverlayDir !== undefined) {
      readdirSync(diOverlayDir).forEach((name) => writtenTopLevel.add(destinationName(name, true)));
      copyTemplateDir(diOverlayDir, targetDir, projectName);
      if (database !== 'none') {
        registerDatabaseInContainer(targetDir);
      }
    }

    const appTsPath = join(targetDir, 'src', 'app.ts');
    if (database !== 'none') {
      insertInfrastructureRegistration(appTsPath, DATABASE_PLUGIN_PATH);
    }
    if (di === 'awilix') {
      // After the database plugin, so `fastify.db` already exists when the container registers it.
      insertInfrastructureRegistration(appTsPath, DI_PLUGIN_PATH);
    }
    insertModuleRegistration(appTsPath, 'health');

    if (packageManager === 'pnpm') {
      writeFileSync(join(targetDir, 'pnpm-workspace.yaml'), pnpmWorkspaceYaml(database));
    }

    const manifest: Manifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      fastifyEpVersion: cliVersion,
      architecture: { schema: 'typebox', di, database },
      modules: ['health'],
    };
    writeFileSync(join(targetDir, '.fastify-ep.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (err) {
    if (!alreadyExisted) {
      rmSync(targetDir, { recursive: true, force: true });
    } else {
      for (const name of writtenTopLevel) {
        rmSync(join(targetDir, name), { recursive: true, force: true });
      }
    }
    throw err;
  }
}
