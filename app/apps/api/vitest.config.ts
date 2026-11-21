import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // NestJS resolves constructor dependencies from decorator metadata, which
  // esbuild (vitest's default transformer) does not emit; SWC does, using the
  // decorator settings of tsconfig.json.
  plugins: [swc.vite()],
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts only wires the process (listen, exit code); the build smoke
      // test in the PR covers it.
      exclude: ['src/**/__tests__/**', 'src/main.ts'],
      thresholds: {
        lines: 85,
        functions: 90,
        branches: 85,
        statements: 85,
      },
      reporter: ['text', 'json-summary', 'lcov'],
    },
  },
});
