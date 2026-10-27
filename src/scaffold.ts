import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PRESET,
  Manifest,
  MANIFEST_SCHEMA_VERSION,
  type DatabaseStrategy,
  type DiStrategy,
  type Preset,
} from './manifest.js';
import type { PackageManager } from './package-manager.js';
import { insertInfrastructureRegistration, insertModuleRegistration } from './register-module.js';
import { renderTemplate } from './template-engine.js';

const TEMPLATES_DIR = fileURLToPath(new URL('../templates', import.meta.url));
const OVERLAYS_DIR = fileURLToPath(new URL('../template-overlays', import.meta.url));

/** Where each database overlay's plugin lives, relative to `src/` and without extension. */
export const DATABASE_PLUGIN_PATH = 'infrastructure/database/database.plugin';

/** Where the Production preset's security plugin lives, relative to `src/` and without extension. */
export const SECURITY_PLUGIN_PATH = 'infrastructure/http/security.plugin';

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
  /** Defaults to `standard`, which is the base templates plus Swagger. */
  preset?: Preset;
  /** Package manager the project will use; pnpm gets a `pnpm-workspace.yaml`, Production a matching Dockerfile. Defaults to npm for the Dockerfile. */
  packageManager?: PackageManager;
  /**
   * Set when the project sits inside an existing workspace: no nested `pnpm-workspace.yaml` is
   * written, and Production's Dockerfile is the workspace variant (build context = workspace root).
   */
  workspace?: {
    /** The project's path relative to the workspace root, with `/` separators. */
    servicePath: string;
    /** False when no Dockerfile can be generated for this workspace (for example Yarn classic). */
    docker: boolean;
  };
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
  vars: Record<string, string>,
  isRoot = true,
): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, destinationName(entry.name, isRoot));
    if (entry.isDirectory()) {
      copyTemplateDir(srcPath, destPath, vars, false);
      continue;
    }
    const content = renderTemplate(readFileSync(srcPath, 'utf8'), vars);
    if (isRoot && entry.name === 'package.json' && existsSync(destPath)) {
      writeFileSync(destPath, mergePackageJson(destPath, content));
    } else {
      writeFileSync(destPath, content);
    }
  }
}

/** Env keys the Production preset adds, inserted after `SHUTDOWN_TIMEOUT_MS` in whichever `env.ts` the database overlay left. */
function addProductionEnv(targetDir: string): void {
  const envPath = join(targetDir, 'src', 'config', 'env.ts');
  replaceInFile(
    envPath,
    "    SHUTDOWN_TIMEOUT_MS: { type: 'number', default: 10000 },\n",
    "    SHUTDOWN_TIMEOUT_MS: { type: 'number', default: 10000 },\n    CORS_ORIGIN: { type: 'string', default: '' },\n    RATE_LIMIT_MAX: { type: 'number', default: 100 },\n",
  );
  replaceInFile(
    envPath,
    '      SHUTDOWN_TIMEOUT_MS: number;\n',
    '      SHUTDOWN_TIMEOUT_MS: number;\n      CORS_ORIGIN: string;\n      RATE_LIMIT_MAX: number;\n',
  );
}

/** Overlay directories for a preset, in the order they are applied (each includes the previous). */
function presetOverlayNames(preset: Preset): string[] {
  if (preset === 'minimal') return [];
  return preset === 'production' ? ['standard', 'production'] : ['standard'];
}

/** The `pnpm-workspace.yaml` a standalone pnpm project gets (and a workspace root needs merged in). */
export function pnpmWorkspaceYaml(database: DatabaseStrategy): string {
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
  preset = DEFAULT_PRESET,
  packageManager,
  workspace,
  templatesDir = TEMPLATES_DIR,
  overlaysDir = OVERLAYS_DIR,
}: ScaffoldOptions): void {
  const alreadyExisted = existsSync(targetDir);
  const presetDirs = presetOverlayNames(preset).map((name) => join(overlaysDir, 'preset', name));
  const dockerDir =
    preset !== 'production' || workspace?.docker === false
      ? undefined
      : join(overlaysDir, workspace ? 'docker-workspace' : 'docker', packageManager ?? 'npm');
  const vars = { projectName, servicePath: workspace?.servicePath ?? '' };
  const overlayDir = database === 'none' ? undefined : join(overlaysDir, database);
  const diOverlayDir = di === 'native' ? undefined : join(overlaysDir, 'di', di);
  const writtenTopLevel = new Set<string>(['.fastify-ep.json', 'pnpm-workspace.yaml']);

  try {
    for (const dir of [...presetDirs, ...(dockerDir ? [dockerDir] : [])]) {
      if (!existsSync(dir))
        throw new Error(`no template overlay for preset "${preset}" at "${dir}".`);
    }

    if (overlayDir !== undefined && !existsSync(overlayDir)) {
      throw new Error(`no template overlay for database "${database}" at "${overlayDir}".`);
    }

    if (diOverlayDir !== undefined && !existsSync(diOverlayDir)) {
      throw new Error(`no template overlay for DI strategy "${di}" at "${diOverlayDir}".`);
    }

    readdirSync(templatesDir).forEach((name) => writtenTopLevel.add(destinationName(name, true)));
    copyTemplateDir(templatesDir, targetDir, vars);

    for (const dir of [...presetDirs, ...(dockerDir ? [dockerDir] : [])]) {
      readdirSync(dir).forEach((name) => writtenTopLevel.add(destinationName(name, true)));
      copyTemplateDir(dir, targetDir, vars);
    }

    if (overlayDir !== undefined) {
      readdirSync(overlayDir).forEach((name) => writtenTopLevel.add(destinationName(name, true)));
      copyTemplateDir(overlayDir, targetDir, vars);
    }

    if (diOverlayDir !== undefined) {
      readdirSync(diOverlayDir).forEach((name) => writtenTopLevel.add(destinationName(name, true)));
      copyTemplateDir(diOverlayDir, targetDir, vars);
      if (database !== 'none') {
        registerDatabaseInContainer(targetDir);
      }
    }

    if (preset === 'production') addProductionEnv(targetDir);

    const appTsPath = join(targetDir, 'src', 'app.ts');
    if (preset === 'production') {
      insertInfrastructureRegistration(appTsPath, SECURITY_PLUGIN_PATH);
    }
    if (database !== 'none') {
      insertInfrastructureRegistration(appTsPath, DATABASE_PLUGIN_PATH);
    }
    if (di === 'awilix') {
      // After the database plugin, so `fastify.db` already exists when the container registers it.
      insertInfrastructureRegistration(appTsPath, DI_PLUGIN_PATH);
    }
    insertModuleRegistration(appTsPath, 'health');

    if (packageManager === 'pnpm' && !workspace) {
      writeFileSync(join(targetDir, 'pnpm-workspace.yaml'), pnpmWorkspaceYaml(database));
    }

    const manifest: Manifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      fastifyEpVersion: cliVersion,
      architecture: {
        schema: 'typebox',
        di,
        database,
        ...(preset === DEFAULT_PRESET ? {} : { preset }),
      },
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
