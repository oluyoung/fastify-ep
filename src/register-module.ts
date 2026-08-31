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

/**
 * Inserts a module's registration call directly above the `// fastify-ep:register`
 * marker in `appTsPath`, per SEAM-DESIGN.md's marker convention. The register call
 * uses a dynamic import so this stays a single-line insertion with nothing else in
 * app.ts to touch — no import-block editing, no AST parser, same reasoning
 * SEAM-DESIGN.md gives for string-based marker insertion over `ts-morph`.
 */
export function insertModuleRegistration(appTsPath: string, moduleName: string): void {
  const content = readFileSync(appTsPath, 'utf8');
  const lines = content.split('\n');
  const markerIndex = lines.findIndex((line) => line.trim() === MARKER);
  if (markerIndex === -1) {
    throw new MarkerNotFoundError(moduleName);
  }

  const indent = /^\s*/.exec(lines[markerIndex])?.[0] ?? '';
  const registerLine = `${indent}await fastify.register((await import('./modules/${moduleName}/${moduleName}.module.js')).default);`;
  lines.splice(markerIndex, 0, registerLine);
  writeFileSync(appTsPath, lines.join('\n'));
}
