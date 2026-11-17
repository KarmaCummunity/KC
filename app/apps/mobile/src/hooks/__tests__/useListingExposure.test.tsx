// @vitest-environment jsdom
// FR-POST-003 / FR-POST-009 / FR-POST-021 — the listing form's exposure settings: defaults, the
// source listing, a public profile that cannot be followers-only, waiting for the stored mask, and
// when the identity row is written (the same rule as the items form).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';
import type { MarketplaceListingDetail } from '@kc/domain';

const doubles = vi.hoisted(() => ({
  privacy: { current: 'Private' as 'Private' | 'Public' },
  identities: vi.fn(async (_postId?: string) => [] as unknown[]),
  upsert: vi.fn(async () => undefined),
}));
vi.mock('../../services/postsComposition', () => ({
  getPostRepo: () => ({ listPostActorIdentities: doubles.identities, upsertPostActorIdentity: doubles.upsert }),
  getListPostActorIdentityUseCase: () => ({ execute: ({ postId }: { postId: string }) => doubles.identities(postId) }),
  getUpsertPostActorIdentityUseCase: () => ({ execute: doubles.upsert }),
}));
vi.mock('../../services/userComposition', () => ({
  getUserRepo: () => ({ findById: async () => ({ privacyMode: doubles.privacy.current }) }),
}));

import { useListingExposure } from '../useListingExposure';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);
const detail = (extra: Partial<MarketplaceListingDetail> = {}) => ({ listingId: 'p1', ...extra }) as MarketplaceListingDetail;
const blank = { sourceListingId: null, sourceDetail: undefined, editListingId: null, userId: 'u1' } as const;
const editing = (extra: Partial<MarketplaceListingDetail> = {}) =>
  ({ sourceListingId: 'p1', sourceDetail: detail(extra), editListingId: 'p1', userId: 'u1' }) as const;

beforeEach(() => {
  doubles.privacy.current = 'Private';
});
afterEach(() => vi.clearAllMocks());

describe('useListingExposure', () => {
  it('starts public, showing city and street, unmasked', () => {
    const { result } = renderHook(() => useListingExposure(blank), { wrapper });
    expect(result.current).toMatchObject({ visibility: 'Public', locationDisplayLevel: 'CityAndStreet', hideFromCounterparty: false });
  });

  it('starts from the source listing and its identity mask', async () => {
    doubles.identities.mockResolvedValueOnce([{ userId: 'u1', hideFromCounterparty: true }]);
    const { result } = renderHook(
      () => useListingExposure({ sourceListingId: 'p1', sourceDetail: detail({ visibility: 'FollowersOnly', locationDisplayLevel: 'CityOnly' }), editListingId: 'p1', userId: 'u1' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hideFromCounterparty).toBe(true));
    expect(result.current).toMatchObject({ visibility: 'FollowersOnly', locationDisplayLevel: 'CityOnly' });
  });

  it('turns followers-only back to public while the profile is public', async () => {
    doubles.privacy.current = 'Public';
    const { result } = renderHook(() => useListingExposure(blank), { wrapper });
    act(() => result.current.setVisibility('FollowersOnly'));
    await waitFor(() => expect(result.current.visibility).toBe('Public'));
  });

  it('an edit keeps a stored followers-only audience after the profile turned public (FR-POST-009 AC4)', async () => {
    doubles.privacy.current = 'Public';
    const { result } = renderHook(() => useListingExposure(editing({ visibility: 'FollowersOnly' })), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visibility).toBe('FollowersOnly');
  });

  it('an edit is loading until the stored mask arrives, so an early save cannot overwrite it', async () => {
    let arrive: (rows: unknown[]) => void = () => {};
    doubles.identities.mockReturnValueOnce(new Promise((resolve) => { arrive = resolve; }));
    const { result } = renderHook(() => useListingExposure(editing()), { wrapper });
    expect(result.current.loading).toBe(true);
    await act(async () => arrive([{ userId: 'u1', hideFromCounterparty: true }]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hideFromCounterparty).toBe(true);
  });

  it('a mask the member already changed is not overwritten by the stored one arriving late', async () => {
    let arrive: (rows: unknown[]) => void = () => {};
    doubles.identities.mockReturnValueOnce(new Promise((resolve) => { arrive = resolve; }));
    const { result } = renderHook(() => useListingExposure(editing()), { wrapper });
    act(() => result.current.setHideFromCounterparty(true));
    await act(async () => arrive([{ userId: 'u1', hideFromCounterparty: false }]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hideFromCounterparty).toBe(true);
  });

  it('a new listing writes the mask row only when it is masked; "only me" always masks', async () => {
    const { result } = renderHook(() => useListingExposure(blank), { wrapper });
    await act(() => result.current.saveIdentity('new-1'));
    expect(doubles.upsert).not.toHaveBeenCalled();

    act(() => result.current.setVisibility('OnlyMe'));
    await act(() => result.current.saveIdentity('new-1'));
    expect(doubles.upsert).toHaveBeenLastCalledWith({ postId: 'new-1', userId: 'u1', surfaceVisibility: 'OnlyMe', hideFromCounterparty: true });
  });

  it('an edit rewrites an existing mask row so it follows the new audience, even when unmasking', async () => {
    doubles.identities.mockResolvedValue([{ userId: 'u1', hideFromCounterparty: true }]);
    const { result } = renderHook(() => useListingExposure(editing({ visibility: 'OnlyMe' })), { wrapper });
    await waitFor(() => expect(result.current.hideFromCounterparty).toBe(true));
    act(() => {
      result.current.setVisibility('Public');
      result.current.setHideFromCounterparty(false);
    });
    await act(() => result.current.saveIdentity('p1'));
    expect(doubles.upsert).toHaveBeenCalledWith({ postId: 'p1', userId: 'u1', surfaceVisibility: 'Public', hideFromCounterparty: false });
  });
});
