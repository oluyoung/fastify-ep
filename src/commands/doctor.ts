import * as clack from '@clack/prompts';
import { runDoctorChecks } from '../doctor.js';
import { resolveProjectOrExit } from './project.js';

export async function runDoctor(cwd: string, options: { project?: string } = {}): Promise<void> {
  clack.intro('fastify-ep doctor');

  const checks = runDoctorChecks(resolveProjectOrExit(cwd, options.project));
  for (const check of checks) {
    if (check.pass) {
      clack.log.success(check.name);
    } else {
      clack.log.error(`${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    }
  }

  const failed = checks.filter((c) => !c.pass).length;
  if (failed === 0) {
    clack.outro(`All ${checks.length} checks passed.`);
  } else {
    clack.outro(`${failed} of ${checks.length} checks failed.`);
    process.exit(1);
  }
}
