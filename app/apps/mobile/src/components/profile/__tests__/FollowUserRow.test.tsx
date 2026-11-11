// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { User } from '@kc/domain';
import type { useFollowListStyles } from '../../../screens/followList.styles';
import { FollowUserRow } from '../FollowUserRow';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

vi.mock('../../ui/KCImage', () => ({
  KCImage: () => <span data-testid="kc-image" />,
}));

afterEach(cleanup);

const mockStyles = {
  row: {},
  rowText: {},
  name: {},
  city: {},
  menuBtn: {},
} as unknown as ReturnType<typeof useFollowListStyles>;

const createMockUser = (overrides: Partial<User> = {}): User => ({
  userId: 'user-1',
  shareHandle: 'jane_doe',
  displayName: 'Jane Doe',
  city: 'tel_aviv',
  cityName: 'Tel Aviv',
  profileStreet: null,
  profileStreetNumber: null,
  contactPhone: null,
  dateOfBirth: null,
  biography: null,
  avatarUrl: null,
  privacyMode: 'Public',
  privacyChangedAt: null,
  accountStatus: 'active',
  onboardingState: 'completed',
  notificationPreferences: {
    critical: true,
    social: true,
  },
  isSuperAdmin: false,
  closureExplainerDismissed: false,
  firstPostNudgeDismissed: false,
  itemsGivenCount: 0,
  itemsReceivedCount: 0,
  activePostsCountInternal: 0,
  followersCount: 0,
  followingCount: 0,
  karmaPoints: 0,
  verificationLevel: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  preferredLanguage: null,
  ...overrides,
});

describe('FollowUserRow', () => {
  it('renders user display name and city name', () => {
    const onOpen = vi.fn();
    const user = createMockUser();

    const { getByText } = render(
      <FollowUserRow
        user={user}
        fallbackName="Unnamed User"
        cityNotSet="No City"
        onOpen={onOpen}
        styles={mockStyles}
        textColorSecondary="#888"
      />,
    );

    expect(getByText('Jane Doe')).toBeTruthy();
    expect(getByText('Tel Aviv')).toBeTruthy();
  });

  it('renders fallback name and fallback city when fields are null', () => {
    const onOpen = vi.fn();
    const user = createMockUser({ displayName: null, cityName: null });

    const { getByText } = render(
      <FollowUserRow
        user={user}
        fallbackName="Fallback Name"
        cityNotSet="Fallback City"
        onOpen={onOpen}
        styles={mockStyles}
        textColorSecondary="#888"
      />,
    );

    expect(getByText('Fallback Name')).toBeTruthy();
    expect(getByText('Fallback City')).toBeTruthy();
  });

  it('triggers onOpen with shareHandle on tap', () => {
    const onOpen = vi.fn();
    const user = createMockUser();

    const { getByTestId } = render(
      <FollowUserRow
        user={user}
        fallbackName="Unnamed"
        cityNotSet="No City"
        onOpen={onOpen}
        styles={mockStyles}
        textColorSecondary="#888"
      />,
    );

    fireEvent.click(getByTestId('follow-user-user-1'));
    expect(onOpen).toHaveBeenCalledWith('jane_doe');
  });

  it('shows remove button when isMe=true and onRemove is passed, and clicking it invokes onRemove', () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    const user = createMockUser();

    const { getByTestId } = render(
      <FollowUserRow
        user={user}
        fallbackName="Unnamed"
        cityNotSet="No City"
        isMe={true}
        onOpen={onOpen}
        onRemove={onRemove}
        styles={mockStyles}
        textColorSecondary="#888"
      />,
    );

    const removeBtn = getByTestId('remove-follower-user-1');
    expect(removeBtn).toBeTruthy();
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith(user);
  });

  it('updates output when user prop changes (memoization preserves updates)', () => {
    const onOpen = vi.fn();
    const userA = createMockUser({ displayName: 'Alice' });
    const userB = createMockUser({ displayName: 'Alice Updated' });

    const { getByText, rerender, queryByText } = render(
      <FollowUserRow
        user={userA}
        fallbackName="Unnamed"
        cityNotSet="No City"
        onOpen={onOpen}
        styles={mockStyles}
        textColorSecondary="#888"
      />,
    );

    expect(getByText('Alice')).toBeTruthy();

    rerender(
      <FollowUserRow
        user={userB}
        fallbackName="Unnamed"
        cityNotSet="No City"
        onOpen={onOpen}
        styles={mockStyles}
        textColorSecondary="#888"
      />,
    );

    expect(queryByText('Alice')).toBeNull();
    expect(getByText('Alice Updated')).toBeTruthy();
  });
});
