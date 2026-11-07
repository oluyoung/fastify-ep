import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { detectWorkspace } from './detect-workspace.js';
import { hashContent, hashFile } from './file-hashes.js';
import { generateModule } from './generate-module.js';
import { generateResource } from './generate-resource.js';
import { DEFAULT_PRESET, type DiScope, type Manifest } from './manifest.js';
import { PACKAGE_MANAGERS, type PackageManager } from './package-manager.js';
import { scaffoldProject } from './scaffold.js';

export class BaselineUnavailableError extends Error {
  constructor(reason: string) {
    super(`cannot compute a baseline for this project: ${reason}`);
    this.name = 'BaselineUnavailableError';
  }
}

export interface Baseline {
  /** Project files byte-identical to a re-render, with their hashes; the `files` map of a schema 3 manifest. */
  files: Record<string, string>;
  /** Paths a re-render would generate that exist in the project with different content. */
  differing: string[];
  /** Paths a re-render would generate that the project does not have. */
  missing: string[];
}

/** Never part of a baseline: patched by key, or the manifest itself. */
const EXCLUDED = new Set(['package.json', '.fastify-ep.json']);

type Kind = 'module' | 'resource' | 'crud';
const KINDS: Kind[] = ['module', 'resource', 'crud'];

function listFiles(dir: string, relDir = ''): string[] {
  return readdirSync(join(dir, relDir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${relDir}${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listFiles(dir, `${rel}/`);
    return EXCLUDED.has(rel) ? [] : [rel];
  });
}

/** Reads a project file's text, or undefined if it does not exist. */
export type ProjectReader = (path: string) => string | undefined;

function diskReader(root: string): ProjectReader {
  return (path) => {
    const fullPath = join(root, path);
    return existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : undefined;
  };
}

function readProjectName(read: ProjectReader): string {
  try {
    const name = (JSON.parse(read('package.json') ?? '') as { name?: unknown }).name;
    if (typeof name === 'string' && name !== '') return name;
  } catch {
    throw new BaselineUnavailableError('package.json is missing or is not valid JSON.');
  }
  throw new BaselineUnavailableError('package.json has no "name".');
}

function generate(dir: string, name: string, kind: Kind, scope: DiScope, withTests: boolean): void {
  if (kind === 'module') {
    generateModule({ targetDir: dir, moduleName: name, scope, withTests });
  } else {
    generateResource({
      targetDir: dir,
      resourceName: name,
      scope,
      withTests,
      crud: kind === 'crud',
    });
  }
}

/**
 * Works out which project files are exactly what this version of the CLI would have generated,
 * for a project whose manifest has no file hashes (schema 2). The project is re-rendered with the
 * real generators in a temp directory (scaffold, then each module in manifest order, trying each
 * way a module can have been generated) and compared byte for byte. Nothing in the project is
 * written, and a file that is not byte-identical is left out, so it is treated as the user's.
 *
 * The comparison is against the current templates, so it is only valid for projects whose
 * generated output matches them: run any earlier content migrations first.
 */
export function computeBaseline(
  root: string,
  manifest: Manifest,
  read: ProjectReader = diskReader(root),
): Baseline {
  const projectName = readProjectName(read);
  const { database, di, preset = DEFAULT_PRESET } = manifest.architecture;
  const tmp = mkdtempSync(join(tmpdir(), 'fastify-ep-baseline-'));

  const scaffold = (name: string, packageManager: PackageManager, servicePath?: string): string => {
    const targetDir = join(tmp, name);
    scaffoldProject({
      targetDir,
      projectName,
      cliVersion: manifest.fastifyEpVersion,
      database,
      di,
      preset,
      packageManager,
      ...(servicePath === undefined ? {} : { workspace: { servicePath, docker: true } }),
    });
    return targetDir;
  };

  try {
    const baseDir = scaffold('base', 'npm');
    const replayDir = join(tmp, 'replay');
    cpSync(baseDir, replayDir, { recursive: true });

    const scopes: DiScope[] = di === 'awilix' ? ['singleton', 'request'] : ['singleton'];
    for (const name of manifest.modules.filter((m) => m !== 'health')) {
      const withTests = read(`src/modules/${name}/${name}.test.ts`) !== undefined;
      let best: { kind: Kind; scope: DiScope; score: number } | undefined;
      for (const kind of KINDS) {
        for (const scope of scopes) {
          const trial = join(tmp, 'trial');
          rmSync(trial, { recursive: true, force: true });
          cpSync(replayDir, trial, { recursive: true });
          try {
            generate(trial, name, kind, scope, withTests);
          } catch {
            continue;
          }
          const moduleDir = `src/modules/${name}/`;
          const score = listFiles(trial, moduleDir).filter(
            (path) =>
              read(path) !== undefined &&
              hashContent(read(path) as string) === hashFile(join(trial, path)),
          ).length;
          if (best === undefined || score > best.score) best = { kind, scope, score };
        }
      }
      // No variant matched at all: still replay a plain module so app.ts gets its registration.
      const chosen =
        best && best.score > 0 ? best : { kind: 'module' as Kind, scope: 'singleton' as DiScope };
      try {
        generate(replayDir, name, chosen.kind, chosen.scope, withTests);
      } catch {
        // A name the generators reject cannot be re-rendered; its files stay the user's.
      }
    }

    // Files that depend on the package manager or workspace (Dockerfile, pnpm-workspace.yaml) may
    // match any variant. Only paths that differ from a health-only npm scaffold qualify, so a
    // health-only app.ts can never stand in for a project's real one.
    const baseHashes = new Map(
      listFiles(baseDir).map((path) => [path, hashFile(join(baseDir, path))]),
    );
    const accepted = new Map<string, Set<string>>();
    const accept = (path: string, hash: string): void => {
      accepted.set(path, (accepted.get(path) ?? new Set<string>()).add(hash));
    };
    const extraDirs = PACKAGE_MANAGERS.filter((pm) => pm !== 'npm').map((pm) =>
      scaffold(`pm-${pm}`, pm),
    );
    const workspace = detectWorkspace(root);
    if (workspace) {
      const servicePath = root
        .slice(workspace.root.length + 1)
        .split(sep)
        .join('/');
      extraDirs.push(scaffold('workspace', workspace.packageManager, servicePath));
    }
    const extraOnly = new Set<string>();
    for (const dir of extraDirs) {
      for (const path of listFiles(dir)) {
        const hash = hashFile(join(dir, path));
        if (baseHashes.get(path) === hash) continue;
        accept(path, hash);
        if (!baseHashes.has(path)) extraOnly.add(path);
      }
    }

    const rendered = new Map(
      listFiles(replayDir).map((path) => [path, hashFile(join(replayDir, path))]),
    );
    for (const [path, hash] of rendered) accept(path, hash);

    const result: Baseline = { files: {}, differing: [], missing: [] };
    for (const path of [...rendered.keys(), ...extraOnly].sort()) {
      const content = read(path);
      if (content === undefined) {
        if (rendered.has(path)) result.missing.push(path);
        continue;
      }
      const actual = hashContent(content);
      if (accepted.get(path)?.has(actual)) result.files[path] = actual;
      else result.differing.push(path);
    }
    return result;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
