// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  listPosts: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('../../../services/guestBrowseComposition', () => ({
  getGuestProfile: { execute: mocks.getProfile },
  listGuestProfilePosts: { execute: mocks.listPosts },
}));
vi.mock('@expo/vector-icons', async () => (await import('../../../components/ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-native-reanimated', async () => (await import('../../../components/ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('../../../components/ui/KCImage', () => ({ KCImage: () => null }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k}:${JSON.stringify(opts)}` : k,
    i18n: { language: 'en' },
  }),
}));

import { GuestProfileScreen } from '../GuestProfileScreen';

const profile = {
  shareHandle: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  biography: 'Hello',
  cityNameHe: 'לוד',
  cityNameEn: 'Lod',
  verificationLevel: 1,
  followersCount: 2,
  followingCount: 0,
  itemsGivenCount: 1,
  itemsReceivedCount: 0,
  openPostsCount: 3,
};
const post = {
  id: '40000000-0000-4000-8000-000000000001',
  title: 'Desk',
  description: 'A desk',
  cityNameHe: 'לוד',
  cityNameEn: 'Lod',
};

function show(handle = 'alice') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <GuestProfileScreen handle={handle} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProfile.mockResolvedValue(profile);
  mocks.listPosts.mockResolvedValue([post]);
});

describe('GuestProfileScreen', () => {
  it('renders a public profile and opens guest post detail without write controls', async () => {
    show();
    expect(await screen.findByTestId('guest-profile')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('@alice')).toBeTruthy();
    expect(await screen.findByText('Desk')).toBeTruthy();
    fireEvent.click(screen.getByTestId(`guest-post-${post.id}`));
    expect(mocks.push).toHaveBeenCalledWith({
      pathname: '/browse/post/[id]',
      params: { id: post.id },
    });
    for (const write of ['follow', 'chat', 'report', 'save']) {
      expect(screen.queryByText(write)).toBeNull();
    }
  });

  it('shows a neutral unavailable state when the profile is missing', async () => {
    mocks.getProfile.mockResolvedValue(null);
    show('nobody');
    expect(await screen.findByTestId('guest-profile-unavailable')).toBeTruthy();
    expect(mocks.listPosts).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
