import * as clack from '@clack/prompts';
import {
  buildDoctorReport,
  doctorFails,
  groupChecks,
  runDoctorChecks,
  summarizeChecks,
  type DoctorCheck,
} from '../doctor.js';
import { resolveProject } from '../find-project.js';
import { runLibraryChecks } from '../library-doctor.js';
import { resolveTargetOrExit } from './project.js';

function logCheck(check: DoctorCheck): void {
  if (check.severity === 'info') {
    clack.log.info(`${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    return;
  }
  if (check.pass) {
    clack.log.success(check.name);
    return;
  }
  const line = `${check.name}${check.detail ? ` — ${check.detail}` : ''}${check.rule ? ` [${check.rule}]` : ''}`;
  if (check.severity === 'warning') clack.log.warn(line);
  else clack.log.error(line);
}

export interface DoctorCommandOptions {
  project?: string;
  /** Fail on warnings as well as errors. */
  strict?: boolean;
  /** Print the result as JSON (`format: 1`) instead of the report. */
  json?: boolean;
  /** The running CLI's version, for the "created or migrated by this version" check. */
  cliVersion?: string;
}

async function runDoctorJson(cwd: string, options: DoctorCommandOptions): Promise<void> {
  const target = resolveProject(cwd, options.project);
  if ('error' in target) {
    process.stdout.write(`${JSON.stringify({ format: 1, error: target.error }, null, 2)}\n`);
    process.exit(1);
  }
  const { cliVersion } = options;
  const checks =
    target.kind === 'library'
      ? runLibraryChecks(target.root, { cliVersion })
      : runDoctorChecks(target.root, { cliVersion });
  const report = buildDoctorReport(target.root, target.kind, checks, options.strict === true);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exit(1);
}

export async function runDoctor(cwd: string, options: DoctorCommandOptions = {}): Promise<void> {
  if (options.json) return runDoctorJson(cwd, options);
  clack.intro('fastify-ep doctor');

  const target = resolveTargetOrExit(cwd, options.project);
  const { cliVersion } = options;
  const checks =
    target.kind === 'library'
      ? runLibraryChecks(target.root, { cliVersion })
      : runDoctorChecks(target.root, { cliVersion });
  for (const [group, inGroup] of groupChecks(checks)) {
    clack.log.step(group);
    inGroup.forEach(logCheck);
  }

  const summary = summarizeChecks(checks);
  const { total, errors, warnings } = summary;
  if (errors === 0 && warnings === 0) {
    clack.outro(`All ${total} checks passed.`);
    return;
  }
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  clack.outro(`${plural(errors, 'error')}, ${plural(warnings, 'warning')} (of ${total} checks).`);
  if (doctorFails(summary, options.strict === true)) process.exit(1);
}
