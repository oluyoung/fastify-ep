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

describe('nextSteps for the Production preset', () => {
  it('ends with the Docker build', () => {
    expect(nextSteps('my-app', 'npm', 'none', 'production')).toBe(
      'cd my-app\nnpm install\nnpm run dev\ndocker build -t my-app .  # needs the lockfile from the install above',
    );
  });

  it.each(['minimal', 'standard'] as const)('%s adds no Docker step', (preset) => {
    expect(nextSteps('my-app', 'npm', 'none', preset)).not.toContain('docker');
  });
});
