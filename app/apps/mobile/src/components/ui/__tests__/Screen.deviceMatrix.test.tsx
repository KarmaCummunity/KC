// @vitest-environment jsdom
//
// Device-matrix guard for the Screen primitive (FR-RESP-006 AC1).
//
// IMPORTANT: This test does NOT mock `useShellTabBarScrollInset` or the rest
// of `navigation/useShellTabBarVisibility` — it imports the real hook and
// only swaps `useSafeAreaInsets` per device. That way a regression in the
// real hook's formula (e.g. someone drops `spacing.lg` or `TAB_BAR_HEIGHT`)
// is actually caught here.
//
// `Screen` is imported dynamically inside each test so the mocked
// `useSafeAreaInsets` is read on fresh evaluation per device iteration.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { spacing, Text } from '@kc/ui';

interface DeviceProfile {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly topInset: number;
  readonly bottomInset: number;
}

const DEVICES: readonly DeviceProfile[] = [
  { name: 'iPhone SE 2nd/3rd gen',          width: 375, height: 667, topInset: 20, bottomInset: 0 },
  { name: 'iPhone 13 mini',                 width: 375, height: 812, topInset: 50, bottomInset: 34 },
  { name: 'iPhone 16 Pro',                  width: 393, height: 852, topInset: 59, bottomInset: 34 },
  { name: 'iPhone 16 Pro Max',              width: 430, height: 932, topInset: 59, bottomInset: 34 },
  { name: 'Android compact (gesture nav)',  width: 360, height: 800, topInset: 24, bottomInset: 16 },
  { name: 'Android compact (3-button nav)', width: 360, height: 800, topInset: 24, bottomInset: 48 },
];

const TAB_BAR_PILL_PX = 60; // matches navigation/useShellTabBarVisibility#TAB_BAR_HEIGHT

const capturedContentStyles: unknown[] = [];

vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...actual,
    ScrollView: (props: { contentContainerStyle?: unknown; children: React.ReactNode }) => {
      capturedContentStyles.push(props.contentContainerStyle);
      return React.createElement('div', { 'data-testid': 'mock-scrollview' }, props.children);
    },
  };
});

vi.mock('../AmbientBlobs', () => ({ AmbientBlobs: () => null }));

vi.mock('@kc/ui', async () => {
  const actual = await vi.importActual<typeof import('@kc/ui')>('@kc/ui');
  return { ...actual, useTheme: () => ({ colors: { surfaceCream: '#FFFBF7' }, isDark: false }) };
});

// Per-device state for the safe-area mock. We deliberately do NOT mock
// useShellTabBarVisibility here — the real hook is exercised.
let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useSafeAreaInsets: () => mockInsets,
}));

// The real useShellTabBarVisibility reads from expo-router segments + the
// auth store. Stub only those entry points so the real hook returns `true`
// (and its real formula computes the inset).
vi.mock('expo-router', () => ({
  useSegments: () => ['(tabs)', 'profile'],
  usePathname: () => '/profile',
  useGlobalSearchParams: () => ({}),
}));

vi.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean; isLoading: boolean }) => unknown) =>
    selector({ isAuthenticated: true, isLoading: false }),
}));

function flattenStyle(input: unknown): Record<string, unknown> {
  if (Array.isArray(input)) return Object.assign({}, ...input.filter(Boolean));
  return (input as Record<string, unknown>) ?? {};
}

describe('Screen — device-matrix tab-bar inset coverage (FR-RESP-006 AC1)', () => {
  beforeEach(() => {
    capturedContentStyles.length = 0;
  });

  it.each(DEVICES)(
    'reserves the real-hook inset (spacing.lg + pill + bottom) on $name',
    async (device) => {
      mockInsets = { top: device.topInset, bottom: device.bottomInset, left: 0, right: 0 };
      const { Screen } = await import('../Screen');
      render(
        <Screen scroll>
          <Text>body</Text>
        </Screen>,
      );
      const flat = flattenStyle(capturedContentStyles.at(-1));
      const expected = spacing.lg + TAB_BAR_PILL_PX + device.bottomInset;
      // Exact equality: catches drift in either the real hook's formula or in
      // Screen's wiring. The 6 devices exercise the bottom-inset dimension.
      expect(flat.paddingBottom).toBe(expected);
    },
  );
});
