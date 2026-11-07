import { readFileSync } from 'node:fs';

/** The schema `init` writes. Schema 2 (no file hashes) is still read; `upgrade` converts it. */
export const MANIFEST_SCHEMA_VERSION = 3;

/** Bumped only when a migration changes the conventions of generated projects. */
export const ARCHITECTURE_VERSION = 1;

export const DATABASE_STRATEGIES = ['none', 'drizzle', 'prisma'] as const;
export type DatabaseStrategy = (typeof DATABASE_STRATEGIES)[number];

export const PRESETS = ['minimal', 'standard', 'production'] as const;
export type Preset = (typeof PRESETS)[number];

/** The preset `init` uses when none is chosen. Its manifest omits the `preset` key. */
export const DEFAULT_PRESET: Preset = 'standard';

export const DI_STRATEGIES = ['native', 'awilix'] as const;
export type DiStrategy = (typeof DI_STRATEGIES)[number];

/** Service lifetime for modules generated in an Awilix project. */
export const DI_SCOPES = ['singleton', 'request'] as const;
export type DiScope = (typeof DI_SCOPES)[number];

export interface ManifestArchitecture {
  schema: 'typebox';
  di: DiStrategy;
  database: DatabaseStrategy;
  /** Absent means `standard`. Informational: presets generate plain source the user then owns. */
  preset?: Preset;
}

export interface Manifest {
  schemaVersion: 2 | 3;
  /** The fastify-ep version that created the project, or last migrated it with `upgrade`. */
  fastifyEpVersion: string;
  /** Schema 3 only. */
  architectureVersion?: number;
  architecture: ManifestArchitecture;
  modules: string[];
  /**
   * Schema 3 only: project-relative path to the hash of the file as generated (`sha256:<hex>`).
   * Used to tell an untouched generated file from an edited one. `package.json` is never listed.
   */
  files?: Record<string, string>;
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

export class NewerManifestError extends Error {
  constructor(manifestPath: string, schemaVersion: number) {
    super(
      `"${manifestPath}" uses manifest schema ${schemaVersion}, which is newer than this version ` +
        `of fastify-ep understands. Update fastify-ep and try again.`,
    );
    this.name = 'NewerManifestError';
  }
}

function isLegacyManifest(value: Record<string, unknown>): boolean {
  return typeof value.version === 'string' && typeof value.diStrategy === 'string';
}

function isArchitecture(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const { database, di, preset } = value as Record<string, unknown>;
  return (
    DATABASE_STRATEGIES.includes(database as DatabaseStrategy) &&
    DI_STRATEGIES.includes(di as DiStrategy) &&
    (preset === undefined || PRESETS.includes(preset as Preset))
  );
}

const FILE_HASH = /^sha256:[0-9a-f]{64}$/;

/** A normalised, project-relative path that stays inside the project. */
export function isProjectRelativePath(path: string): boolean {
  return (
    path !== '' &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !/^[A-Za-z]:/.test(path) &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function isFileHashes(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([path, hash]) =>
      isProjectRelativePath(path) && typeof hash === 'string' && FILE_HASH.test(hash),
  );
}

function isCurrentManifest(value: Record<string, unknown>): boolean {
  if (
    typeof value.fastifyEpVersion !== 'string' ||
    !isArchitecture(value.architecture) ||
    !Array.isArray(value.modules)
  ) {
    return false;
  }
  if (value.schemaVersion === 2) return true;
  return (
    value.schemaVersion === 3 &&
    Number.isInteger(value.architectureVersion) &&
    isFileHashes(value.files)
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

  if (isCurrentManifest(value)) {
    return value as unknown as Manifest;
  }

  if (typeof value.schemaVersion === 'number' && value.schemaVersion > MANIFEST_SCHEMA_VERSION) {
    throw new NewerManifestError(manifestPath, value.schemaVersion);
  }

  if (isLegacyManifest(value)) {
    throw new LegacyManifestError(manifestPath);
  }

  throw new InvalidManifestError(manifestPath);
}
