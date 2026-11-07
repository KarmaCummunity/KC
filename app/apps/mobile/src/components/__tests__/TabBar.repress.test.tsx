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
  back: vi.fn(),
  canGoBack: vi.fn(() => true),
};
let segments: string[] = [];
let pathname = '/';

vi.mock('expo-router', () => ({
  useRouter: () => router,
  useSegments: () => segments,
  usePathname: () => pathname,
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
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

  it('opens the create form over a root-level screen without popping it (FR-POST-001 AC9)', () => {
    onRoute(['post', '[id]'], '/post/abc');
    router.canDismiss.mockReturnValue(true);
    const { getByTestId } = render(<TabBar />);
    fireEvent.click(getByTestId('tab-create'));
    expect(router.dismissAll).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/create');
  });
});

// FR-POST-001: the "+" turns into "×" while the create form is open.
describe('TabBar "+" button', () => {
  const turned = (el: HTMLElement) => el.querySelector('[style*="rotate(45deg)"]');

  it('is turned 45° into an "×" while the create form is open', () => {
    onRoute(['create'], '/create');
    const { getByTestId } = render(<TabBar />);
    expect(turned(getByTestId('tab-create'))).not.toBeNull();
  });

  it('closes the create form when "+" is tapped again', () => {
    onRoute(['create'], '/create');
    const { getByTestId } = render(<TabBar />);
    fireEvent.click(getByTestId('tab-create'));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('opens the create form when "+" is tapped on another screen', () => {
    onRoute(['(tabs)', 'donations'], '/donations');
    const { getByTestId } = render(<TabBar />);
    fireEvent.click(getByTestId('tab-create'));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
  });

  it('stays an upright "+" on every other screen', () => {
    onRoute(['(tabs)', 'donations'], '/donations');
    const { getByTestId } = render(<TabBar />);
    expect(turned(getByTestId('tab-create'))).toBeNull();
  });
});
