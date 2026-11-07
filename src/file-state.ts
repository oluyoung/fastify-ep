import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hashFile } from './file-hashes.js';
import type { Manifest } from './manifest.js';

/**
 * - `pristine`: the manifest tracks the file and it still matches what was generated.
 * - `modified`: tracked, but the content differs now.
 * - `missing`: tracked, but the file is gone.
 * - `untracked`: the manifest has no entry for it. Every path is untracked in a schema 2 manifest.
 */
export type FileState = 'pristine' | 'modified' | 'missing' | 'untracked';

export function fileState(manifest: Manifest, root: string, path: string): FileState {
  const recorded = manifest.files?.[path];
  if (recorded === undefined) return 'untracked';
  const fullPath = join(root, path);
  if (!existsSync(fullPath)) return 'missing';
  return hashFile(fullPath) === recorded ? 'pristine' : 'modified';
}

/** The state of every file the manifest tracks. */
export function classifyTracked(manifest: Manifest, root: string): Record<string, FileState> {
  return Object.fromEntries(
    Object.keys(manifest.files ?? {}).map((path) => [path, fileState(manifest, root, path)]),
  );
}
