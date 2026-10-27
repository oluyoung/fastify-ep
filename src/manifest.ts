import { readFileSync } from 'node:fs';

export const MANIFEST_SCHEMA_VERSION = 2;

export const DATABASE_STRATEGIES = ['none', 'drizzle', 'prisma'] as const;
export type DatabaseStrategy = (typeof DATABASE_STRATEGIES)[number];

export const DI_STRATEGIES = ['native', 'awilix'] as const;
export type DiStrategy = (typeof DI_STRATEGIES)[number];

/** Service lifetime for modules generated in an Awilix project. */
export const DI_SCOPES = ['singleton', 'request'] as const;
export type DiScope = (typeof DI_SCOPES)[number];

export interface ManifestArchitecture {
  schema: 'typebox';
  di: DiStrategy;
  database: DatabaseStrategy;
}

export interface Manifest {
  schemaVersion: 2;
  fastifyEpVersion: string;
  architecture: ManifestArchitecture;
  modules: string[];
}

export class LegacyManifestError extends Error {
  constructor(manifestPath: string) {
    super(
      `"${manifestPath}" was written by an older version of fastify-ep (schema v1) and needs ` +
        `to be updated by hand before this command can run. Add the following keys:\n` +
        `  "schemaVersion": 2,\n` +
        `  "fastifyEpVersion": "<your installed fastify-ep version>",\n` +
        `  "architecture": { "schema": "typebox", "di": "native", "database": "none" }\n` +
        `and remove the old "version" / "diStrategy" keys ("modules" can stay as-is).`,
    );
    this.name = 'LegacyManifestError';
  }
}

export class InvalidManifestError extends Error {
  constructor(manifestPath: string) {
    super(`"${manifestPath}" is not a valid fastify-ep manifest.`);
    this.name = 'InvalidManifestError';
  }
}

function isLegacyManifest(value: Record<string, unknown>): boolean {
  return typeof value.version === 'string' && typeof value.diStrategy === 'string';
}

function isArchitecture(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const { database, di } = value as Record<string, unknown>;
  return (
    DATABASE_STRATEGIES.includes(database as DatabaseStrategy) &&
    DI_STRATEGIES.includes(di as DiStrategy)
  );
}

function isV2Manifest(value: Record<string, unknown>): boolean {
  return (
    value.schemaVersion === MANIFEST_SCHEMA_VERSION &&
    typeof value.fastifyEpVersion === 'string' &&
    isArchitecture(value.architecture) &&
    Array.isArray(value.modules)
  );
}

export function readManifest(manifestPath: string): Manifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new InvalidManifestError(manifestPath);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidManifestError(manifestPath);
  }

  const value = parsed as Record<string, unknown>;

  if (isV2Manifest(value)) {
    return value as unknown as Manifest;
  }

  if (isLegacyManifest(value)) {
    throw new LegacyManifestError(manifestPath);
  }

  throw new InvalidManifestError(manifestPath);
}
