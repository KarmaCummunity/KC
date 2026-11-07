import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Use the automatic JSX runtime so React-Testing-Library snapshot tests
  // (e.g. src/components/shell/__tests__/AppShell.snapshot.test.tsx) can
  // render components that don't `import React from 'react'` — without this,
  // esbuild defaults to the classic runtime and any transitively-rendered
  // component fails with "React is not defined".
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
    environment: 'node',
    globals: false,
    server: {
      deps: {
        // react-native ships Flow syntax; route imports to react-native-web for tests
        inline: ['react-native'],
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Mobile is mostly UI surfaces; there is no RNTL/jest infrastructure
      // here yet (tracked as TD-150). Limit coverage scope to the slices we
      // *do* unit-test (config/lib/store/hooks/services) and exclude raw UI
      // screens + composition wiring until TD-150 is closed.
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.d.ts',
        // UI surfaces — covered (or not) via RNTL slice TD-150
        'src/components/**',
        'src/features/**',
        // Screen bodies / styles moved out of expo-router `app/` (TD-195); `app/` itself is not measured.
        'src/screens/**',
        'src/navigation/**/*.tsx',
        'src/navigation/useShellTabBarVisibility.ts',
        // React-bound hooks need RNTL infra — out of scope until TD-150
        'src/hooks/**',
        // Localization bundles (string maps, no runtime branches)
        'src/i18n/**',
        // Composition roots — exercised end-to-end, not unit-tested
        'src/services/*Composition.ts',
        'src/services/devAutoSignIn.ts',
        // Type-only module (no runtime statements)
        'src/store/chatStoreTypes.ts',
        // DI container — composition root
        'src/lib/container.ts',
        // Query-cache persistence wiring (singleton QueryClient + AsyncStorage
        // persister) — composition root, exercised end-to-end like container.ts
        'src/lib/queryPersist.ts',
        // Notification tap hook: IO wiring (expo-router/expo-notifications) — the
        // pure routing logic lives in tapRouting.ts and IS unit-tested.
        'src/lib/notifications/tapHandler.ts',
        'src/lib/permissionGate.ts',
        // Brand font loader: expo-font wiring around @kc/ui brandFont (unit-tested there).
        'src/lib/useBrandFonts.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 85,
        branches: 75,
        statements: 80,
      },
      reporter: ['text', 'json-summary', 'lcov'],
    },
  },
  resolve: {
    alias: {
      'react-native': 'react-native-web',
    },
  },
});
