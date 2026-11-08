import type { Migration } from './types.js';

/**
 * 0.11.0 to 0.12.0: generated projects and libraries move from TypeScript 5 to 6. Only the
 * `typescript` range in `package.json` changes, and only if it is still the generated `^5.5.4`; a
 * range you set yourself is reported for review. The Node 24 move in the same release has no
 * migration: `engines`, `@types/node` and the Dockerfile stay as they are.
 */
export const migration0_11_0To0_12_0: Migration = {
  id: '0.11.0-to-0.12.0',
  from: '0.11.0',
  to: '0.12.0',
  plan: () => [
    {
      kind: 'json-key',
      path: 'package.json',
      keyPath: ['devDependencies', 'typescript'],
      from: '^5.5.4',
      to: '^6.0.0',
    },
  ],
};
