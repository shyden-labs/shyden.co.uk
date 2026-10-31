import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/device/ios/**/*.journey.ts'],
    // One phone, one WebDriver session: files must not run concurrently.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
