import * as clack from '@clack/prompts';
import {
  doctorFails,
  groupChecks,
  runDoctorChecks,
  summarizeChecks,
  type DoctorCheck,
} from '../doctor.js';
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
}

export async function runDoctor(cwd: string, options: DoctorCommandOptions = {}): Promise<void> {
  clack.intro('fastify-ep doctor');

  const target = resolveTargetOrExit(cwd, options.project);
  const checks =
    target.kind === 'library' ? runLibraryChecks(target.root) : runDoctorChecks(target.root);
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
