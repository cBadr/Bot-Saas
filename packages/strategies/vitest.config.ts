import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'strategies',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    pool: 'forks',
    testTimeout: 10_000,
  },
});
