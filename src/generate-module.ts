import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCamelCase, toPascalCase } from './case.js';
import { readManifest, type DiScope } from './manifest.js';
import { insertModuleRegistration } from './register-module.js';
import { renderTemplate } from './template-engine.js';

const MODULE_TEMPLATE_DIR = fileURLToPath(new URL('../module-template', import.meta.url));
/** Files that replace the base module template's when the project uses Awilix. */
const AWILIX_MODULE_TEMPLATE_DIR = fileURLToPath(
  new URL('../module-template-awilix', import.meta.url),
);

export interface GenerateModuleOptions {
  targetDir: string;
  moduleName: string;
  withTests?: boolean;
  /** Awilix projects only; defaults to `singleton`. */
  scope?: DiScope;
  moduleTemplateDir?: string;
  awilixTemplateDir?: string;
}

export class NotScaffoldedError extends Error {
  constructor(targetDir: string) {
    super(
      `"${targetDir}" is not a fastify-ep project (no .fastify-ep.json found here). ` +
        `Run "fastify-ep init" first, or run this command from a scaffolded project's root.`,
    );
    this.name = 'NotScaffoldedError';
  }
}

export class ModuleCollisionError extends Error {
  constructor(moduleName: string) {
    super(`a module named "${moduleName}" already exists.`);
    this.name = 'ModuleCollisionError';
  }
}

export function generateModule({
  targetDir,
  moduleName,
  withTests = true,
  scope = 'singleton',
  moduleTemplateDir = MODULE_TEMPLATE_DIR,
  awilixTemplateDir = AWILIX_MODULE_TEMPLATE_DIR,
}: GenerateModuleOptions): void {
  const manifestPath = join(targetDir, '.fastify-ep.json');
  if (!existsSync(manifestPath)) {
    throw new NotScaffoldedError(targetDir);
  }

  const manifest = readManifest(manifestPath);
  const moduleDir = join(targetDir, 'src', 'modules', moduleName);
  if (manifest.modules.includes(moduleName) || existsSync(moduleDir)) {
    throw new ModuleCollisionError(moduleName);
  }

  const vars = {
    moduleName,
    camelModuleName: toCamelCase(moduleName),
    ModuleName: toPascalCase(moduleName),
    // `database` is not used by the built-in module templates yet; available to database-aware ones.
    database: manifest.architecture.database,
    di: manifest.architecture.di,
    lifetime: scope === 'request' ? 'SCOPED' : 'SINGLETON',
  };

  // Template file by suffix ("service.ts"); the Awilix variants replace the native ones.
  const templateFiles = new Map<string, string>();
  for (const dir of manifest.architecture.di === 'awilix'
    ? [moduleTemplateDir, awilixTemplateDir]
    : [moduleTemplateDir]) {
    for (const entry of readdirSync(dir)) {
      templateFiles.set(entry.replace(/^module\./, ''), join(dir, entry));
    }
  }

  mkdirSync(moduleDir, { recursive: true });
  for (const [suffix, templatePath] of templateFiles) {
    if (!withTests && suffix === 'test.ts') continue;
    const content = readFileSync(templatePath, 'utf8');
    writeFileSync(join(moduleDir, `${moduleName}.${suffix}`), renderTemplate(content, vars));
  }

  try {
    insertModuleRegistration(join(targetDir, 'src', 'app.ts'), moduleName);
  } catch (err) {
    rmSync(moduleDir, { recursive: true, force: true });
    throw err;
  }

  manifest.modules.push(moduleName);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
