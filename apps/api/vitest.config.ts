import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false, // files share one test database
    env: { NODE_ENV: 'test' },
    testTimeout: 20_000,
  },
});
