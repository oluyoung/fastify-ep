import { dirname, join, relative, sep } from 'node:path';
import { matchesWorkspaceGlobs, type Workspace } from './detect-workspace.js';

/** The glob to suggest adding: the target's parent as `apps/*`, or the path itself at the root. */
function suggestedGlob(rel: string): string {
  const parent = dirname(rel);
  return parent === '.' ? rel : `${parent}/*`;
}

/**
 * What to add to the workspace's own files so `targetDir` is one of its packages, or undefined when
 * it already is. The CLI only writes inside the new directory, so this is printed, not applied.
 */
export function unmatchedGlobNote(workspace: Workspace, targetDir: string): string | undefined {
  if (matchesWorkspaceGlobs(workspace, targetDir)) return undefined;
  const rel = relative(workspace.root, targetDir).split(sep).join('/');
  const glob = suggestedGlob(rel);
  return workspace.packageManager === 'pnpm'
    ? `"${rel}" is not matched by the packages in ${join(workspace.root, 'pnpm-workspace.yaml')}. ` +
        `Add this under "packages:":\n\n  - '${glob}'`
    : `"${rel}" is not matched by "workspaces" in ${join(workspace.root, 'package.json')}. ` +
        `Add "${glob}" to it.`;
}
