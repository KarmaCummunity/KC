// @vitest-environment jsdom
// Regression for #1633: re-tapping the active bottom-bar tab must not push a second
// copy of its screen (that re-mounts it and replays its entry animation).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';

const router = {
  push: vi.fn(),
  dismissTo: vi.fn(),
  dismissAll: vi.fn(),
  canDismiss: vi.fn(() => false),
};
let segments: string[] = [];
let pathname = '/';

vi.mock('expo-router', () => ({
  useRouter: () => router,
  useSegments: () => segments,
  usePathname: () => pathname,
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'he' } }),
}));

import { TabBar } from '../TabBar';

/** Points the mocked router at a route, e.g. `onRoute(['(tabs)', 'donations'], '/donations')`. */
function onRoute(nextSegments: string[], nextPathname: string) {
  segments = nextSegments;
  pathname = nextPathname;
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  router.canDismiss.mockReturnValue(false);
});

describe('TabBar re-tap (#1633)', () => {
  it('keeps the active tab root as is: no push, no dismiss', () => {
    onRoute(['(tabs)', 'donations'], '/donations');
    const { getByTestId } = render(<TabBar />);
    fireEvent.click(getByTestId('tab-donations'));
    expect(router.push).not.toHaveBeenCalled();
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  it('keeps the home feed as is when home is re-tapped', () => {
    onRoute(['(tabs)'], '/');
    const { getByTestId } = render(<TabBar />);
    fireEvent.click(getByTestId('tab-home'));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('unwinds a nested screen of the active tab back to its root', () => {
    onRoute(['(tabs)', 'donations', 'food'], '/donations/food');
    const { getByTestId } = render(<TabBar />);
    fireEvent.click(getByTestId('tab-donations'));
    expect(router.dismissTo).toHaveBeenCalledWith('/(tabs)/donations');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('still opens another tab with a push', () => {
    onRoute(['(tabs)', 'donations'], '/donations');
    const { getByTestId } = render(<TabBar />);
    fireEvent.click(getByTestId('tab-profile'));
    expect(router.push).toHaveBeenCalledWith('/(tabs)/profile');
  });

  it('still pops a root-level screen before opening a tab from over it', () => {
    onRoute(['post', '[id]'], '/post/abc');
    router.canDismiss.mockReturnValue(true);
    const { getByTestId } = render(<TabBar />);
    fireEvent.click(getByTestId('tab-home'));
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/(tabs)');
  });
});
