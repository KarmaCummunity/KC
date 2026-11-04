// @vitest-environment jsdom
// Regression for #1633: switching the My Profile open / closed tabs swaps only the
// posts list; the chrome (TopBar, profile card, tab strip) stays mounted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let searchParams: { tab?: string } = {};
const chromeMounts = vi.fn();
const useProfileClosedPosts = vi.fn((_args: { enabled?: boolean }) => ({
  items: [],
  isLoading: false,
  hasMore: false,
  isLoadingMore: false,
  loadMore: () => undefined,
}));

vi.mock('expo-router', () => ({ useLocalSearchParams: () => searchParams }));
// Chrome stub: counts mounts and exposes the two lanes as buttons.
vi.mock('../../../components/profile/MyProfileChrome', () => ({
  MyProfileChrome: ({ activeTab, onTabChange }: { activeTab: string; onTabChange: (t: string) => void }) => {
    React.useEffect(() => chromeMounts(), []);
    return (
      <div data-testid="chrome" data-active={activeTab}>
        <button onClick={() => onTabChange('open')}>open</button>
        <button onClick={() => onTabChange('closed')}>closed</button>
      </div>
    );
  },
}));
vi.mock('../../../components/profile/ProfilePostsGrid', () => ({
  ProfilePostsGrid: () => <div data-testid="open-lane" />,
}));
vi.mock('../../../components/profile/ProfileClosedPostsGrid', () => ({
  ProfileClosedPostsGrid: () => <div data-testid="closed-lane" />,
}));
vi.mock('../../../components/ui/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => <div data-testid="my-profile-screen">{children}</div>,
}));
vi.mock('../../../components/aside/useScreenAside', () => ({ useScreenAside: () => undefined }));
vi.mock('../../../components/aside/ProfileStatsAside', () => ({ ProfileStatsAside: () => null }));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({ useShellTabBarScrollInset: () => 0 }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (select: (state: { session: { userId: string } }) => unknown) =>
    select({ session: { userId: 'user-1' } }),
}));
vi.mock('../../../services/postsComposition', () => ({
  getMyPostsUseCase: () => ({ execute: () => Promise.resolve({ posts: [] }) }),
}));
vi.mock('../../../hooks/useProfileClosedPosts', () => ({
  useProfileClosedPosts: (args: { enabled?: boolean }) => useProfileClosedPosts(args),
}));
vi.mock('../../../hooks/useProfilePostOwner', () => ({ useMyProfilePostOwner: () => null }));

import { MyProfileScreen } from '../MyProfileScreen';
import { getRestoredProfileTab, persistProfileTab } from '../../../lib/profileTabSession';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MyProfileScreen />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  searchParams = {};
  persistProfileTab('self', 'open');
});

describe('MyProfileScreen tabs (#1633)', () => {
  it('swaps only the posts list and keeps the chrome mounted', () => {
    const { getByTestId, getByText, queryByTestId } = renderScreen();
    expect(getByTestId('open-lane')).toBeTruthy();

    act(() => fireEvent.click(getByText('closed')));
    expect(getByTestId('closed-lane')).toBeTruthy();
    expect(queryByTestId('open-lane')).toBeNull();
    expect(getByTestId('chrome').getAttribute('data-active')).toBe('closed');

    act(() => fireEvent.click(getByText('open')));
    expect(getByTestId('open-lane')).toBeTruthy();
    expect(chromeMounts).toHaveBeenCalledTimes(1);
  });

  it('loads the closed lane up front so the first switch is instant', () => {
    renderScreen();
    expect(useProfileClosedPosts).toHaveBeenCalled();
    for (const [args] of useProfileClosedPosts.mock.calls) expect(args.enabled).not.toBe(false);
  });

  it('remembers the lane for the session', () => {
    const { getByText } = renderScreen();
    act(() => fireEvent.click(getByText('closed')));
    expect(getRestoredProfileTab('self')).toBe('closed');
  });

  it('restores the remembered lane when the screen mounts again', () => {
    persistProfileTab('self', 'closed');
    const { getByTestId } = renderScreen();
    expect(getByTestId('closed-lane')).toBeTruthy();
  });

  it('opens on the closed lane from the legacy ?tab=closed link', () => {
    searchParams = { tab: 'closed' };
    const { getByTestId } = renderScreen();
    expect(getByTestId('closed-lane')).toBeTruthy();
  });
});
