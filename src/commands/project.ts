import { relative } from 'node:path';
import * as clack from '@clack/prompts';
import { resolveProject } from '../find-project.js';

/**
 * The directory a command should run in: the project found from `cwd` (or `--project`). Logs the
 * reason and exits when there is none, like the other commands do on failure.
 */
export function resolveProjectOrExit(cwd: string, project?: string): string {
  const resolved = resolveProject(cwd, project);
  if ('error' in resolved) {
    clack.log.error(resolved.error);
    clack.outro('Failed.');
    process.exit(1);
  }
  if (resolved.root !== cwd) {
    clack.log.info(`Using the fastify-ep project at "${relative(cwd, resolved.root) || '.'}".`);
  }
  return resolved.root;
}
