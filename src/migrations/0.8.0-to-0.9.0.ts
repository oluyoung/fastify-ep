import { BaselineUnavailableError, computeBaseline } from '../baseline.js';
import { ARCHITECTURE_VERSION } from '../manifest.js';
import type { Migration, MigrationRequest } from './types.js';

/**
 * 0.8.0 to 0.9.0: converts the manifest to schema 3. A schema 2 manifest has no file hashes, so the
 * project is re-rendered with the current templates and every byte-identical file is recorded as
 * generated. Files that differ are left untracked (so later upgrades never overwrite them) and
 * listed for review. Runs after the earlier migrations, which bring older output up to date first.
 */
export const migration0_8_0To0_9_0: Migration = {
  id: '0.8.0-to-0.9.0',
  from: '0.8.0',
  to: '0.9.0',
  plan: ({ manifest, root, read }) => {
    if (manifest.schemaVersion !== 2) return [];

    const convert = (files: Record<string, string>): MigrationRequest => ({
      kind: 'manifest',
      changes: { schemaVersion: 3, architectureVersion: ARCHITECTURE_VERSION, files },
    });

    try {
      const baseline = computeBaseline(root, manifest, read);
      return [
        convert(baseline.files),
        ...baseline.differing.map((path): MigrationRequest => ({
          kind: 'review',
          path,
          reason:
            'does not match what fastify-ep generates (local modifications, or generated with options the upgrade cannot detect); it is left untracked and will not be changed.',
        })),
      ];
    } catch (err) {
      if (!(err instanceof BaselineUnavailableError)) throw err;
      return [
        convert({}),
        {
          kind: 'review',
          path: '.fastify-ep.json',
          reason: `file hashes could not be recorded (${err.message}); every file is treated as yours until you run upgrade again.`,
        },
      ];
    }
  },
};
