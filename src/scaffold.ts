import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Manifest, MANIFEST_SCHEMA_VERSION } from './manifest.js';
import { insertModuleRegistration } from './register-module.js';
import { renderTemplate } from './template-engine.js';

const TEMPLATES_DIR = fileURLToPath(new URL('../templates', import.meta.url));

export interface ScaffoldOptions {
  targetDir: string;
  projectName: string;
  cliVersion: string;
  /** Override for tests; defaults to this package's real `templates/` dir. */
  templatesDir?: string;
}

function copyTemplateDir(srcDir: string, destDir: string, projectName: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTemplateDir(srcPath, destPath, projectName);
    } else {
      const content = readFileSync(srcPath, 'utf8');
      writeFileSync(destPath, renderTemplate(content, { projectName }));
    }
  }
}

export function scaffoldProject({
  targetDir,
  projectName,
  cliVersion,
  templatesDir = TEMPLATES_DIR,
}: ScaffoldOptions): void {
  const alreadyExisted = existsSync(targetDir);
  try {
    copyTemplateDir(templatesDir, targetDir, projectName);
    insertModuleRegistration(join(targetDir, 'src', 'app.ts'), 'health');

    const manifest: Manifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      fastifyEpVersion: cliVersion,
      architecture: { schema: 'typebox', di: 'native', database: 'none' },
      modules: ['health'],
    };
    writeFileSync(join(targetDir, '.fastify-ep.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (err) {
    if (!alreadyExisted) {
      rmSync(targetDir, { recursive: true, force: true });
    } else {
      for (const entry of readdirSync(templatesDir)) {
        rmSync(join(targetDir, entry), { recursive: true, force: true });
      }
    }
    throw err;
  }
}
