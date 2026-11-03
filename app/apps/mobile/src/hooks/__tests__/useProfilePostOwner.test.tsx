// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

const { findById } = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('../../services/userComposition', () => ({ getUserRepo: () => ({ findById }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (state: { session: { userId: string } | null }) => unknown) =>
    selector({ session: { userId: 'self-1' } }),
}));

import { useMyProfilePostOwner } from '../useProfilePostOwner';

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  findById.mockReset();
});
afterEach(() => client.clear());

describe('useMyProfilePostOwner', () => {
  it('maps the signed-in user into the card owner context', async () => {
    findById.mockResolvedValue({
      userId: 'self-1', displayName: '  Casey  ', avatarUrl: 'avatar.png', shareHandle: 'casey',
    });
    const { result } = renderHook(() => useMyProfilePostOwner(), { wrapper });
    await waitFor(() => expect(result.current?.ownerId).toBe('self-1'));
    expect(findById).toHaveBeenCalledWith('self-1');
    expect(result.current).toEqual({
      ownerId: 'self-1', ownerName: 'Casey', ownerAvatarUrl: 'avatar.png', ownerHandle: 'casey',
    });
  });

  it('uses the translated fallback name for a blank display name', async () => {
    findById.mockResolvedValue({ userId: 'self-1', displayName: ' ', avatarUrl: null, shareHandle: 'casey' });
    const { result } = renderHook(() => useMyProfilePostOwner(), { wrapper });
    await waitFor(() => expect(result.current?.ownerName).toBe('profile.fallbackName'));
    expect(result.current?.ownerAvatarUrl).toBeNull();
  });

  it('returns no owner when the user lookup fails', async () => {
    findById.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useMyProfilePostOwner(), { wrapper });
    await waitFor(() => expect(findById).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });
});
