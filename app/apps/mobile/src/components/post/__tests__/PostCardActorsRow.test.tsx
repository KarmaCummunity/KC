// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PostWithOwner } from '@kc/application';

vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock('../../AvatarInitials', () => ({ AvatarInitials: () => null }));
vi.mock('../../VerificationBadge', () => ({ VerificationBadge: () => null }));
vi.mock('../../ui/MirroredIcon', () => ({ MirroredIcon: () => null }));

import { PostCardActorsRow } from '../PostCardActorsRow';

const base = {
  postId: 'p1',
  ownerId: 'u1',
  type: 'Give',
  status: 'closed_delivered',
  ownerName: 'Owner',
  ownerHandle: 'owner',
  ownerAvatarUrl: null,
  ownerPrivacyMode: 'Public',
  distanceKm: null,
} as unknown as PostWithOwner;

afterEach(cleanup);

describe('PostCardActorsRow', () => {
  it('shows owner and counterparty on closed posts', () => {
    const post = {
      ...base,
      recipientUser: {
        userId: 'u2',
        displayName: 'Partner',
        shareHandle: 'partner',
        avatarUrl: null,
      },
    };
    render(<PostCardActorsRow post={post} />);
    expect(screen.getByTestId('post-card-owner')).toBeTruthy();
    expect(screen.getByTestId('post-card-counterparty')).toBeTruthy();
  });

  it('shows only owner on open posts', () => {
    const post = { ...base, status: 'open', recipientUser: null };
    render(<PostCardActorsRow post={post} />);
    expect(screen.getByTestId('post-card-owner')).toBeTruthy();
    expect(screen.queryByTestId('post-card-counterparty')).toBeNull();
  });
});
