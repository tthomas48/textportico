import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    include: ['packages/core/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
  lint: {
    ignorePatterns: ['**/dist/**', 'node_modules'],
  },
  fmt: {
    semi: true,
    singleQuote: true,
  },
});
