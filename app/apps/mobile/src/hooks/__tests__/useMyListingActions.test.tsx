// @vitest-environment jsdom
// useMyListingActions: a refused owner action is explained with the mapped message (never an
// unhandled rejection), a successful one refreshes the list, and added photos are uploaded and
// appended to the listing (spec 07 §7.1 "Owner management").
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const m = vi.hoisted(() => ({
  repo: {
    pauseMyListing: vi.fn(),
    resumeMyListing: vi.fn(),
    fulfillMyListing: vi.fn(),
    deleteMyListing: vi.fn(),
    addMyListingMedia: vi.fn(),
  },
  alert: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  pick: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, Alert: { alert: m.alert } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../services/marketplaceComposition', () => ({ marketplaceRepository: () => m.repo }));
vi.mock('../../services/listingImageUpload', () => ({ pickListingImages: m.pick, uploadListingImages: m.upload }));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (select: (s: { session: { userId: string } }) => unknown) => select({ session: { userId: 'u1' } }),
}));
vi.mock('../useMyMarketplaceListings', () => ({ useInvalidateMyListings: () => m.invalidate }));
vi.mock('../../store/closureStore', () => ({
  useClosureStore: { getState: () => ({ start: vi.fn() }) },
}));

import type { MyListingRow } from '@kc/domain';
import { useMyListingActions } from '../useMyListingActions';

/** A row of the list; only the fields the actions read matter here. */
function row(over: Partial<MyListingRow> = {}): MyListingRow {
  return {
    listingId: 'l1', worldSlug: 'items', kindSlug: 'give_item', direction: 'give', status: 'open',
    title: 't', summary: null, urgencyLevel: 2, availabilityStatus: 'ongoing', updatedAt: '2026-11-11T00:00:00Z',
    feedPostId: 'p1', ...over,
  };
}

/** Lets the fire-and-forget action promises settle. */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('useMyListingActions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('explains a refused pause with the mapped message and keeps the list as is', async () => {
    m.repo.pauseMyListing.mockRejectedValue({ message: 'listing_has_active_handoff', code: '23514' });
    const refetch = vi.fn(async () => undefined);
    const { result } = renderHook(() => useMyListingActions(refetch));

    act(() => result.current.pause(row()));
    await flush();

    expect(m.alert).toHaveBeenCalledWith('marketplace.myListingsErrorTitle', 'marketplace.myListingsErrorActiveHandoff');
    expect(refetch).not.toHaveBeenCalled();
    expect(result.current.busyId).toBeNull();
  });

  it('refreshes the list after a successful resume', async () => {
    m.repo.resumeMyListing.mockResolvedValue(undefined);
    const refetch = vi.fn(async () => undefined);
    const { result } = renderHook(() => useMyListingActions(refetch));

    act(() => result.current.resume('l1'));
    await flush();

    expect(m.repo.resumeMyListing).toHaveBeenCalledWith('l1');
    expect(m.invalidate).toHaveBeenCalled();
    expect(refetch).toHaveBeenCalled();
    expect(m.alert).not.toHaveBeenCalled();
  });

  it('uploads picked photos and appends them to the listing', async () => {
    m.pick.mockResolvedValue([{ uri: 'file://a.jpg' }]);
    m.upload.mockResolvedValue(['u1/batch/0.jpg']);
    m.repo.addMyListingMedia.mockResolvedValue(1);
    const refetch = vi.fn(async () => undefined);
    const { result } = renderHook(() => useMyListingActions(refetch));

    act(() => result.current.addPhotos('l1'));
    await flush();

    expect(m.upload).toHaveBeenCalledWith('u1', [{ uri: 'file://a.jpg' }]);
    expect(m.repo.addMyListingMedia).toHaveBeenCalledWith('l1', ['u1/batch/0.jpg']);
    expect(m.alert).toHaveBeenCalledWith('marketplace.myListingsAddPhotos', 'marketplace.myListingsPhotosAdded');
    expect(refetch).toHaveBeenCalled();
  });

  it('does nothing when no photo is picked, and explains a full photo set', async () => {
    m.pick.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useMyListingActions(vi.fn(async () => undefined)));
    act(() => result.current.addPhotos('l1'));
    await flush();
    expect(m.upload).not.toHaveBeenCalled();

    m.pick.mockResolvedValueOnce([{ uri: 'file://b.jpg' }]);
    m.upload.mockResolvedValueOnce(['u1/batch/1.jpg']);
    m.repo.addMyListingMedia.mockRejectedValueOnce({ message: 'listing_media_full' });
    act(() => result.current.addPhotos('l1'));
    await flush();
    expect(m.alert).toHaveBeenCalledWith('marketplace.myListingsErrorTitle', 'marketplace.myListingsErrorMediaFull');
  });

  it('asks before pausing a ride, says its passengers are told, and pauses only on yes (FR-RIDE-047)', async () => {
    m.alert.mockImplementation((_t: string, _m: string, buttons?: { onPress?: () => void }[]) => buttons?.[1]?.onPress?.());
    m.repo.pauseMyListing.mockResolvedValue(undefined);
    const { result } = renderHook(() => useMyListingActions(vi.fn(async () => undefined)));

    act(() => result.current.pause(row({ worldSlug: 'rides', kindSlug: 'ride_offer' })));
    await flush();

    expect(m.alert.mock.calls[0]?.[1]).toBe('marketplace.myListingsPauseHoldersHint');
    expect(m.repo.pauseMyListing).toHaveBeenCalledWith('l1');
  });

  it('pauses an item at once, and warns of the holders when deleting a ride', async () => {
    m.repo.pauseMyListing.mockResolvedValue(undefined);
    const { result } = renderHook(() => useMyListingActions(vi.fn(async () => undefined)));

    act(() => result.current.pause(row()));
    await flush();
    expect(m.alert).not.toHaveBeenCalled();
    expect(m.repo.pauseMyListing).toHaveBeenCalledWith('l1');

    act(() => result.current.remove(row({ worldSlug: 'rides', kindSlug: 'ride_offer' })));
    await flush();
    expect(m.alert.mock.calls[0]?.[1]).toBe('marketplace.myListingsDeleteHoldersHint');
  });
});
