import type { FileState } from '../file-state.js';
import type { Manifest } from '../manifest.js';

/** What a migration asks for. The planner decides, per request, whether it is safe to carry out. */
export type MigrationRequest =
  /** Create the file, or replace it if it is pristine. A modified or untracked file is left for review. */
  | { kind: 'write'; path: string; content: string }
  /** Replace one exact snippet. No match, or more than one, goes to review; already applied is a no-op. */
  | { kind: 'patch'; path: string; anchor: string; replacement: string }
  /** Set one key of a JSON file (for example `package.json`) if it still holds `from`. */
  | { kind: 'json-key'; path: string; keyPath: string[]; from: unknown; to: unknown }
  /** Change the manifest. `files` is merged key by key, everything else is replaced. */
  | {
      kind: 'manifest';
      changes: Partial<Omit<Manifest, 'files'>> & { files?: Record<string, string> };
    }
  /** Nothing is changed; the user is told to look at this file. */
  | { kind: 'review'; path: string; reason: string };

/** The project as the migration sees it: disk plus the changes earlier migrations in the chain planned. */
export interface MigrationContext {
  root: string;
  manifest: Manifest;
  read(path: string): string | undefined;
  state(path: string): FileState;
}

export interface Migration {
  /** Unique, for example `0.6.0-to-0.6.1`. */
  id: string;
  /** Informational: the version this migration expects to start from. */
  from: string;
  /** The version the project is at once this migration has run. */
  to: string;
  /**
   * Run after every other migration in the chain. For a migration that compares the project with
   * what the current templates generate (the schema 3 conversion), so that it sees the files after
   * all the content migrations have updated them, not before.
   */
  runsLast?: boolean;
  /** Pure: reads the context, returns requests, writes nothing. */
  plan(context: MigrationContext): MigrationRequest[];
}

export type ChangeKind = 'write' | 'patch' | 'json-key' | 'manifest';

export interface PlannedChange {
  migration: string;
  kind: ChangeKind;
  /** Project-relative path; `.fastify-ep.json` for manifest changes. */
  path: string;
  description: string;
}

export interface ReviewItem {
  migration: string;
  path: string;
  reason: string;
}

export interface UpgradePlan {
  from: string;
  to: string;
  upToDate: boolean;
  migrations: string[];
  changes: PlannedChange[];
  review: ReviewItem[];
  /** Final content of every file the plan changes or creates. */
  files: Map<string, string>;
  /** The manifest as it will be written, or undefined when it does not change. */
  manifest: Manifest | undefined;
}

export class UnsupportedVersionError extends Error {
  constructor(version: string, minimum: string) {
    super(
      `this project was created with fastify-ep ${version}, which upgrade cannot migrate ` +
        `(the oldest supported version is ${minimum}). Recreate the project or update it by hand.`,
    );
    this.name = 'UnsupportedVersionError';
  }
}

export class ProjectNewerThanCliError extends Error {
  constructor(version: string, cliVersion: string) {
    super(
      `this project is at fastify-ep ${version}, which is newer than the installed CLI ` +
        `(${cliVersion}). Update fastify-ep and try again.`,
    );
    this.name = 'ProjectNewerThanCliError';
  }
}

export class InvalidMigrationError extends Error {
  constructor(id: string, message: string) {
    super(`migration "${id}": ${message}`);
    this.name = 'InvalidMigrationError';
  }
}
