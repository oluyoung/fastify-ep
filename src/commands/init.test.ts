import { describe, expect, it } from 'vitest';
import { nextSteps } from './init.js';

describe('nextSteps', () => {
  it('is install and dev for a project without a database', () => {
    expect(nextSteps('my-app', 'npm', 'none')).toBe('cd my-app\nnpm install\nnpm run dev');
  });

  it.each(['drizzle', 'prisma'] as const)(
    '%s: copies .env and starts Postgres first',
    (database) => {
      expect(nextSteps('my-app', 'pnpm', database)).toBe(
        'cd my-app\ncp .env.example .env\ndocker compose up -d\npnpm install\npnpm run dev',
      );
    },
  );
});
