import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PackageManager } from './package-manager.js';

const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
];

/**
 * Walks `cwd` and its ancestors looking for a pnpm/yarn lockfile, to default the
 * `init` package-manager prompt to whatever the surrounding project already uses.
 * Returns `undefined` (npm is the CLI's own default) when none is found.
 */
export function detectPackageManager(cwd: string): PackageManager | undefined {
  let dir = cwd;
  for (;;) {
    for (const [lockfile, pm] of LOCKFILES) {
      if (existsSync(join(dir, lockfile))) {
        return pm;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}
