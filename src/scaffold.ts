import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Manifest, MANIFEST_SCHEMA_VERSION, type DatabaseStrategy } from './manifest.js';
import type { PackageManager } from './package-manager.js';
import { insertInfrastructureRegistration, insertModuleRegistration } from './register-module.js';
import { renderTemplate } from './template-engine.js';

const TEMPLATES_DIR = fileURLToPath(new URL('../templates', import.meta.url));
const OVERLAYS_DIR = fileURLToPath(new URL('../template-overlays', import.meta.url));

/** Where each database overlay's plugin lives, relative to `src/` and without extension. */
export const DATABASE_PLUGIN_PATH = 'infrastructure/database/database.plugin';

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
    const destPath = join(destDir, entry.name);
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

export function scaffoldProject({
  targetDir,
  projectName,
  cliVersion,
  database = 'none',
  packageManager,
  templatesDir = TEMPLATES_DIR,
  overlaysDir = OVERLAYS_DIR,
}: ScaffoldOptions): void {
  const alreadyExisted = existsSync(targetDir);
  const overlayDir = database === 'none' ? undefined : join(overlaysDir, database);
  const writtenTopLevel = new Set<string>(['.fastify-ep.json', 'pnpm-workspace.yaml']);

  try {
    if (overlayDir !== undefined && !existsSync(overlayDir)) {
      throw new Error(`no template overlay for database "${database}" at "${overlayDir}".`);
    }

    readdirSync(templatesDir).forEach((name) => writtenTopLevel.add(name));
    copyTemplateDir(templatesDir, targetDir, projectName);

    if (overlayDir !== undefined) {
      readdirSync(overlayDir).forEach((name) => writtenTopLevel.add(name));
      copyTemplateDir(overlayDir, targetDir, projectName);
    }

    const appTsPath = join(targetDir, 'src', 'app.ts');
    if (database !== 'none') {
      insertInfrastructureRegistration(appTsPath, DATABASE_PLUGIN_PATH);
    }
    insertModuleRegistration(appTsPath, 'health');

    if (packageManager === 'pnpm') {
      writeFileSync(join(targetDir, 'pnpm-workspace.yaml'), pnpmWorkspaceYaml(database));
    }

    const manifest: Manifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      fastifyEpVersion: cliVersion,
      architecture: { schema: 'typebox', di: 'native', database },
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
