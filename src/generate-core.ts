import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest, type Manifest } from './manifest.js';
import { insertModuleRegistration } from './register-module.js';
import { renderTemplate } from './template-engine.js';
import { validateName } from './validate-name.js';

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

export class InvalidModuleNameError extends Error {
  constructor(moduleName: string, reason: string) {
    super(`invalid module name "${moduleName}": ${reason}`);
    this.name = 'InvalidModuleNameError';
  }
}

export class ProjectFileMissingError extends Error {
  constructor(path: string) {
    super(`expected "${path}" in this project but it does not exist.`);
    this.name = 'ProjectFileMissingError';
  }
}

export class GenerationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationConflictError';
  }
}

/** Text appended to an existing project file, e.g. a table export or a model block. */
export interface FileAppend {
  /** Relative to the project root. */
  path: string;
  text: string;
  /** If the file already matches `pattern`, generation stops with `message`. */
  conflict?: { pattern: RegExp; message: string };
}

/** What a generator contributes once the project's manifest is known. */
export interface GenerationPlan {
  /** Template dirs in overlay order: a later dir's file replaces an earlier one's of the same name. */
  templateDirs: string[];
  /** Variables substituted into every template. */
  vars: Record<string, string>;
  /** Existing files to append to; checked before anything is written and restored on failure. */
  appends?: FileAppend[];
  /** Follow-up steps for the user, returned to the caller. */
  notes?: string[];
}

export interface GenerationResult {
  notes: string[];
}

export interface GenerateUnitOptions {
  targetDir: string;
  name: string;
  withTests: boolean;
  plan: (manifest: Manifest) => GenerationPlan;
}

/**
 * Generates `src/modules/<name>/` from template dirs, registers it in `app.ts` and records it in
 * the manifest. Shared by every generator that produces a registered module. Template files are
 * named `module.<suffix>` and written as `<name>.<suffix>`. On failure nothing is left behind.
 */
export function generateUnit({
  targetDir,
  name,
  withTests,
  plan,
}: GenerateUnitOptions): GenerationResult {
  const nameResult = validateName(name);
  if (!nameResult.valid) {
    throw new InvalidModuleNameError(name, nameResult.reason);
  }

  const manifestPath = join(targetDir, '.fastify-ep.json');
  if (!existsSync(manifestPath)) {
    throw new NotScaffoldedError(targetDir);
  }

  const manifest = readManifest(manifestPath);
  const moduleDir = join(targetDir, 'src', 'modules', name);
  if (manifest.modules.includes(name) || existsSync(moduleDir)) {
    throw new ModuleCollisionError(name);
  }

  const { templateDirs, vars, appends = [], notes = [] } = plan(manifest);

  // Read every file we will edit up front: a missing file or a conflict must stop us before any write.
  const appendTargets = appends.map((append) => {
    const path = join(targetDir, append.path);
    if (!existsSync(path)) throw new ProjectFileMissingError(append.path);
    const before = readFileSync(path, 'utf8');
    if (append.conflict?.pattern.test(before)) {
      throw new GenerationConflictError(append.conflict.message);
    }
    return { path, before, text: append.text };
  });

  const templateFiles = new Map<string, string>();
  for (const dir of templateDirs) {
    for (const entry of readdirSync(dir)) {
      templateFiles.set(entry.replace(/^module\./, ''), join(dir, entry));
    }
  }

  mkdirSync(moduleDir, { recursive: true });
  for (const [suffix, templatePath] of templateFiles) {
    if (!withTests && suffix === 'test.ts') continue;
    const content = readFileSync(templatePath, 'utf8');
    writeFileSync(join(moduleDir, `${name}.${suffix}`), renderTemplate(content, vars));
  }

  const appTsPath = join(targetDir, 'src', 'app.ts');
  let appTsBefore: string | undefined;
  const written: typeof appendTargets = [];
  try {
    appTsBefore = readFileSync(appTsPath, 'utf8');
    insertModuleRegistration(appTsPath, name);

    for (const target of appendTargets) {
      const separator = target.before.endsWith('\n') ? '' : '\n';
      writeFileSync(target.path, `${target.before}${separator}${target.text}`);
      written.push(target);
    }

    manifest.modules.push(name);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (err) {
    rmSync(moduleDir, { recursive: true, force: true });
    if (appTsBefore !== undefined) writeFileSync(appTsPath, appTsBefore);
    for (const target of written) writeFileSync(target.path, target.before);
    throw err;
  }

  return { notes };
}
