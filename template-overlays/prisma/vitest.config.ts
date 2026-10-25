import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Clients connect lazily, so tests run without a database. Readiness reports `down` until one is up.
    env: { DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/app' },
    include: ['src/**/*.test.ts'],
  },
});
