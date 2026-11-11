// @vitest-environment jsdom
// Regression for #1633: the My Profile tab strip hands the lane to the screen instead
// of navigating to a sibling route (which re-mounted the whole screen on every switch).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const router = { push: vi.fn(), replace: vi.fn() };

vi.mock('expo-router', () => ({ useRouter: () => router }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({
  // Echo the key plus interpolated count so each tab label is unique and stable.
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => (opts?.count === undefined ? key : `${key}:${opts.count}`),
    i18n: { language: 'he' },
  }),
}));
// Heavy children are outside this test's scope; the real ProfileTabs stays in.
vi.mock('../../TopBar', () => ({ TopBar: () => null }));
vi.mock('../MyProfileOverflowMenu', () => ({ MyProfileOverflowMenu: () => null }));
vi.mock('../ProfileHeader', () => ({ ProfileHeader: () => null }));
vi.mock('../ProfileStatsRow', () => ({ ProfileStatsRow: () => null }));
vi.mock('../KarmaBadge', () => ({ KarmaBadge: () => null }));
vi.mock('../../ui/MirroredIcon', () => ({ MirroredIcon: () => null }));
vi.mock('../../ui/MotionEntry', () => ({
  MotionEntry: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ENTRY_DELAY: { hero: 0, section: 0 },
}));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (select: (state: { session: { userId: string } }) => unknown) =>
    select({ session: { userId: 'user-1' } }),
}));
vi.mock('../../../services/userComposition', () => ({
  getUserRepo: () => ({ findById: () => Promise.resolve(null) }),
}));
vi.mock('../../../hooks/useProfileTabCounts', () => ({
  useProfileTabCounts: () => ({ openCount: 3, closedCount: 2, totalCount: 5 }),
}));

import { MyProfileChrome } from '../MyProfileChrome';
import type { ProfilePostsTab } from '../ProfileTabs';

function renderChrome(activeTab: ProfilePostsTab, onTabChange: (tab: ProfilePostsTab) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MyProfileChrome activeTab={activeTab} onTabChange={onTabChange} />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('MyProfileChrome tabs (#1633)', () => {
  it('reports the tapped lane to the screen without any navigation', () => {
    const onTabChange = vi.fn();
    const { getByText } = renderChrome('open', onTabChange);
    fireEvent.click(getByText('profile.tabClosedWithCount:2'));
    expect(onTabChange).toHaveBeenCalledWith('closed');
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('ignores a tap on the lane that is already active', () => {
    const onTabChange = vi.fn();
    const { getByText } = renderChrome('closed', onTabChange);
    fireEvent.click(getByText('profile.tabClosedWithCount:2'));
    expect(onTabChange).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
