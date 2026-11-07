import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeManifest } from '../file-hashes.js';
import type { UpgradePlan } from './types.js';

export interface ApplyOptions {
  /** Replaces the file writer; tests use it to make a write fail part-way. */
  writeFile?: (path: string, content: string) => void;
}

const MANIFEST_FILE = '.fastify-ep.json';

/**
 * Writes a plan to the project, all or nothing: if any write fails, every file already written is
 * put back (or removed if the plan created it) and the error is rethrown. The manifest is written
 * last, so a project is never left claiming a version it was not fully migrated to.
 */
export function applyPlan(root: string, plan: UpgradePlan, options: ApplyOptions = {}): void {
  const write = options.writeFile ?? ((path, content) => writeFileSync(path, content));
  const originals = new Map<string, string | undefined>();
  const createdDirs: string[] = [];

  const targets = [...plan.files.keys()];
  const manifestPath = join(root, MANIFEST_FILE);
  for (const path of [...targets, ...(plan.manifest ? [MANIFEST_FILE] : [])]) {
    const fullPath = join(root, path);
    originals.set(fullPath, existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : undefined);
  }

  try {
    for (const path of targets) {
      const fullPath = join(root, path);
      const missingDirs: string[] = [];
      for (let dir = dirname(fullPath); !existsSync(dir); dir = dirname(dir)) missingDirs.push(dir);
      mkdirSync(dirname(fullPath), { recursive: true });
      createdDirs.push(...missingDirs);
      write(fullPath, plan.files.get(path) as string);
    }
    if (plan.manifest) {
      writeManifest(manifestPath, plan.manifest);
    }
  } catch (err) {
    for (const [fullPath, original] of originals) {
      if (original === undefined) rmSync(fullPath, { force: true });
      else writeFileSync(fullPath, original);
    }
    for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}
