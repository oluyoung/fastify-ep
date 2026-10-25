import { readFileSync, writeFileSync } from 'node:fs';

const MARKER = '// fastify-ep:register';
const INFRASTRUCTURE_MARKER = '// fastify-ep:infrastructure';

export class MarkerNotFoundError extends Error {
  constructor(moduleName: string) {
    super(
      `could not find the "${MARKER}" marker in app.ts. Add this line by hand, directly ` +
        `above where "${MARKER}" used to be:\n` +
        `  await fastify.register((await import('./modules/${moduleName}/${moduleName}.module.js')).default);`,
    );
    this.name = 'MarkerNotFoundError';
  }
}

export class InfrastructureMarkerNotFoundError extends Error {
  constructor(pluginPath: string) {
    super(
      `could not find the "${INFRASTRUCTURE_MARKER}" marker in app.ts. Add this line by hand, ` +
        `directly after the environment plugin is registered:\n` +
        `  ${infrastructureRegistrationLine(pluginPath)}`,
    );
    this.name = 'InfrastructureMarkerNotFoundError';
  }
}

function registrationLine(moduleName: string): string {
  return `await fastify.register((await import('./modules/${moduleName}/${moduleName}.module.js')).default);`;
}

/** `pluginPath` is relative to `src/`, without extension, e.g. `infrastructure/database/database.plugin`. */
export function infrastructureRegistrationLine(pluginPath: string): string {
  return `await fastify.register((await import('./${pluginPath}.js')).default);`;
}

function hasLine(content: string, line: string): boolean {
  return content.split('\n').some((l) => l.trim() === line);
}

function insertAboveMarker(
  appTsPath: string,
  marker: string,
  line: string,
  notFound: () => Error,
): void {
  const content = readFileSync(appTsPath, 'utf8');
  const lines = content.split('\n');
  const markerIndex = lines.findIndex((l) => l.trim() === marker);
  if (markerIndex === -1) {
    throw notFound();
  }

  const indent = /^\s*/.exec(lines[markerIndex])?.[0] ?? '';
  lines.splice(markerIndex, 0, `${indent}${line}`);
  writeFileSync(appTsPath, lines.join('\n'));
}

export function isModuleRegistered(appTsContent: string, moduleName: string): boolean {
  return hasLine(appTsContent, registrationLine(moduleName));
}

export function insertModuleRegistration(appTsPath: string, moduleName: string): void {
  insertAboveMarker(
    appTsPath,
    MARKER,
    registrationLine(moduleName),
    () => new MarkerNotFoundError(moduleName),
  );
}

export function isInfrastructureRegistered(appTsContent: string, pluginPath: string): boolean {
  return hasLine(appTsContent, infrastructureRegistrationLine(pluginPath));
}

export function insertInfrastructureRegistration(appTsPath: string, pluginPath: string): void {
  insertAboveMarker(
    appTsPath,
    INFRASTRUCTURE_MARKER,
    infrastructureRegistrationLine(pluginPath),
    () => new InfrastructureMarkerNotFoundError(pluginPath),
  );
}
