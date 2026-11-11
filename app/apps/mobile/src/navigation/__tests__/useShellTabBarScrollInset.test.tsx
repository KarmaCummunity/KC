// @vitest-environment jsdom
// KC#1387: anything anchored above the docked tab bar (scroll content, the
// post-detail floating CTA) must clear the bar's full height — the 48px icon
// row *plus* the bottom safe-area inset the bar extends under. An absolutely
// positioned element gets no lift from a SafeAreaView's padding, so the hook
// has to return the inset itself.
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  segments: ['(tabs)'] as string[],
  pathname: '/',
  insetBottom: 34,
}));

vi.mock('expo-router', () => ({
  useSegments: () => mocks.segments,
  usePathname: () => mocks.pathname,
  useGlobalSearchParams: () => ({}),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: mocks.insetBottom, left: 0, right: 0 }),
}));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean; isLoading: boolean }) => unknown) =>
    selector({ isAuthenticated: true, isLoading: false }),
}));

import { useShellTabBarScrollInset } from '../useShellTabBarVisibility';

function Probe({ extra }: { extra?: number }) {
  const inset = useShellTabBarScrollInset(extra);
  return <span data-testid="inset">{inset}</span>;
}

function readInset(extra?: number): number {
  const { getByTestId } = render(<Probe extra={extra} />);
  const value = Number(getByTestId('inset').textContent);
  cleanup();
  return value;
}

describe('useShellTabBarScrollInset', () => {
  it('adds the bar height and the safe-area inset to the extra gap while the bar shows', () => {
    mocks.segments = ['(tabs)'];
    mocks.insetBottom = 34;
    expect(readInset(16)).toBe(16 + 48 + 34);
  });

  it('keeps only the gap and the inset where the bar is hidden (chat conversation)', () => {
    mocks.segments = ['chat', '[id]'];
    mocks.insetBottom = 34;
    expect(readInset(16)).toBe(16 + 34);
  });

  it('reserves tab-bar height inside the admin portal (shell chrome stays on)', () => {
    mocks.segments = ['(admin)', 'reports'];
    mocks.pathname = '/admin/reports';
    mocks.insetBottom = 34;
    expect(readInset(0)).toBe(48 + 34);
  });

  it('collapses to the bar height alone on a device without a bottom inset', () => {
    mocks.segments = ['post', '[id]'];
    mocks.insetBottom = 0;
    expect(readInset(0)).toBe(48);
  });
});
