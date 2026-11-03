import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/*.integration.test.ts'],
      thresholds: {
        lines: 92,
        functions: 99,
        branches: 97,
        statements: 92,
      },
      reporter: ['text', 'json-summary', 'lcov'],
    },
  },
});
