import { migration0_10_0To0_11_0 } from './0.10.0-to-0.11.0.js';
import { migration0_11_0To0_12_0 } from './0.11.0-to-0.12.0.js';
import { migration0_6_0To0_6_1 } from './0.6.0-to-0.6.1.js';
import { migration0_6_1To0_7_0 } from './0.6.1-to-0.7.0.js';
import { migration0_7_0To0_8_0 } from './0.7.0-to-0.8.0.js';
import { migration0_8_0To0_9_0 } from './0.8.0-to-0.9.0.js';
import type { Migration } from './types.js';

export { applyPlan, type ApplyOptions } from './apply.js';
export { planUpgrade, type PlanOptions } from './plan.js';
export * from './types.js';

/** The oldest project version `upgrade` can migrate. */
export const MINIMUM_SUPPORTED_VERSION = '0.6.0';

/** Every migration, in any order; the planner sorts and filters by version. */
export const MIGRATIONS: readonly Migration[] = [
  migration0_6_0To0_6_1,
  migration0_6_1To0_7_0,
  migration0_7_0To0_8_0,
  migration0_8_0To0_9_0,
  migration0_10_0To0_11_0,
  migration0_11_0To0_12_0,
];
