import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/gci/**/*.test.ts'],
    maxConcurrency: 5,
    fileParallelism: false,
  },
});
