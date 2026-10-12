import { readFileSync, writeFileSync } from 'node:fs';

const MARKER = '// fastify-ep:register';

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

function registrationLine(moduleName: string): string {
  return `await fastify.register((await import('./modules/${moduleName}/${moduleName}.module.js')).default);`;
}

export function isModuleRegistered(appTsContent: string, moduleName: string): boolean {
  const line = registrationLine(moduleName);
  return appTsContent.split('\n').some((l) => l.trim() === line);
}

export function insertModuleRegistration(appTsPath: string, moduleName: string): void {
  const content = readFileSync(appTsPath, 'utf8');
  const lines = content.split('\n');
  const markerIndex = lines.findIndex((line) => line.trim() === MARKER);
  if (markerIndex === -1) {
    throw new MarkerNotFoundError(moduleName);
  }

  const indent = /^\s*/.exec(lines[markerIndex])?.[0] ?? '';
  lines.splice(markerIndex, 0, `${indent}${registrationLine(moduleName)}`);
  writeFileSync(appTsPath, lines.join('\n'));
}
