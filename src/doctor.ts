import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  InvalidManifestError,
  LegacyManifestError,
  readManifest,
  type DatabaseStrategy,
  type DiStrategy,
} from './manifest.js';
import { DATABASE_PLUGIN_PATH, DI_PLUGIN_PATH } from './scaffold.js';
import {
  infrastructureRegistrationLine,
  isInfrastructureRegistered,
  isModuleRegistered,
} from './register-module.js';

export interface DoctorCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

export const MIN_NODE_MAJOR = 22;
export const SUPPORTED_FASTIFY_MAJOR = 5;

const HEALTH_MODULE_FILES = [
  'health.module.ts',
  'health.controller.ts',
  'health.service.ts',
  'health.schema.ts',
];

const DATABASE_PLUGIN_FILE = `src/${DATABASE_PLUGIN_PATH}.ts`;
const DI_PLUGIN_FILE = `src/${DI_PLUGIN_PATH}.ts`;
const AWILIX_DEPENDENCIES = ['@fastify/awilix', 'awilix'];

/** ORM packages a project with the given strategy must depend on. */
const DATABASE_DEPENDENCIES: Record<Exclude<DatabaseStrategy, 'none'>, string[]> = {
  drizzle: ['drizzle-orm', 'postgres'],
  prisma: ['@prisma/client', '@prisma/adapter-pg'],
};

/** Files that configure the ORM tooling, relative to the project root. */
const DATABASE_CONFIG_FILES: Record<Exclude<DatabaseStrategy, 'none'>, string[]> = {
  drizzle: ['drizzle.config.ts', 'src/infrastructure/database/schema.ts'],
  prisma: ['prisma.config.ts', 'prisma/schema.prisma'],
};

/** Prisma 7 supports Node ^20.19 || ^22.12 || >=24; fastify-ep itself requires >=22. */
export function prismaSupportsNode(version: string): boolean {
  const [major, minor] = version
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(major) || Number.isNaN(minor)) return false;
  return (major === 22 && minor >= 12) || major >= 24;
}

function nodeMajorVersion(version: string): number {
  return Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '', 10);
}

function fastifyMajorVersion(range: string): number {
  const match = /(\d+)/.exec(range);
  return match ? Number.parseInt(match[1], 10) : NaN;
}

export function runDoctorChecks(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const manifestPath = join(cwd, '.fastify-ep.json');
  const isFastifyEpProject = existsSync(manifestPath);
  checks.push({
    name: 'valid fastify-ep project',
    pass: isFastifyEpProject,
    detail: isFastifyEpProject
      ? undefined
      : `no ".fastify-ep.json" found in "${cwd}" — this is not a fastify-ep project.`,
  });

  const nodeMajor = nodeMajorVersion(process.version);
  checks.push({
    name: 'supported Node version',
    pass: nodeMajor >= MIN_NODE_MAJOR,
    detail:
      nodeMajor >= MIN_NODE_MAJOR
        ? undefined
        : `running Node ${process.version}, but fastify-ep requires Node >=${MIN_NODE_MAJOR}.`,
  });

  const packageJsonPath = join(cwd, 'package.json');
  let fastifyRange: string | undefined;
  let dependencies: Record<string, string> = {};
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      dependencies = pkg.dependencies ?? {};
      fastifyRange = dependencies.fastify;
    } catch {
      fastifyRange = undefined;
    }
  }
  const fastifyMajor = fastifyRange ? fastifyMajorVersion(fastifyRange) : NaN;
  const fastifySupported = fastifyMajor === SUPPORTED_FASTIFY_MAJOR;
  checks.push({
    name: 'supported Fastify version',
    pass: fastifySupported,
    detail: fastifySupported
      ? undefined
      : fastifyRange
        ? `"fastify": "${fastifyRange}" in package.json, but fastify-ep requires Fastify ${SUPPORTED_FASTIFY_MAJOR}.x.`
        : `could not find a "fastify" dependency in "${packageJsonPath}".`,
  });

  let manifestModules: string[] | undefined;
  let database: DatabaseStrategy = 'none';
  let di: DiStrategy = 'native';
  if (!isFastifyEpProject) {
    checks.push({
      name: 'manifest schema valid',
      pass: false,
      detail: 'skipped — no manifest to validate.',
    });
  } else {
    try {
      const manifest = readManifest(manifestPath);
      manifestModules = manifest.modules;
      database = manifest.architecture.database;
      di = manifest.architecture.di;
      checks.push({ name: 'manifest schema valid', pass: true });
    } catch (err) {
      const detail =
        err instanceof LegacyManifestError || err instanceof InvalidManifestError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      checks.push({ name: 'manifest schema valid', pass: false, detail });
    }
  }

  const appTsPath = join(cwd, 'src', 'app.ts');
  const appTsContent = existsSync(appTsPath) ? readFileSync(appTsPath, 'utf8') : undefined;

  if (manifestModules === undefined) {
    checks.push({
      name: 'all tracked modules exist',
      pass: false,
      detail: 'skipped — manifest could not be read.',
    });
    checks.push({
      name: 'all generated modules registered',
      pass: false,
      detail: 'skipped — manifest could not be read.',
    });
  } else {
    const missingModules = manifestModules.filter(
      (name) => !existsSync(join(cwd, 'src', 'modules', name, `${name}.module.ts`)),
    );
    checks.push({
      name: 'all tracked modules exist',
      pass: missingModules.length === 0,
      detail:
        missingModules.length === 0 ? undefined : `missing on disk: ${missingModules.join(', ')}.`,
    });

    const unregisteredModules = manifestModules.filter(
      (name) => !appTsContent || !isModuleRegistered(appTsContent, name),
    );
    checks.push({
      name: 'all generated modules registered',
      pass: unregisteredModules.length === 0,
      detail: !appTsContent
        ? `"${appTsPath}" not found.`
        : unregisteredModules.length === 0
          ? undefined
          : `not registered in src/app.ts: ${unregisteredModules.join(', ')}.`,
    });
  }

  const tsconfigPath = join(cwd, 'tsconfig.json');
  let strictMode = false;
  let tsconfigDetail: string | undefined;
  if (!existsSync(tsconfigPath)) {
    tsconfigDetail = `"${tsconfigPath}" not found.`;
  } else {
    try {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as {
        compilerOptions?: { strict?: boolean };
      };
      strictMode = tsconfig.compilerOptions?.strict === true;
      tsconfigDetail = strictMode ? undefined : '"compilerOptions.strict" is not set to true.';
    } catch {
      tsconfigDetail = `"${tsconfigPath}" is not valid JSON.`;
    }
  }
  checks.push({ name: 'TypeScript strict mode enabled', pass: strictMode, detail: tsconfigDetail });

  const envConfigPath = join(cwd, 'src', 'config', 'env.ts');
  const hasEnvConfig = existsSync(envConfigPath);
  checks.push({
    name: 'environment configuration present',
    pass: hasEnvConfig,
    detail: hasEnvConfig ? undefined : `"${envConfigPath}" not found.`,
  });

  const healthDir = join(cwd, 'src', 'modules', 'health');
  const missingHealthFiles = HEALTH_MODULE_FILES.filter(
    (file) => !existsSync(join(healthDir, file)),
  );
  const healthRegistered = !!appTsContent && isModuleRegistered(appTsContent, 'health');
  const healthPresent = missingHealthFiles.length === 0 && healthRegistered;
  checks.push({
    name: 'health module present',
    pass: healthPresent,
    detail: healthPresent
      ? undefined
      : [
          missingHealthFiles.length > 0
            ? `missing files in "${healthDir}": ${missingHealthFiles.join(', ')}.`
            : undefined,
          !healthRegistered ? 'health module is not registered in src/app.ts.' : undefined,
        ]
          .filter(Boolean)
          .join(' '),
  });

  if (database !== 'none') {
    checks.push(...runDatabaseChecks(cwd, database, dependencies, appTsContent));
  }

  if (di === 'awilix') {
    checks.push(...runAwilixChecks(cwd, dependencies, appTsContent, database));
  }

  return checks;
}

function runAwilixChecks(
  cwd: string,
  dependencies: Record<string, string>,
  appTsContent: string | undefined,
  database: DatabaseStrategy,
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const missingDeps = AWILIX_DEPENDENCIES.filter((name) => !dependencies[name]);
  checks.push({
    name: 'awilix dependencies declared',
    pass: missingDeps.length === 0,
    detail:
      missingDeps.length === 0
        ? undefined
        : `missing from "dependencies" in package.json: ${missingDeps.join(', ')}.`,
  });

  const pluginExists = existsSync(join(cwd, DI_PLUGIN_FILE));
  const pluginRegistered =
    !!appTsContent && isInfrastructureRegistered(appTsContent, DI_PLUGIN_PATH);
  // The container registers `fastify.db`, so it must come after the database plugin.
  const orderedAfterDatabase =
    !appTsContent ||
    database === 'none' ||
    appTsContent.indexOf(infrastructureRegistrationLine(DATABASE_PLUGIN_PATH)) <
      appTsContent.indexOf(infrastructureRegistrationLine(DI_PLUGIN_PATH));
  checks.push({
    name: 'DI container plugin present and registered',
    pass: pluginExists && pluginRegistered && orderedAfterDatabase,
    detail:
      [
        pluginExists ? undefined : `"${DI_PLUGIN_FILE}" not found.`,
        pluginRegistered ? undefined : 'the DI container plugin is not registered in src/app.ts.',
        orderedAfterDatabase
          ? undefined
          : 'the DI container plugin must be registered after the database plugin.',
      ]
        .filter(Boolean)
        .join(' ') || undefined,
  });

  return checks;
}

function runDatabaseChecks(
  cwd: string,
  database: Exclude<DatabaseStrategy, 'none'>,
  dependencies: Record<string, string>,
  appTsContent: string | undefined,
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const missingDeps = DATABASE_DEPENDENCIES[database].filter((name) => !dependencies[name]);
  checks.push({
    name: `${database} dependencies declared`,
    pass: missingDeps.length === 0,
    detail:
      missingDeps.length === 0
        ? undefined
        : `missing from "dependencies" in package.json: ${missingDeps.join(', ')}.`,
  });

  const missingConfig = DATABASE_CONFIG_FILES[database].filter(
    (file) => !existsSync(join(cwd, file)),
  );
  checks.push({
    name: `${database} configuration present`,
    pass: missingConfig.length === 0,
    detail: missingConfig.length === 0 ? undefined : `missing: ${missingConfig.join(', ')}.`,
  });

  const pluginExists = existsSync(join(cwd, DATABASE_PLUGIN_FILE));
  const pluginRegistered =
    !!appTsContent && isInfrastructureRegistered(appTsContent, DATABASE_PLUGIN_PATH);
  checks.push({
    name: 'database plugin present and registered',
    pass: pluginExists && pluginRegistered,
    detail:
      [
        pluginExists ? undefined : `"${DATABASE_PLUGIN_FILE}" not found.`,
        pluginRegistered ? undefined : 'the database plugin is not registered in src/app.ts.',
      ]
        .filter(Boolean)
        .join(' ') || undefined,
  });

  const envConfigPath = join(cwd, 'src', 'config', 'env.ts');
  const hasDatabaseUrl =
    existsSync(envConfigPath) && readFileSync(envConfigPath, 'utf8').includes('DATABASE_URL');
  checks.push({
    name: 'DATABASE_URL in environment schema',
    pass: hasDatabaseUrl,
    detail: hasDatabaseUrl ? undefined : '"DATABASE_URL" is not declared in src/config/env.ts.',
  });

  if (database === 'prisma') {
    const nodeOk = prismaSupportsNode(process.version);
    checks.push({
      name: 'Node version supported by Prisma',
      pass: nodeOk,
      detail: nodeOk
        ? undefined
        : `running Node ${process.version}, but Prisma 7 requires Node ^22.12 or >=24.`,
    });
  }

  return checks;
}
