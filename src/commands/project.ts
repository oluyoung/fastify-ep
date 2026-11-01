import { relative } from 'node:path';
import * as clack from '@clack/prompts';
import { resolveProject, type ProjectKind } from '../find-project.js';

export interface ResolvedTarget {
  root: string;
  kind: ProjectKind;
}

/**
 * The service or library a command should run in: the one found from `cwd` (or `--project`). Logs
 * the reason and exits when there is none, like the other commands do on failure.
 */
export function resolveTargetOrExit(cwd: string, project?: string): ResolvedTarget {
  const resolved = resolveProject(cwd, project);
  if ('error' in resolved) {
    clack.log.error(resolved.error);
    clack.outro('Failed.');
    process.exit(1);
  }
  if (resolved.root !== cwd) {
    clack.log.info(
      `Using the fastify-ep ${resolved.kind} at "${relative(cwd, resolved.root) || '.'}".`,
    );
  }
  return resolved;
}

/** Like `resolveTargetOrExit`, for commands that only make sense in a service (the generators). */
export function resolveProjectOrExit(cwd: string, project?: string): string {
  const target = resolveTargetOrExit(cwd, project);
  if (target.kind === 'library') {
    clack.log.error(
      `"${target.root}" is a shared library, not a fastify-ep service, so it has no modules to ` +
        `generate. Run this in a service, or pass --project <service-dir>.`,
    );
    clack.outro('Failed.');
    process.exit(1);
  }
  return target.root;
}
