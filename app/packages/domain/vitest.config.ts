import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Type-only files compile to no JS — v8 reports them as 0% covered
      // and drags the line total below threshold. Exclude them explicitly,
      // along with the barrel and integration tests.
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.integration.test.ts',
        'src/index.ts',
        'src/entities.ts',
        'src/posts.ts',
        'src/audit.ts',
        'src/donations.ts',
        'src/searchTypes.ts',
        'src/personalActivity.ts',
      ],
      thresholds: {
        lines: 97,
        functions: 99,
        branches: 97,
        statements: 97,
      },
      reporter: ['text', 'json-summary', 'lcov'],
    },
  },
});
