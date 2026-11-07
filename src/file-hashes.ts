import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Manifest } from './manifest.js';

/** `sha256:<hex>` of the content with CRLF read as LF, so a checkout's line endings do not matter. */
export function hashContent(content: string): string {
  const normalised = content.replaceAll('\r\n', '\n');
  return `sha256:${createHash('sha256').update(normalised).digest('hex')}`;
}

export function hashFile(path: string): string {
  return hashContent(readFileSync(path, 'utf8'));
}

/** Hashes of `paths` (project-relative, `/`-separated) as they are on disk now. */
export function recordFiles(root: string, paths: Iterable<string>): Record<string, string> {
  const files: Record<string, string> = {};
  for (const path of paths) files[path] = hashFile(join(root, path));
  return files;
}

/** True when the manifest tracks `path` and the file on disk still matches what was recorded. */
export function isPristine(manifest: Manifest, root: string, path: string): boolean {
  const recorded = manifest.files?.[path];
  const fullPath = join(root, path);
  return recorded !== undefined && existsSync(fullPath) && hashFile(fullPath) === recorded;
}

/**
 * Runs `edit` (which rewrites the project file `path`) and keeps the recorded hash in step, but only
 * if the file was untouched before: an edited or untracked file is never adopted, so it keeps
 * counting as modified. Does nothing to a manifest without `files` (schema 2).
 */
export function refreshIfPristine(
  manifest: Manifest,
  root: string,
  path: string,
  edit: () => void,
): void {
  const pristine = isPristine(manifest, root, path);
  edit();
  if (pristine && manifest.files) manifest.files[path] = hashFile(join(root, path));
}

const MANIFEST_KEY_ORDER = [
  'schemaVersion',
  'fastifyEpVersion',
  'architectureVersion',
  'architecture',
  'modules',
  'files',
];

/**
 * Writes the manifest with its keys in the order `init` writes them and `files` sorted by path, so
 * a migrated manifest looks like a fresh one and regenerating produces stable diffs.
 */
export function writeManifest(manifestPath: string, manifest: Manifest): void {
  const entries = Object.entries(manifest).map(([key, value]): [string, unknown] => [
    key,
    key === 'files' && manifest.files
      ? Object.fromEntries(
          Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : value,
  ]);
  const rank = (key: string): number => {
    const i = MANIFEST_KEY_ORDER.indexOf(key);
    return i === -1 ? MANIFEST_KEY_ORDER.length : i;
  };
  entries.sort(([a], [b]) => rank(a) - rank(b));
  writeFileSync(manifestPath, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`);
}
