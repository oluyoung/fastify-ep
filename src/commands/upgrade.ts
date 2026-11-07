import { relative } from 'node:path';
import * as clack from '@clack/prompts';
import { detectPackageManager } from '../detect-package-manager.js';
import { resolveProject } from '../find-project.js';
import { upgradeProject, type UpgradeReport } from '../upgrade.js';

export interface UpgradeCommandOptions {
  project?: string;
  dryRun?: boolean;
  json?: boolean;
  cliVersion: string;
}

/** Changes grouped by path, so a file touched by several migrations is one line. */
function describeChanges(report: UpgradeReport): [string, string[]][] {
  const byPath = new Map<string, string[]>();
  for (const { path, description } of report.changes) {
    byPath.set(path, [...(byPath.get(path) ?? []), description]);
  }
  return [...byPath];
}

function printReport(report: UpgradeReport, cwd: string): void {
  if (report.upToDate) {
    clack.outro(`Already up to date (fastify-ep ${report.to}).`);
    return;
  }
  clack.log.step(`${report.from} to ${report.to}${report.dryRun ? ' (dry run)' : ''}`);
  for (const [path, descriptions] of describeChanges(report)) {
    const line = `${path} — ${descriptions.join('; ')}`;
    if (report.dryRun) clack.log.info(`Would update ${line}`);
    else clack.log.success(line);
  }
  if (report.review.length > 0) {
    clack.log.step('Manual review required');
    for (const { path, reasons } of report.review) {
      clack.log.warn(`${path} — ${reasons.join(' ')}`);
    }
  }
  if (report.installNeeded) {
    const pm = detectPackageManager(report.project) ?? 'npm';
    clack.log.info(
      `package.json changed${report.dryRun ? '' : '; the dependencies were not installed'}. ` +
        `Run "${pm} install"${report.dryRun ? ' after upgrading' : ' now'}.`,
    );
  }
  const where = relative(cwd, report.project) || '.';
  clack.outro(
    report.dryRun
      ? `Dry run: nothing was written. Run "fastify-ep upgrade" to apply${where === '.' ? '' : ` in ${where}`}.`
      : `Upgraded to fastify-ep ${report.to}.`,
  );
}

/**
 * `fastify-ep upgrade`: migrates a project created by an earlier version. Manual-review items do
 * not fail the run (exit 0); an unsupported or too-new version, a project that is not found, or a
 * failed apply exit 1. With `--json` only the JSON report (or `{ format, error }`) is printed.
 */
export async function runUpgrade(cwd: string, options: UpgradeCommandOptions): Promise<void> {
  const json = options.json === true;
  const fail = (message: string): never => {
    if (json) process.stdout.write(`${JSON.stringify({ format: 1, error: message }, null, 2)}\n`);
    else {
      clack.log.error(message);
      clack.outro('Failed.');
    }
    process.exit(1);
  };

  if (!json) clack.intro(`fastify-ep upgrade${options.dryRun ? ' --dry-run' : ''}`);

  const target = resolveProject(cwd, options.project);
  if ('error' in target) return fail(target.error);
  if (!json && target.root !== cwd) {
    clack.log.info(
      `Using the fastify-ep ${target.kind} at "${relative(cwd, target.root) || '.'}".`,
    );
  }

  let report: UpgradeReport;
  try {
    report = upgradeProject({
      root: target.root,
      kind: target.kind,
      cliVersion: options.cliVersion,
      dryRun: options.dryRun,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printReport(report, cwd);
}
