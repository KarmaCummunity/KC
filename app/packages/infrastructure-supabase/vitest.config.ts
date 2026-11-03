import { configDefaults, defineConfig } from 'vitest/config';

// Port contract suites (G39, D-204) run against a live Supabase stack and need its
// credentials; without them they are not collected, instead of being skipped
// inside the file. ci-backend exports the three variables from `supabase status`.
const hasStack = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
  .every((name) => Boolean(process.env[name]));

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...(hasStack ? [] : ['src/**/*.contract.integration.test.ts'])],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/*.integration.test.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
      reporter: ['text', 'json-summary', 'lcov'],
    },
  },
});
