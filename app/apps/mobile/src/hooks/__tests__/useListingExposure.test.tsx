// @vitest-environment jsdom
// FR-POST-003 / FR-POST-009 / FR-POST-021 — the listing form's exposure settings: defaults, the
// source listing, a public profile that cannot be followers-only, and when the identity row is written.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';
import type { MarketplaceListingDetail } from '@kc/domain';

const doubles = vi.hoisted(() => ({
  privacy: { current: 'Private' as 'Private' | 'Public' },
  identities: vi.fn(async () => [] as unknown[]),
  upsert: vi.fn(async () => undefined),
}));
vi.mock('../../services/postsComposition', () => ({
  getPostRepo: () => ({ listPostActorIdentities: doubles.identities, upsertPostActorIdentity: doubles.upsert }),
}));
vi.mock('../../services/userComposition', () => ({
  getUserRepo: () => ({ findById: async () => ({ privacyMode: doubles.privacy.current }) }),
}));

import { identityToSave, useListingExposure } from '../useListingExposure';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);
const detail = (extra: Partial<MarketplaceListingDetail> = {}) => ({ listingId: 'p1', ...extra }) as MarketplaceListingDetail;

beforeEach(() => {
  doubles.privacy.current = 'Private';
});
afterEach(() => vi.clearAllMocks());

describe('identityToSave', () => {
  it('writes nothing for a new, public, unmasked post', () => {
    expect(identityToSave({ visibility: 'Public', hideFromCounterparty: false }, false)).toBeNull();
  });
  it('writes a new post that is limited or masked', () => {
    expect(identityToSave({ visibility: 'FollowersOnly', hideFromCounterparty: false }, false)).toEqual({ surfaceVisibility: 'FollowersOnly', hideFromCounterparty: false });
    expect(identityToSave({ visibility: 'Public', hideFromCounterparty: true }, false)).toEqual({ surfaceVisibility: 'Public', hideFromCounterparty: true });
  });
  it('always writes on an edit, so moving back to public and unmasked sticks', () => {
    expect(identityToSave({ visibility: 'Public', hideFromCounterparty: false }, true)).toEqual({ surfaceVisibility: 'Public', hideFromCounterparty: false });
  });
});

describe('useListingExposure', () => {
  it('starts public, showing city and street, unmasked', () => {
    const { result } = renderHook(() => useListingExposure({ sourceListingId: null, sourceDetail: undefined, editListingId: null, userId: 'u1' }), { wrapper });
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
    const { result } = renderHook(() => useListingExposure({ sourceListingId: null, sourceDetail: undefined, editListingId: null, userId: 'u1' }), { wrapper });
    act(() => result.current.setVisibility('FollowersOnly'));
    await waitFor(() => expect(result.current.visibility).toBe('Public'));
  });

  it('saves the identity row only when it differs from a fresh post', async () => {
    const { result } = renderHook(() => useListingExposure({ sourceListingId: null, sourceDetail: undefined, editListingId: null, userId: 'u1' }), { wrapper });
    await act(() => result.current.saveIdentity('new-1'));
    expect(doubles.upsert).not.toHaveBeenCalled();
    act(() => result.current.setHideFromCounterparty(true));
    await act(() => result.current.saveIdentity('new-1'));
    expect(doubles.upsert).toHaveBeenCalledWith({ postId: 'new-1', userId: 'u1', surfaceVisibility: 'Public', hideFromCounterparty: true });
  });
});
