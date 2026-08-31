import * as clack from '@clack/prompts';
import { generateModule } from '../generate-module.js';

export async function runGenerateModule(moduleName: string, cwd: string): Promise<void> {
  clack.intro('fastify-ep generate module');

  try {
    generateModule({ targetDir: cwd, moduleName });
  } catch (err) {
    clack.log.error(err instanceof Error ? err.message : String(err));
    clack.outro('Failed.');
    process.exit(1);
  }

  clack.log.success(`Generated module "${moduleName}".`);
  clack.outro('Done.');
}
