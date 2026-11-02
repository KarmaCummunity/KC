// Test doubles and helpers for screens whose dialogs are built on the kit
// `Modal` and buttons (spec 17 §4.1). Not a test file itself.
//
// `vi.mock` factories are hoisted above the imports, so a test file loads the
// doubles with a dynamic import inside the factory:
//
//   vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
import type React from 'react';
import { View } from 'react-native';
import { fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

/** Reanimated does not transform under Vitest; the buttons' press scale is not under test. */
export const reanimatedDouble = {
  default: { View },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: () => ({}),
  withSpring: (value: number) => value,
  withTiming: (value: number) => value,
  withDelay: (_delay: number, value: number) => value,
};

export const hapticsDouble = {
  impactAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Light: 'light' },
};

/** The real safe-area entry does not load under jsdom. */
export const safeAreaDouble = {
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: View,
};

/** `t` returns the key, so tests assert on keys instead of copy. */
export const i18nDouble = {
  useTranslation: () => ({ t: (key: string) => key }),
};

export const iconsDouble = {
  Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
};

/**
 * React Native Web's Modal becomes the active dialog (role, Escape handling)
 * only when its fade-in ends, and leaves the page only when its fade-out ends;
 * jsdom runs no CSS animations, so end them by hand on every ancestor of each
 * dialog (only the animated one listens). Call after opening or closing one.
 */
export function finishModalAnimation(): void {
  document.querySelectorAll('[aria-modal="true"]').forEach((dialog) => {
    let node = dialog.parentElement;
    while (node) {
      fireEvent.animationEnd(node);
      node = node.parentElement;
    }
  });
}

/** Renders `ui` in the light theme and settles any dialog it opens. */
export function renderInTheme(ui: React.ReactElement) {
  const utils = render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      {ui}
    </ThemeProvider>,
  );
  finishModalAnimation();
  return utils;
}

/** jsdom reports colours as `rgb(r, g, b)`; convert a token hex to compare. */
export function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
