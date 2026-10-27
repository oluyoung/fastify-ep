import { fileURLToPath } from 'node:url';
import { toCamelCase, toPascalCase } from './case.js';
import { generateUnit } from './generate-core.js';
import { type DiScope } from './manifest.js';

export {
  InvalidModuleNameError,
  ModuleCollisionError,
  NotScaffoldedError,
} from './generate-core.js';

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

export function generateModule({
  targetDir,
  moduleName,
  withTests = true,
  scope = 'singleton',
  moduleTemplateDir = MODULE_TEMPLATE_DIR,
  awilixTemplateDir = AWILIX_MODULE_TEMPLATE_DIR,
}: GenerateModuleOptions): void {
  generateUnit({
    targetDir,
    name: moduleName,
    withTests,
    plan: (manifest) => ({
      // The Awilix variants replace the native files of the same name.
      templateDirs:
        manifest.architecture.di === 'awilix'
          ? [moduleTemplateDir, awilixTemplateDir]
          : [moduleTemplateDir],
      vars: {
        moduleName,
        camelModuleName: toCamelCase(moduleName),
        ModuleName: toPascalCase(moduleName),
        // `database` is not used by the built-in module templates yet; available to database-aware ones.
        database: manifest.architecture.database,
        di: manifest.architecture.di,
        lifetime: scope === 'request' ? 'SCOPED' : 'SINGLETON',
      },
    }),
  });
}
