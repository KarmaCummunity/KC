// @vitest-environment jsdom
// FR-VERIFY-003 AC1 — profile card inviting identity verification.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@kc/domain';

const router = { push: vi.fn(), replace: vi.fn() };

vi.mock('expo-router', () => ({ useRouter: () => router }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'he' },
  }),
}));
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

const userLevel1 = {
  displayName: 'Nave',
  city: 'tlv',
  dateOfBirth: '1990-01-01',
  avatarUrl: 'https://example.test/a.png',
  profileStreet: 'Herzl',
  profileStreetNumber: '12',
  contactPhone: '0501234567',
  verificationLevel: 1,
  karmaPoints: 0,
  followersCount: 0,
  followingCount: 0,
  privacyMode: 'Public',
  shareHandle: 'nave',
} as unknown as User;

vi.mock('../../../services/userComposition', () => ({
  getUserRepo: () => ({ findById: () => Promise.resolve(userLevel1) }),
}));
vi.mock('../../../hooks/useProfileTabCounts', () => ({
  useProfileTabCounts: () => ({ openCount: 0, closedCount: 0, totalCount: 0 }),
}));

import { MyProfileChrome } from '../MyProfileChrome';

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('MyProfileChrome identity nudge', () => {
  it('shows the identity reminder for a complete profile below level 2', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MyProfileChrome activeTab="open" onTabChange={() => {}} />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('profile-identity-nudge')).toBeTruthy();
    fireEvent.click(screen.getByTestId('profile-identity-nudge-cta'));
    expect(router.push).toHaveBeenCalledWith('/identity-verification');
  });
});
