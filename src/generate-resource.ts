import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { singularize, toCamelCase, toPascalCase } from './case.js';
import { generateUnit, type FileAppend, type GenerationResult } from './generate-core.js';
import { type DatabaseStrategy, type DiScope } from './manifest.js';
import { validateName } from './validate-name.js';

/** Directory holding the `resource-template*` dirs (the package root). */
const TEMPLATE_ROOT = fileURLToPath(new URL('..', import.meta.url));

const DRIZZLE_SCHEMA_PATH = join('src', 'infrastructure', 'database', 'schema.ts');
const PRISMA_SCHEMA_PATH = join('prisma', 'schema.prisma');

export interface GenerateResourceOptions {
  targetDir: string;
  resourceName: string;
  withTests?: boolean;
  /** Awilix projects only; defaults to `singleton`. */
  scope?: DiScope;
  /** Entity name in kebab-case; defaults to a naive singular of `resourceName`. */
  singular?: string;
  /** Adds create/read/update/delete routes backed by the project's database. */
  crud?: boolean;
  templateRoot?: string;
}

export class InvalidSingularNameError extends Error {
  constructor(singular: string, reason: string) {
    super(`invalid --singular "${singular}": ${reason}`);
    this.name = 'InvalidSingularNameError';
  }
}

/** The ORM-specific edit to the project's schema file, so the generated repository compiles. */
function schemaAppend(
  database: DatabaseStrategy,
  v: { moduleName: string; tableName: string; EntityName: string },
): FileAppend | undefined {
  if (database === 'drizzle') {
    return {
      path: DRIZZLE_SCHEMA_PATH,
      text: `export * from '../../modules/${v.moduleName}/${v.moduleName}.table.js';\n`,
      conflict: {
        pattern: new RegExp(`pgTable\\(\\s*['"]${v.tableName}['"]`),
        message: `src/infrastructure/database/schema.ts already defines a "${v.tableName}" table.`,
      },
    };
  }
  if (database === 'prisma') {
    return {
      path: PRISMA_SCHEMA_PATH,
      text: [
        '',
        `model ${v.EntityName} {`,
        '  id   String @id @default(uuid())',
        '  name String',
        '',
        `  @@map("${v.tableName}")`,
        '}',
        '',
      ].join('\n'),
      conflict: {
        pattern: new RegExp(`model\\s+${v.EntityName}\\s*\\{|@@map\\(\\s*"${v.tableName}"\\s*\\)`),
        message: `prisma/schema.prisma already defines a ${v.EntityName} model or a "${v.tableName}" table.`,
      },
    };
  }
  return undefined;
}

/** A resource is a module plus a repository: same location, registration and manifest entry. */
export function generateResource({
  targetDir,
  resourceName,
  withTests = true,
  scope = 'singleton',
  singular,
  crud = false,
  templateRoot = TEMPLATE_ROOT,
}: GenerateResourceOptions): GenerationResult {
  if (singular !== undefined) {
    const result = validateName(singular);
    if (!result.valid) throw new InvalidSingularNameError(singular, result.reason);
  }
  const singularName = singular ?? singularize(resourceName);

  return generateUnit({
    targetDir,
    name: resourceName,
    withTests,
    plan: (manifest) => {
      const { database, di } = manifest.architecture;
      const orm = crud && database !== 'none';

      // Later dirs replace earlier files of the same name.
      const names = ['resource-template'];
      if (crud) names.push('resource-template-crud');
      if (orm) names.push('resource-template-crud-orm', `resource-template-crud-${database}`);
      if (di === 'awilix') names.push('resource-template-awilix');
      if (crud && di === 'awilix') names.push('resource-template-crud-awilix');

      const vars = {
        moduleName: resourceName,
        camelModuleName: toCamelCase(resourceName),
        ModuleName: toPascalCase(resourceName),
        singularName,
        camelEntityName: toCamelCase(singularName),
        EntityName: toPascalCase(singularName),
        tableName: resourceName.replaceAll('-', '_'),
        database,
        di,
        lifetime: scope === 'request' ? 'SCOPED' : 'SINGLETON',
      };

      const append = orm ? schemaAppend(database, vars) : undefined;
      const notes = orm
        ? [
            database === 'drizzle'
              ? `Added the "${vars.tableName}" table to ${DRIZZLE_SCHEMA_PATH}. Run "npm run db:generate" and then "npm run db:migrate".`
              : `Added the ${vars.EntityName} model to ${PRISMA_SCHEMA_PATH}. Run "npm run db:generate" and then "npm run db:migrate".`,
          ]
        : [];

      return {
        templateDirs: names.map((name) => join(templateRoot, name)),
        vars,
        appends: append ? [append] : [],
        notes,
      };
    },
  });
}
