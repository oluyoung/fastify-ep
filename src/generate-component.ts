import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCamelCase, toPascalCase } from './case.js';
import { recordFiles, refreshIfPristine, writeManifest } from './file-hashes.js';
import {
  GenerationConflictError,
  InvalidModuleNameError,
  NotScaffoldedError,
  ProjectFileMissingError,
} from './generate-core.js';
import { readManifest, type DatabaseStrategy, type DiScope } from './manifest.js';
import { wireModule, wiringSnippets, type WiringParams } from './module-wiring.js';
import { renderTemplate } from './template-engine.js';
import { validateName } from './validate-name.js';

/** Directory holding the `component-template-*` dirs (the package root). */
const TEMPLATE_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Manifest keys are always `/`-separated, so these must not be built with `join`.
const DRIZZLE_SCHEMA_PATH = 'src/infrastructure/database/schema.ts';
const PRISMA_SCHEMA_PATH = 'prisma/schema.prisma';

export const COMPONENT_KINDS = ['service', 'schema', 'repository'] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export interface GenerateComponentOptions {
  targetDir: string;
  kind: ComponentKind;
  name: string;
  /** The module the file is added to. */
  module: string;
  /** Repository only: the existing Prisma model or Drizzle table export to read. */
  model?: string;
  withTests?: boolean;
  /** Awilix projects only; defaults to `singleton`. */
  scope?: DiScope;
  templateRoot?: string;
}

export interface GenerateComponentResult {
  /** Project-relative paths written. */
  files: string[];
  /** True when the module file was updated; false means the user has to wire it by hand. */
  wired: boolean;
  notes: string[];
}

export class ModuleNotFoundError extends Error {
  constructor(module: string, known: string[]) {
    super(
      `there is no module named "${module}" in this project` +
        (known.length > 0 ? ` (modules: ${known.join(', ')}).` : '.'),
    );
    this.name = 'ModuleNotFoundError';
  }
}

export class ComponentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComponentInputError';
  }
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const PRISMA_MODEL = /^[A-Z][A-Za-z0-9]*$/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Drizzle: the source of `export const <model> = pgTable(...)` in the schema or what it re-exports. */
function findDrizzleTable(targetDir: string, model: string): string | undefined {
  const schemaPath = join(targetDir, DRIZZLE_SCHEMA_PATH);
  if (!existsSync(schemaPath)) throw new ProjectFileMissingError(DRIZZLE_SCHEMA_PATH);
  const schema = readFileSync(schemaPath, 'utf8');
  const sources = [schema];
  for (const match of schema.matchAll(/export \* from '([^']+)'/g)) {
    const file = join(dirname(schemaPath), match[1].replace(/\.js$/, '.ts'));
    if (existsSync(file)) sources.push(readFileSync(file, 'utf8'));
  }
  const declaration = new RegExp(`export const ${escapeRegExp(model)}\\b[\\s\\S]*?\\n\\}?\\);?\\n`);
  for (const source of sources) {
    const found = declaration.exec(source);
    if (found) return found[0];
  }
  return undefined;
}

/** Prisma: the body of `model <Model> { ... }`. */
function findPrismaModel(targetDir: string, model: string): string | undefined {
  const schemaPath = join(targetDir, PRISMA_SCHEMA_PATH);
  if (!existsSync(schemaPath)) throw new ProjectFileMissingError(PRISMA_SCHEMA_PATH);
  const found = new RegExp(`model\\s+${model}\\s*\\{[\\s\\S]*?\\n\\}`).exec(
    readFileSync(schemaPath, 'utf8'),
  );
  return found?.[0];
}

function templateDirsFor(
  kind: ComponentKind,
  database: DatabaseStrategy,
  templateRoot: string,
): string[] {
  const name =
    kind === 'repository'
      ? `component-template-repository-${database}`
      : `component-template-${kind}`;
  return [join(templateRoot, name)];
}

/** Module files under `src/modules` that already use `key`, as a decorator or a cradle entry. */
function modulesUsingKey(targetDir: string, key: string): string[] {
  const modulesDir = join(targetDir, 'src', 'modules');
  if (!existsSync(modulesDir)) return [];
  const pattern = new RegExp(`\\b${escapeRegExp(key)}\\b`);
  return readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((module) => {
      const file = join(modulesDir, module, `${module}.module.ts`);
      return existsSync(file) && pattern.test(readFileSync(file, 'utf8'));
    });
}

/**
 * Adds one file (a service, a schema or a repository) to an existing module. A service or
 * repository is registered in the module's `<module>.module.ts`; if that file no longer has the
 * generated shape, nothing in it is changed and the lines to add are returned in `notes`. On failure
 * nothing is left behind.
 */
export function generateComponent({
  targetDir,
  kind,
  name,
  module,
  model,
  withTests = true,
  scope = 'singleton',
  templateRoot = TEMPLATE_ROOT,
}: GenerateComponentOptions): GenerateComponentResult {
  const nameResult = validateName(name);
  if (!nameResult.valid) throw new InvalidModuleNameError(name, nameResult.reason);

  const manifestPath = join(targetDir, '.fastify-ep.json');
  if (!existsSync(manifestPath)) throw new NotScaffoldedError(targetDir);
  const manifest = readManifest(manifestPath);
  const { database, di } = manifest.architecture;

  const known = manifest.modules.filter((m) => m !== 'health');
  if (!known.includes(module)) throw new ModuleNotFoundError(module, known);

  if (kind === 'repository') {
    if (database === 'none') {
      throw new ComponentInputError(
        'a repository needs a database. This project was created with --database none; ' +
          'there is nothing for it to read.',
      );
    }
    if (model === undefined || model === '') {
      throw new ComponentInputError(
        `a repository needs --model, the existing ${
          database === 'prisma'
            ? 'Prisma model (for example User)'
            : 'Drizzle table export (for example usersTable)'
        } it reads.`,
      );
    }
  } else if (model !== undefined) {
    throw new ComponentInputError('--model only applies to "generate repository".');
  }

  // Check the model before touching anything.
  let delegate = '';
  if (kind === 'repository' && model !== undefined) {
    if (database === 'prisma') {
      if (!PRISMA_MODEL.test(model)) {
        throw new ComponentInputError(
          `invalid --model "${model}": a Prisma model name starts with a capital letter (for example User).`,
        );
      }
      const body = findPrismaModel(targetDir, model);
      if (body === undefined) {
        throw new ComponentInputError(`prisma/schema.prisma has no model named ${model}.`);
      }
      if (!/^\s*id\s+String\b/m.test(body)) {
        throw new ComponentInputError(
          `the ${model} model needs an "id String" field; the generated findById looks rows up by it.`,
        );
      }
      delegate = model[0].toLowerCase() + model.slice(1);
    } else {
      if (!IDENTIFIER.test(model)) {
        throw new ComponentInputError(`invalid --model "${model}": not a valid identifier.`);
      }
      const table = findDrizzleTable(targetDir, model);
      if (table === undefined) {
        throw new ComponentInputError(
          `${DRIZZLE_SCHEMA_PATH} does not export a table named ${model} (directly or through an "export *").`,
        );
      }
      if (!/\bid\s*:\s*(uuid|text|varchar)\(/.test(table)) {
        throw new ComponentInputError(
          `the ${model} table needs an id column of type uuid, text or varchar; the generated findById looks rows up by it.`,
        );
      }
    }
  }

  const moduleDir = join(targetDir, 'src', 'modules', module);
  const moduleFilePath = join(moduleDir, `${module}.module.ts`);
  const className = `${toPascalCase(name)}${toPascalCase(kind)}`;
  const key = `${toCamelCase(name)}${toPascalCase(kind)}`;

  // Collisions: the file, and (for registered kinds) the key anywhere in the project.
  const suffixes = new Map<string, string>();
  for (const dir of templateDirsFor(kind, database, templateRoot)) {
    for (const entry of readdirSync(dir)) {
      suffixes.set(entry.replace(/^component\./, ''), join(dir, entry));
    }
  }
  const targets = [...suffixes.keys()]
    .filter((suffix) => withTests || !suffix.endsWith('test.ts'))
    .map((suffix) => ({ suffix, path: `src/modules/${module}/${name}.${suffix}` }))
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const target of targets) {
    if (existsSync(join(targetDir, target.path))) {
      throw new GenerationConflictError(`${target.path} already exists.`);
    }
  }
  if (kind !== 'schema') {
    const clashes = modulesUsingKey(targetDir, key);
    if (clashes.length > 0) {
      throw new GenerationConflictError(
        `"${key}" is already registered in ${clashes.map((m) => `${m}.module.ts`).join(', ')}. ` +
          'Every module shares one Fastify instance, so a second one would replace the first. Pick another name.',
      );
    }
  }
  if (!existsSync(moduleFilePath) && kind !== 'schema') {
    throw new ProjectFileMissingError(`src/modules/${module}/${module}.module.ts`);
  }

  const vars = {
    name,
    Name: toPascalCase(name),
    camelName: toCamelCase(name),
    module,
    model: model ?? '',
    delegate,
  };

  const written: string[] = [];
  const createdDir = !existsSync(moduleDir);
  let moduleFileBefore: string | undefined;
  try {
    mkdirSync(moduleDir, { recursive: true });
    for (const target of targets) {
      const content = readFileSync(suffixes.get(target.suffix) as string, 'utf8');
      writeFileSync(join(targetDir, target.path), renderTemplate(content, vars));
      written.push(target.path);
    }

    const notes: string[] = [];
    let wired = true;
    const changed = [...written];
    if (kind !== 'schema') {
      const params: WiringParams = {
        di,
        kind,
        className,
        key,
        importFile: `${name}.${kind}.js`,
        withDb: kind === 'repository',
        lifetime: kind === 'repository' || scope !== 'request' ? 'SINGLETON' : 'SCOPED',
      };
      moduleFileBefore = readFileSync(moduleFilePath, 'utf8');
      const updated = wireModule(moduleFileBefore, params);
      if (updated === undefined) {
        wired = false;
        const snippets = wiringSnippets(params);
        notes.push(
          `src/modules/${module}/${module}.module.ts no longer has the generated shape, so it was left as it is. Add these by hand:\n` +
            `  import: ${snippets.importLine}\n` +
            `  in the "declare module" interface: ${snippets.augmentation.trim()}\n` +
            `  in registerDependencies: ${snippets.registration.trim()}`,
        );
      } else {
        const modulePath = `src/modules/${module}/${module}.module.ts`;
        refreshIfPristine(manifest, targetDir, modulePath, () =>
          writeFileSync(moduleFilePath, updated),
        );
      }
    }

    if (manifest.files) Object.assign(manifest.files, recordFiles(targetDir, changed));
    writeManifest(manifestPath, manifest);
    return { files: written, wired, notes };
  } catch (err) {
    for (const path of written) rmSync(join(targetDir, path), { force: true });
    if (createdDir) rmSync(moduleDir, { recursive: true, force: true });
    if (moduleFileBefore !== undefined) writeFileSync(moduleFilePath, moduleFileBefore);
    throw err;
  }
}
