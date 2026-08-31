import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCamelCase, toPascalCase } from './case.js';
import { insertModuleRegistration } from './register-module.js';
import { renderTemplate } from './template-engine.js';

const MODULE_TEMPLATE_DIR = fileURLToPath(new URL('../module-template', import.meta.url));

export interface GenerateModuleOptions {
  targetDir: string;
  moduleName: string;
  /** Override for tests; defaults to this package's real `module-template/` dir. */
  moduleTemplateDir?: string;
}

interface Manifest {
  version: string;
  diStrategy: string;
  modules: string[];
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

function readManifest(manifestPath: string): Manifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
}

export function generateModule({
  targetDir,
  moduleName,
  moduleTemplateDir = MODULE_TEMPLATE_DIR,
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
  };

  mkdirSync(moduleDir, { recursive: true });
  for (const entry of readdirSync(moduleTemplateDir)) {
    const suffix = entry.replace(/^module\./, '');
    const content = readFileSync(join(moduleTemplateDir, entry), 'utf8');
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
