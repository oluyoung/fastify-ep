import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readManifest, type Manifest } from '../manifest.js';
import { scaffoldProject } from '../scaffold.js';
import { applyPlan } from './apply.js';
import { planUpgrade } from './plan.js';
import type { Migration } from './types.js';

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function project(): { root: string; manifest: Manifest } {
  workDir = mkdtempSync(join(tmpdir(), 'fastify-ep-apply-'));
  const root = join(workDir, 'demo-app');
  scaffoldProject({ targetDir: root, projectName: 'demo-app', cliVersion: '0.8.0' });
  return { root, manifest: readManifest(join(root, '.fastify-ep.json')) };
}

const migration: Migration = {
  id: 'm',
  from: '0.8.0',
  to: '0.9.0',
  plan: () => [
    { kind: 'write', path: 'docs/deep/new.md', content: 'hello\n' },
    {
      kind: 'patch',
      path: 'src/app.ts',
      anchor: 'fastify-ep:register',
      replacement: 'fastify-ep:REGISTER',
    },
    { kind: 'manifest', changes: { architectureVersion: 2 } },
  ],
};

const upgrade = (root: string, manifest: Manifest) =>
  planUpgrade({
    root,
    manifest,
    migrations: [migration],
    targetVersion: '0.9.0',
    minimumVersion: '0.6.0',
  });

describe('applyPlan', () => {
  it('writes the changed files and the manifest, and a second plan is up to date', () => {
    const { root, manifest } = project();

    applyPlan(root, upgrade(root, manifest));

    expect(readFileSync(join(root, 'docs/deep/new.md'), 'utf8')).toBe('hello\n');
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toContain('fastify-ep:REGISTER');
    const after = readManifest(join(root, '.fastify-ep.json'));
    expect(after.fastifyEpVersion).toBe('0.9.0');
    expect(after.architectureVersion).toBe(2);
    expect(upgrade(root, after).upToDate).toBe(true);
  });

  it('rolls everything back when a write fails, removing what it created', () => {
    const { root, manifest } = project();
    const appBefore = readFileSync(join(root, 'src/app.ts'), 'utf8');
    const manifestBefore = readFileSync(join(root, '.fastify-ep.json'), 'utf8');
    const topLevelBefore = readdirSync(root).sort();
    let writes = 0;

    expect(() =>
      applyPlan(root, upgrade(root, manifest), {
        writeFile: (path, content) => {
          writes += 1;
          if (writes === 2) throw new Error('disk full');
          writeFileSync(path, content);
        },
      }),
    ).toThrow('disk full');

    expect(writes).toBe(2);
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe(appBefore);
    expect(readFileSync(join(root, '.fastify-ep.json'), 'utf8')).toBe(manifestBefore);
    expect(existsSync(join(root, 'docs'))).toBe(false);
    expect(readdirSync(root).sort()).toEqual(topLevelBefore);
  });

  it('writes nothing for an up-to-date plan', () => {
    const { root, manifest } = project();
    const before = readFileSync(join(root, '.fastify-ep.json'), 'utf8');

    applyPlan(
      root,
      planUpgrade({
        root,
        manifest,
        migrations: [],
        targetVersion: '0.8.0',
        minimumVersion: '0.6.0',
      }),
    );

    expect(readFileSync(join(root, '.fastify-ep.json'), 'utf8')).toBe(before);
  });
});
