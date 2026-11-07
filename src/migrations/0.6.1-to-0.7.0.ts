import type { Migration } from './types.js';

/** 0.6.1 to 0.7.0: vitest 5 needs vite 7 next to it. */
export const migration0_6_1To0_7_0: Migration = {
  id: '0.6.1-to-0.7.0',
  from: '0.6.1',
  to: '0.7.0',
  plan: () => [
    {
      kind: 'json-key',
      path: 'package.json',
      keyPath: ['devDependencies', 'vitest'],
      from: '^4.1.0',
      to: '^5.0.5',
    },
    {
      kind: 'json-key',
      path: 'package.json',
      keyPath: ['devDependencies', 'vite'],
      from: undefined,
      to: '^7.0.0',
    },
  ],
};
