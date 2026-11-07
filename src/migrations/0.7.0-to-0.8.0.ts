import type { Migration } from './types.js';

/** 0.7.0 to 0.8.0 changed `doctor` only; generated projects are identical, so nothing to do. */
export const migration0_7_0To0_8_0: Migration = {
  id: '0.7.0-to-0.8.0',
  from: '0.7.0',
  to: '0.8.0',
  plan: () => [],
};
