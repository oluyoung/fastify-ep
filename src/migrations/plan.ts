import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashContent } from '../file-hashes.js';
import type { FileState } from '../file-state.js';
import { isProjectRelativePath, type Manifest } from '../manifest.js';
import { compareVersions, isVersion } from '../version.js';
import {
  InvalidMigrationError,
  ProjectNewerThanCliError,
  UnsupportedVersionError,
  type Migration,
  type MigrationContext,
  type MigrationRequest,
  type PlannedChange,
  type ReviewItem,
  type UpgradePlan,
} from './types.js';

export interface PlanOptions {
  root: string;
  manifest: Manifest;
  migrations: readonly Migration[];
  /** The CLI's version: the project ends up stamped with it. */
  targetVersion: string;
  /** The oldest project version upgrade accepts. */
  minimumVersion: string;
}

const MANIFEST_PATH = '.fastify-ep.json';

function getAt(value: unknown, keyPath: string[]): { found: boolean; value?: unknown } {
  let current = value;
  for (const key of keyPath) {
    if (typeof current !== 'object' || current === null || !(key in current))
      return { found: false };
    current = (current as Record<string, unknown>)[key];
  }
  return { found: true, value: current };
}

function setAt(root: Record<string, unknown>, keyPath: string[], value: unknown): void {
  let current = root;
  for (const key of keyPath.slice(0, -1)) {
    const next = current[key];
    if (typeof next !== 'object' || next === null) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  const last = keyPath[keyPath.length - 1];
  const keys = Object.keys(current);
  const wasSorted = keys.every((key, i) => i === 0 || keys[i - 1].localeCompare(key) <= 0);
  current[last] = value;
  if (wasSorted && !keys.includes(last)) {
    // Keep a sorted map (dependencies) sorted, as the scaffold writes it.
    const sorted = Object.entries(current).sort(([a], [b]) => a.localeCompare(b));
    for (const key of Object.keys(current)) delete current[key];
    for (const [key, entry] of sorted) current[key] = entry;
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function validateRegistry(migrations: readonly Migration[]): void {
  const ids = new Set<string>();
  for (const m of migrations) {
    if (ids.has(m.id)) throw new InvalidMigrationError(m.id, 'duplicate id.');
    ids.add(m.id);
    if (!isVersion(m.from) || !isVersion(m.to) || compareVersions(m.from, m.to) >= 0) {
      throw new InvalidMigrationError(m.id, `"from" must be a version lower than "to".`);
    }
  }
}

/**
 * Plans every migration between the project's version and `targetVersion`, in order, without
 * writing anything. Each migration sees the project as the earlier ones would leave it, so the plan
 * is exactly what `applyPlan` does and a dry run shows the real result. Edited files are never
 * rewritten: anything that cannot be changed safely becomes a review item.
 */
export function planUpgrade({
  root,
  manifest,
  migrations,
  targetVersion,
  minimumVersion,
}: PlanOptions): UpgradePlan {
  validateRegistry(migrations);
  const from = manifest.fastifyEpVersion;
  if (!isVersion(from) || compareVersions(from, minimumVersion) < 0) {
    throw new UnsupportedVersionError(from, minimumVersion);
  }
  if (compareVersions(from, targetVersion) > 0)
    throw new ProjectNewerThanCliError(from, targetVersion);

  const plan: UpgradePlan = {
    from,
    to: targetVersion,
    upToDate: compareVersions(from, targetVersion) === 0,
    migrations: [],
    changes: [],
    review: [],
    files: new Map(),
    manifest: undefined,
  };
  if (plan.upToDate) return plan;

  const chain = migrations
    .filter((m) => compareVersions(from, m.to) < 0 && compareVersions(m.to, targetVersion) <= 0)
    .sort(
      (a, b) =>
        Number(a.runsLast === true) - Number(b.runsLast === true) || compareVersions(a.to, b.to),
    );

  const virtual: Manifest = structuredClone(manifest);
  const overlay = new Map<string, string>();
  let manifestChanged = false;

  const read = (path: string): string | undefined => {
    if (overlay.has(path)) return overlay.get(path);
    const fullPath = join(root, path);
    return existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : undefined;
  };
  const stateOf = (path: string): FileState => {
    const recorded = virtual.files?.[path];
    if (recorded === undefined) return 'untracked';
    const content = read(path);
    if (content === undefined) return 'missing';
    return hashContent(content) === recorded ? 'pristine' : 'modified';
  };
  const context: MigrationContext = { root, manifest: virtual, read, state: stateOf };

  /** Keeps a tracked file's recorded hash in step with an edit, but only if it was untouched. */
  const setFile = (path: string, content: string): void => {
    // A file the migration creates is generated, so it is tracked like one (schema 3 only).
    const tracked = stateOf(path) === 'pristine' || read(path) === undefined;
    overlay.set(path, content);
    plan.files.set(path, content);
    if (tracked && virtual.files) virtual.files[path] = hashContent(content);
  };

  for (const migration of chain) {
    plan.migrations.push(migration.id);
    const change = (kind: PlannedChange['kind'], path: string, description: string): void => {
      plan.changes.push({ migration: migration.id, kind, path, description });
    };
    const review = (path: string, reason: string): void => {
      const item: ReviewItem = { migration: migration.id, path, reason };
      plan.review.push(item);
    };

    for (const request of migration.plan(context)) {
      if ('path' in request && !isProjectRelativePath(request.path)) {
        throw new InvalidMigrationError(
          migration.id,
          `"${request.path}" is not a project-relative path.`,
        );
      }
      manifestChanged =
        resolveRequest(request, { read, stateOf, setFile, change, review, virtual }) ||
        manifestChanged;
    }
  }

  if (compareVersions(virtual.fastifyEpVersion, targetVersion) !== 0) {
    virtual.fastifyEpVersion = targetVersion;
    manifestChanged = true;
    plan.changes.push({
      migration: 'upgrade',
      kind: 'manifest',
      path: MANIFEST_PATH,
      description: `fastifyEpVersion ${from} to ${targetVersion}`,
    });
  }
  if (manifestChanged) plan.manifest = virtual;
  return plan;
}

interface Resolver {
  read(path: string): string | undefined;
  stateOf(path: string): FileState;
  setFile(path: string, content: string): void;
  change(kind: PlannedChange['kind'], path: string, description: string): void;
  review(path: string, reason: string): void;
  virtual: Manifest;
}

/** Carries out one request against the virtual project. Returns true if it changed the manifest. */
function resolveRequest(request: MigrationRequest, r: Resolver): boolean {
  switch (request.kind) {
    case 'write': {
      const current = r.read(request.path);
      if (current === request.content) return false;
      const state = r.stateOf(request.path);
      if (current !== undefined && state !== 'pristine') {
        r.review(
          request.path,
          state === 'modified'
            ? 'has local modifications; the new version was not applied.'
            : 'is not tracked as generated; the new version was not applied.',
        );
        return false;
      }
      r.setFile(request.path, request.content);
      r.change('write', request.path, current === undefined ? 'created' : 'updated');
      return false;
    }
    case 'patch': {
      const current = r.read(request.path);
      if (current === undefined) {
        r.review(request.path, 'does not exist, so it could not be updated.');
        return false;
      }
      const occurrences = current.split(request.anchor).length - 1;
      if (occurrences === 1) {
        r.setFile(
          request.path,
          current.replace(request.anchor, () => request.replacement),
        );
        r.change('patch', request.path, 'updated');
      } else if (occurrences === 0 && current.includes(request.replacement)) {
        // Already applied.
      } else {
        r.review(request.path, 'does not match the known generated structure; update it by hand.');
      }
      return false;
    }
    case 'json-key': {
      const text = r.read(request.path);
      const label = `${request.keyPath.join('.')}`;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text ?? '') as Record<string, unknown>;
      } catch {
        r.review(request.path, `could not be read as JSON, so "${label}" was not updated.`);
        return false;
      }
      const found = getAt(parsed, request.keyPath);
      if (found.found && same(found.value, request.to)) return false;
      // `from: undefined` means "add the key, which must not be there yet".
      const matchesFrom = found.found
        ? same(found.value, request.from)
        : request.from === undefined;
      if (!matchesFrom) {
        r.review(
          request.path,
          `"${label}" is ${found.found ? JSON.stringify(found.value) : 'not set'}, not the generated ` +
            `${JSON.stringify(request.from)}; set it to ${JSON.stringify(request.to)} yourself if you want the new version.`,
        );
        return false;
      }
      if (`${JSON.stringify(parsed, null, 2)}\n` !== text) {
        r.review(
          request.path,
          `is not formatted the way fastify-ep writes it, so "${label}" was not updated.`,
        );
        return false;
      }
      setAt(parsed, request.keyPath, request.to);
      r.setFile(request.path, `${JSON.stringify(parsed, null, 2)}\n`);
      r.change(
        'json-key',
        request.path,
        request.from === undefined
          ? `${label} added as ${JSON.stringify(request.to)}`
          : `${label} ${JSON.stringify(request.from)} to ${JSON.stringify(request.to)}`,
      );
      return false;
    }
    case 'manifest': {
      const { files, ...rest } = request.changes;
      Object.assign(r.virtual, rest);
      if (files) r.virtual.files = { ...r.virtual.files, ...files };
      r.change('manifest', MANIFEST_PATH, Object.keys(request.changes).join(', '));
      return true;
    }
    case 'review':
      r.review(request.path, request.reason);
      return false;
  }
}
