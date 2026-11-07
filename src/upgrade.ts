import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIBRARY_MARKER, type ProjectKind } from './find-project.js';
import { MIGRATIONS, MINIMUM_SUPPORTED_VERSION } from './migrations/index.js';
import { applyPlan } from './migrations/apply.js';
import { planUpgrade } from './migrations/plan.js';
import {
  ProjectNewerThanCliError,
  UnsupportedVersionError,
  type PlannedChange,
} from './migrations/types.js';
import { readManifest } from './manifest.js';
import { compareVersions, isVersion } from './version.js';

/** The public shape of `upgrade --json`. Adding fields is compatible; removing or renaming needs a new `format`. */
export interface UpgradeReport {
  format: 1;
  project: string;
  kind: ProjectKind;
  from: string;
  to: string;
  dryRun: boolean;
  upToDate: boolean;
  /** The migrations that ran, or would run in a dry run. */
  migrations: string[];
  changes: PlannedChange[];
  /** Files to look at by hand, one entry per path. */
  review: { path: string; reasons: string[] }[];
  /** True when `package.json` changed, so dependencies need installing. */
  installNeeded: boolean;
}

export interface UpgradeOptions {
  root: string;
  kind: ProjectKind;
  cliVersion: string;
  dryRun?: boolean;
}

/** One review entry per path, in order of first appearance, without repeating a reason. */
function groupReview(items: { path: string; reason: string }[]): UpgradeReport['review'] {
  const byPath = new Map<string, string[]>();
  for (const { path, reason } of items) {
    const reasons = byPath.get(path) ?? [];
    if (!reasons.includes(reason)) reasons.push(reason);
    byPath.set(path, reasons);
  }
  return [...byPath].map(([path, reasons]) => ({ path, reasons }));
}

/** A library has no generated files to migrate; only its marker's version moves. */
function upgradeLibrary({ root, cliVersion, dryRun = false }: UpgradeOptions): UpgradeReport {
  const markerPath = join(root, LIBRARY_MARKER);
  const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as Record<string, unknown>;
  const from = marker.fastifyEpVersion;
  if (
    typeof from !== 'string' ||
    !isVersion(from) ||
    compareVersions(from, MINIMUM_SUPPORTED_VERSION) < 0
  ) {
    throw new UnsupportedVersionError(String(from), MINIMUM_SUPPORTED_VERSION);
  }
  if (compareVersions(from, cliVersion) > 0) throw new ProjectNewerThanCliError(from, cliVersion);

  const upToDate = compareVersions(from, cliVersion) === 0;
  if (!upToDate && !dryRun) {
    writeFileSync(
      markerPath,
      `${JSON.stringify({ ...marker, fastifyEpVersion: cliVersion }, null, 2)}\n`,
    );
  }
  return {
    format: 1,
    project: root,
    kind: 'library',
    from,
    to: cliVersion,
    dryRun,
    upToDate,
    migrations: [],
    changes: upToDate
      ? []
      : [
          {
            migration: 'upgrade',
            kind: 'manifest',
            path: LIBRARY_MARKER,
            description: `fastifyEpVersion ${from} to ${cliVersion}`,
          },
        ],
    review: [],
    installNeeded: false,
  };
}

/**
 * Plans the upgrade of a service (or library) and, unless `dryRun`, applies it. Throws
 * `UnsupportedVersionError`, `ProjectNewerThanCliError` or a manifest error when it cannot run; the
 * project is untouched in that case, and also when applying fails part-way (it is rolled back).
 */
export function upgradeProject(options: UpgradeOptions): UpgradeReport {
  if (options.kind === 'library') return upgradeLibrary(options);

  const { root, cliVersion, dryRun = false } = options;
  const manifest = readManifest(join(root, '.fastify-ep.json'));
  const plan = planUpgrade({
    root,
    manifest,
    migrations: MIGRATIONS,
    targetVersion: cliVersion,
    minimumVersion: MINIMUM_SUPPORTED_VERSION,
  });
  if (!dryRun) applyPlan(root, plan);

  return {
    format: 1,
    project: root,
    kind: 'service',
    from: plan.from,
    to: plan.to,
    dryRun,
    upToDate: plan.upToDate,
    migrations: plan.migrations,
    changes: plan.changes,
    review: groupReview(plan.review),
    installNeeded: plan.changes.some((change) => change.path === 'package.json'),
  };
}
