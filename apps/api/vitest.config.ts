import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    pool: 'forks',
    testTimeout: 10_000,
  },
});
