import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DoctorCheck } from './doctor.js';
import {
  findMethodCalls,
  scanProject,
  type ScannedFile,
  type ScannedImport,
} from './scan-imports.js';

/*
 * Architecture rules for `doctor`. Every rule is a warning, and a rule that cannot be sure stays
 * silent: imports that are type-only never count, and only the generated layout is inspected.
 * Each rule id names the spec it comes from.
 */

export const RULE_CROSS_MODULE = 'FEP-002/cross-module-import';
export const RULE_CONTROLLER_DATABASE = 'FEP-003/no-database-in-controller';
export const RULE_SERVICE_CONTROLLER = 'FEP-004/service-imports-controller';
export const RULE_TYPEBOX = 'FEP-005/typebox-schemas';
export const RULE_SERVER_BOUNDARY = 'FEP-001/server-boundary';

/** Packages that are, or wrap, a database client. */
const DATABASE_PACKAGES = new Set([
  'drizzle-orm',
  'postgres',
  '@prisma/client',
  '@prisma/adapter-pg',
]);
/** Project-relative path prefixes that hold the database client or its generated code. */
const DATABASE_PATHS = ['src/infrastructure/database/', 'src/generated/'];

/** Roles whose code another module should reach through the Fastify instance, not by import. */
const MODULE_PRIVATE_ROLES = new Set(['controller', 'service', 'repository']);

interface Finding {
  name: string;
  detail: string;
  /** Where the finding is, so a `fastify-ep-ignore` comment above it can silence it. */
  file?: string;
  line?: number;
}

/** `src/modules/users/users.service.ts` -> `users/users.service.ts`. */
function shortPath(path: string): string {
  return path.replace(/^src\/modules\//, '');
}

const roleOfPath = (path: string): string | undefined => /\.(\w+)\.ts$/.exec(path)?.[1];

function runtimeImports(file: ScannedFile): ScannedImport[] {
  return file.imports.filter((i) => !i.typeOnly);
}

function rule(id: string, passName: string, findings: Finding[]): DoctorCheck[] {
  if (findings.length === 0) {
    return [{ group: 'Architecture', severity: 'warning', name: passName, pass: true, rule: id }];
  }
  return findings.map((finding) => ({
    group: 'Architecture',
    severity: 'warning',
    pass: false,
    rule: id,
    ...finding,
  }));
}

function crossModuleFindings(files: ScannedFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!file.module) continue;
    for (const imp of runtimeImports(file)) {
      if (!imp.resolved) continue;
      const target = files.find((f) => f.path === imp.resolved);
      const targetModule = target?.module ?? /^src\/modules\/([^/]+)\//.exec(imp.resolved)?.[1];
      const targetRole = target?.role ?? roleOfPath(imp.resolved);
      if (!targetModule || targetModule === file.module) continue;
      if (!targetRole || !MODULE_PRIVATE_ROLES.has(targetRole)) continue;
      findings.push({
        name: `${shortPath(file.path)} imports ${shortPath(imp.resolved)}`,
        detail:
          `${file.path}:${imp.line} imports the ${targetRole} of the "${targetModule}" module. ` +
          `Share types through its schema file, or call it through the Fastify instance.`,
        file: file.path,
        line: imp.line,
      });
    }
  }
  return findings;
}

function controllerDatabaseFindings(files: ScannedFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files.filter((f) => f.role === 'controller')) {
    for (const imp of runtimeImports(file)) {
      const target = imp.package ?? imp.resolved ?? '';
      const isDatabase =
        (imp.package !== undefined && DATABASE_PACKAGES.has(imp.package)) ||
        DATABASE_PATHS.some((prefix) => imp.resolved?.startsWith(prefix));
      if (!isDatabase) continue;
      findings.push({
        name: `${shortPath(file.path)} imports ${target}`,
        detail:
          `${file.path}:${imp.line} imports the database client. Controllers call a service; ` +
          `the service or repository talks to the database.`,
        file: file.path,
        line: imp.line,
      });
    }
  }
  return findings;
}

function serviceControllerFindings(files: ScannedFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files.filter((f) => f.role === 'service')) {
    for (const imp of runtimeImports(file)) {
      if (!imp.resolved || roleOfPath(imp.resolved) !== 'controller') continue;
      findings.push({
        name: `${shortPath(file.path)} imports ${shortPath(imp.resolved)}`,
        detail:
          `${file.path}:${imp.line} imports a controller. Services hold the logic; ` +
          `controllers depend on services, not the other way round.`,
        file: file.path,
        line: imp.line,
      });
    }
  }
  return findings;
}

function typeboxFindings(files: ScannedFile[]): Finding[] {
  return files
    .filter((f) => f.role === 'schema' && f.module)
    .filter((f) => !f.imports.some((i) => i.package === '@sinclair/typebox'))
    .map((file) => ({
      name: `${shortPath(file.path)} does not use TypeBox`,
      detail: `${file.path} does not import "@sinclair/typebox", but this project's schemas are TypeBox.`,
      file: file.path,
    }));
}

function serverBoundaryFindings(root: string, files: ScannedFile[]): Finding[] {
  const findings: Finding[] = [];
  if (!files.some((f) => f.path === 'src/server.ts')) {
    findings.push({
      name: 'src/server.ts is missing',
      detail: 'the process entry point lives in src/server.ts; src/app.ts only builds the app.',
    });
  }
  try {
    const lines = findMethodCalls(readFileSync(join(root, 'src', 'app.ts'), 'utf8'), 'listen');
    for (const line of lines) {
      findings.push({
        name: 'src/app.ts starts the server',
        detail: `src/app.ts:${line} calls listen(). Start the server in src/server.ts so tests can build the app without binding a port.`,
        file: 'src/app.ts',
        line,
      });
    }
  } catch {
    // No app.ts, or one the scanner cannot read: other checks cover a missing file.
  }
  return findings;
}

const KNOWN_RULES = new Set([
  RULE_SERVER_BOUNDARY,
  RULE_CROSS_MODULE,
  RULE_CONTROLLER_DATABASE,
  RULE_SERVICE_CONTROLLER,
  RULE_TYPEBOX,
]);

function info(name: string, detail: string): DoctorCheck {
  return { group: 'Architecture', severity: 'info', name, detail, pass: true };
}

/**
 * The architecture checks for the project at `root`. Every failure is a warning. A finding is
 * silenced by `// fastify-ep-ignore <rule-id>` on the line above it (a finding that belongs to the
 * whole file is silenced by the comment anywhere in the file); ignores that silence nothing, and
 * files the scanner could not read, come back as info lines.
 */
export function runArchitectureChecks(root: string): DoctorCheck[] {
  const { files, unparsed } = scanProject(root);
  const used = new Set<string>();

  const unsilenced = (id: string, findings: Finding[]): Finding[] =>
    findings.filter((finding) => {
      const file = files.find((f) => f.path === finding.file);
      const directive = file?.ignores.find(
        (d) => d.rules.includes(id) && (finding.line === undefined || d.line === finding.line - 1),
      );
      if (!file || !directive) return true;
      used.add(`${file.path}:${directive.line}:${id}`);
      return false;
    });

  const rules: Array<[string, string, Finding[]]> = [
    [RULE_SERVER_BOUNDARY, 'app/server boundary valid', serverBoundaryFindings(root, files)],
    [
      RULE_CROSS_MODULE,
      "modules do not import each other's controllers, services or repositories",
      crossModuleFindings(files),
    ],
    [
      RULE_CONTROLLER_DATABASE,
      'controllers do not import the database client',
      controllerDatabaseFindings(files),
    ],
    [
      RULE_SERVICE_CONTROLLER,
      'services do not import controllers',
      serviceControllerFindings(files),
    ],
    [RULE_TYPEBOX, 'module schemas use TypeBox', typeboxFindings(files)],
  ];
  const checks = rules.flatMap(([id, passName, findings]) =>
    rule(id, passName, unsilenced(id, findings)),
  );

  for (const file of files) {
    for (const directive of file.ignores) {
      const where = `${file.path}:${directive.line}`;
      if (directive.rules.length === 0) {
        checks.push(
          info(
            `fastify-ep-ignore at ${where} names no rule`,
            'write the rule id, for example fastify-ep-ignore FEP-002/cross-module-import.',
          ),
        );
      }
      for (const id of directive.rules) {
        if (!KNOWN_RULES.has(id)) {
          checks.push(
            info(
              `fastify-ep-ignore at ${where} names an unknown rule`,
              `"${id}" is not a fastify-ep rule.`,
            ),
          );
        } else if (!used.has(`${file.path}:${directive.line}:${id}`)) {
          checks.push(
            info(
              `unused fastify-ep-ignore at ${where}`,
              `there is no ${id} finding for it to silence.`,
            ),
          );
        }
      }
    }
  }
  for (const { path, reason } of unparsed) {
    checks.push(info(`${path} was not scanned`, reason));
  }
  return checks;
}
