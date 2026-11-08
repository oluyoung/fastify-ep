import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Migration tests scaffold several projects; Windows runners are slow at that.
    testTimeout: 30_000,
  },
});
