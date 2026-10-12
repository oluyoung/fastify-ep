import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isModuleRegistered } from './register-module.js';
import { InvalidManifestError, LegacyManifestError, readManifest } from './manifest.js';

export interface DoctorCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

const MIN_NODE_MAJOR = 20;
const SUPPORTED_FASTIFY_MAJOR = 5;

const HEALTH_MODULE_FILES = [
  'health.module.ts',
  'health.controller.ts',
  'health.service.ts',
  'health.schema.ts',
];

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
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      fastifyRange = pkg.dependencies?.fastify;
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
        missingModules.length === 0
          ? undefined
          : `missing on disk: ${missingModules.join(', ')}.`,
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
  const missingHealthFiles = HEALTH_MODULE_FILES.filter((file) => !existsSync(join(healthDir, file)));
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

  return checks;
}
