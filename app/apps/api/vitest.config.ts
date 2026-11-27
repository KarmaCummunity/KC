import swc from 'unplugin-swc';
import { configDefaults, defineConfig } from 'vitest/config';

// Suites that need more than the code are not collected without it, instead of being skipped
// inside the file (the repository's rule for conditional tests; see
// packages/infrastructure-supabase/vitest.config.ts). `apps/api/README.md` says how to provide each.
//
// The KC schema: a throwaway database built by `scripts/kc-test-db.sh`.
const hasKcSchema = Boolean(process.env.KC_API_TEST_KC_DATABASE_URL);
// A live Postgres and Redis that the suites may create roles, schemas and keys in.
const hasDisposableStack = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL) && process.env.KC_API_TEST_DISPOSABLE_DATABASE === '1';
const KC_SCHEMA_SUITES = ['src/**/*.kc.integration.test.ts', 'src/**/*.contract.integration.test.ts'];
const DISPOSABLE_STACK_SUITES = [
  'src/__tests__/dependencies.integration.test.ts',
  'src/__tests__/identityDatabase.integration.test.ts',
  'src/__tests__/rateLimiter.integration.test.ts',
  'src/platform/realtime/__tests__/redisEphemeralEvents.integration.test.ts',
];
// The Cloud Storage emulator, at the address in KC_API_TEST_GCS_ENDPOINT.
const hasGcsEmulator = Boolean(process.env.KC_API_TEST_GCS_ENDPOINT);
const GCS_EMULATOR_SUITES = ['src/**/*.gcs.integration.test.ts'];
// A real PostgREST over the KC schema (the local Supabase stack), which the compatibility engine is compared with.
const hasPostgrest = Boolean(process.env.KC_API_TEST_POSTGREST_URL);
const POSTGREST_PARITY_SUITES = ['src/**/*.parity.integration.test.ts'];
// A real Cloud Storage project: its buckets carry the prefix in KC_API_TEST_GCS_BUCKET_PREFIX and the run has Google credentials of its own.
const hasGcsProject = Boolean(process.env.KC_API_TEST_GCS_BUCKET_PREFIX);
const GCS_PROJECT_SUITES = ['src/**/*.cloud.integration.test.ts'];

// A real Supabase Storage (the local Supabase stack with its storage service), which the copy of the existing files reads from.
const hasSupabaseStorage = Boolean(process.env.KC_API_TEST_SUPABASE_URL);
const SUPABASE_STORAGE_SUITES = ['src/**/*.supabase.integration.test.ts'];

/**
 * Coverage floors (percent). Much of this server is code that talks to the database, and its
 * tests are the suites above: the full floor holds when they are collected, and a run without
 * the databases keeps a floor of its own, so neither run can lose coverage unnoticed.
 */
const FULL_RUN_THRESHOLDS = { lines: 85, functions: 90, branches: 85, statements: 85 };
const UNIT_RUN_THRESHOLDS = { lines: 83, functions: 75, branches: 76, statements: 80 };

export default defineConfig({
  // NestJS resolves constructor dependencies from decorator metadata, which
  // esbuild (vitest's default transformer) does not emit; SWC does, using the
  // decorator settings of tsconfig.json.
  plugins: [swc.vite()],
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: [
      ...configDefaults.exclude,
      ...(hasKcSchema ? [] : KC_SCHEMA_SUITES),
      ...(hasDisposableStack ? [] : DISPOSABLE_STACK_SUITES),
      ...(hasGcsEmulator ? [] : GCS_EMULATOR_SUITES),
      ...(hasPostgrest ? [] : POSTGREST_PARITY_SUITES),
      ...(hasGcsProject ? [] : GCS_PROJECT_SUITES),
      ...(hasSupabaseStorage ? [] : SUPABASE_STORAGE_SUITES),
    ],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts only wires the process (listen, exit code); the build smoke
      // test in the PR covers it.
      exclude: ['src/**/__tests__/**', 'src/main.ts'],
      thresholds: hasKcSchema && hasDisposableStack ? FULL_RUN_THRESHOLDS : UNIT_RUN_THRESHOLDS,
      reporter: ['text', 'json-summary', 'lcov'],
    },
  },
});
