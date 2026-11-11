import type { ReactNode } from 'react';
import { vi } from 'vitest';

vi.mock('@react-navigation/elements', () => ({
  useHeaderHeight: () => 44,
}));

// The package's CommonJS build ships raw TSX that Vitest cannot load; tests needing real insets mock it locally.
vi.mock('react-native-safe-area-context', () => {
  const insets = { top: 0, bottom: 0, left: 0, right: 0 };
  const passThrough = ({ children }: { children?: ReactNode }) => children ?? null;
  return {
    SafeAreaView: passThrough,
    SafeAreaProvider: passThrough,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
    initialWindowMetrics: { insets, frame: { x: 0, y: 0, width: 390, height: 844 } },
  };
});
