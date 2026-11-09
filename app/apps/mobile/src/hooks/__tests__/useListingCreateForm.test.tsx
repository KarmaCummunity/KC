// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ListingKindOption } from '@kc/domain';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { repo, auth, upload, track, activation, remember } = vi.hoisted(() => ({
  repo: { listKindsForWorld: vi.fn(), createListing: vi.fn(), getListingDetail: vi.fn(), updateMyListing: vi.fn() },
  auth: { current: 'u1' as string | null }, upload: vi.fn(), track: vi.fn(), activation: vi.fn(), remember: vi.fn(),
}));
vi.hoisted(() => { (globalThis as { __DEV__?: boolean }).__DEV__ = false; });
vi.mock('../../components/giving/RideCreateSection', () => ({ RIDE_CREATE_DETAIL_KEYS: [] }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../store/authStore', () => ({ useAuthStore: Object.assign((selector: (s: { session: { userId: string } | null }) => unknown) => selector({ session: auth.current ? { userId: auth.current } : null }), { getState: () => ({ session: { accountCreatedAt: 'today' } }) }) }));
vi.mock('../../services/marketplaceComposition', () => ({ marketplaceRepository: () => repo }));
vi.mock('../../services/listingImageUpload', () => ({ uploadListingImages: upload }));
vi.mock('../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: track, trackActivationIfFirst: activation }));
vi.mock('../../lib/rides/rideStartDetails', () => ({ rememberRideRoute: remember }));
vi.mock('../../services/rideSeriesComposition', () => ({ rideSeriesUseCases: { create: () => ({ execute: vi.fn() }) } }));
import { useListingCreateForm } from '../useListingCreateForm';
function wrapper({ children }: PropsWithChildren) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
const kind = { kindId: 'k1', slug: 'give_food', direction: 'give', detailSchema: { properties: { food_type: {}, expires_at: {} } } } as unknown as ListingKindOption;
describe('useListingCreateForm', () => {
  beforeEach(() => { vi.clearAllMocks(); auth.current = 'u1'; repo.listKindsForWorld.mockResolvedValue([kind]); repo.createListing.mockResolvedValue('l1'); });
  it('reports title, required field, and city guards without publishing', async () => {
    const { result } = renderHook(() => useListingCreateForm({ worldSlug: 'food', direction: 'give', title: ' ', summary: '', onPublished: vi.fn() }), { wrapper });
    await waitFor(() => expect(result.current.kind?.kindId).toBe('k1'));
    await act(() => result.current.publish());
    expect(result.current.error).toEqual({ message: 'post.unifiedCreate.errors.titleRequired', field: 'title' });
    result.current.setDetail('title', 'unused');
    const validTitle = renderHook(() => useListingCreateForm({ worldSlug: 'food', direction: 'give', title: 'Bread', summary: '', onPublished: vi.fn() }), { wrapper });
    await waitFor(() => expect(validTitle.result.current.kind).toBeTruthy());
    await act(() => validTitle.result.current.publish());
    expect(validTitle.result.current.error?.message).toContain('fieldRequired');
    expect(validTitle.result.current.error?.field).toMatch(/^detail:/);
    act(() => { validTitle.result.current.setDetail('food_type', 'fresh'); validTitle.result.current.setDetail('expires_at', '2030-01-01'); });
    // Editing the form clears the previous problem.
    expect(validTitle.result.current.error).toBeNull();
    await act(() => validTitle.result.current.publish());
    await waitFor(() =>
      expect(validTitle.result.current.error).toEqual({
        message: 'post.unifiedCreate.errors.cityRequired',
        field: 'city',
      }),
    );
    expect(repo.createListing).not.toHaveBeenCalled();
  });
  it('publishes valid details and maps repository errors while releasing busy lock', async () => {
    const onPublished = vi.fn();
    const { result } = renderHook(() => useListingCreateForm({ worldSlug: 'food', direction: 'give', title: ' Bread ', summary: ' fresh ', onPublished }), { wrapper });
    await waitFor(() => expect(result.current.kind).toBeTruthy());
    act(() => { result.current.setDetail('expires_at', '2030-01-01'); result.current.setCity({ id: 'city-1', name: 'Town' }); });
    // A food offer names its type with the world sub-category ({{D:food-type-is-subcategory}}, KC#1398).
    await act(() => result.current.publish());
    expect(result.current.error).toEqual({ message: 'marketplace.errors.food_subcategory_required', field: 'subcategory' });
    act(() => { result.current.setSubcategoryId('cat-cooked'); });
    // A food offer without a photo is refused at the photo picker (D132, KC#1937).
    await act(() => result.current.publish());
    expect(result.current.error).toEqual({ message: 'marketplace.errors.offer_photo_required', field: 'photos' });
    expect(repo.createListing).not.toHaveBeenCalled();
    upload.mockResolvedValue(['u1/bread.jpg']);
    act(() => { result.current.setPhotos([{ uri: 'file://bread.jpg' } as never]); });
    await act(() => result.current.publish());
    expect(upload).toHaveBeenCalledWith('u1', [{ uri: 'file://bread.jpg' }]);
    expect(repo.createListing).toHaveBeenCalledWith({ kindId: 'k1', title: 'Bread', summary: 'fresh', details: { expires_at: '2030-01-01' }, direction: null, cityId: 'city-1', lat: null, lng: null, maxRadiusKm: 25, mediaPaths: ['u1/bread.jpg'], externalBodyId: null, categoryId: 'cat-cooked' });
    expect(onPublished).toHaveBeenCalledWith('l1');
    expect(track).toHaveBeenCalledWith('listing_created', { world: 'food', cityId: 'city-1' });
    expect(activation).toHaveBeenCalledWith({ world: 'food', cityId: 'city-1', accountCreatedAt: 'today' });
    repo.createListing.mockRejectedValueOnce(new Error('offline'));
    await act(() => result.current.publish());
    expect(result.current.error).toEqual({ message: 'marketplace.errors.generic', field: null });
    expect(result.current.busy).toBe(false);
  });
  it('does not publish while signed out', async () => {
    auth.current = null;
    const { result } = renderHook(() => useListingCreateForm({ worldSlug: 'food', direction: 'give', title: 'Bread', summary: '', onPublished: vi.fn() }), { wrapper });
    await waitFor(() => expect(result.current.kindsQuery.isSuccess).toBe(true));
    expect(result.current.canPublish).toBe(false);
    await act(() => result.current.publish());
    expect(repo.createListing).not.toHaveBeenCalled();
  });
});

describe('republish an expired listing (D127)', () => {
  const source = {
    listingId: 'old-1', ownerId: 'u1', worldSlug: 'food', kindSlug: 'give_food', direction: 'give', cityId: 'city-1',
    details: { food_type: 'cooked', expires_at: '2026-11-01T10:00:00Z' },
    media: [{ storagePath: 'u1/b/1.jpg', sortOrder: 1 }, { storagePath: 'u1/b/0.jpg', sortOrder: 0 }],
  };
  beforeEach(() => {
    vi.clearAllMocks();
    auth.current = 'u1';
    repo.listKindsForWorld.mockResolvedValue([kind]);
    repo.createListing.mockResolvedValue('new-1');
    repo.getListingDetail.mockResolvedValue(source);
  });

  it('starts from the source minus its dates and publishes a NEW listing with its photos', async () => {
    const onPublished = vi.fn();
    const { result } = renderHook(() => useListingCreateForm({ worldSlug: 'food', direction: 'give', title: 'Soup', summary: '', onPublished, republishFromListingId: 'old-1' }), { wrapper });
    await waitFor(() => expect(result.current.details).toEqual({ food_type: 'cooked' }));
    expect(result.current.city?.id).toBe('city-1');
    expect(result.current.carriedMediaPaths).toEqual(['u1/b/0.jpg', 'u1/b/1.jpg']);
    act(() => result.current.setDetail('expires_at', '2099-11-20T10:00:00Z'));
    // The source's sub-category is not carried (the detail does not expose it), so the member picks it again.
    await act(() => result.current.publish());
    expect(result.current.error).toEqual({ message: 'marketplace.errors.food_subcategory_required', field: 'subcategory' });
    act(() => result.current.setSubcategoryId('cat-cooked'));
    await act(() => result.current.publish());
    expect(repo.updateMyListing).not.toHaveBeenCalled();
    const payload = repo.createListing.mock.calls[0]![0];
    expect(payload.details).toEqual({ food_type: 'cooked', expires_at: '2099-11-20T10:00:00Z' });
    expect(payload.mediaPaths).toEqual(['u1/b/0.jpg', 'u1/b/1.jpg']);
    expect(onPublished).toHaveBeenCalledWith('new-1');
  });

  it('refuses a republished offer once every carried photo is removed (D132)', async () => {
    const { result } = renderHook(() => useListingCreateForm({ worldSlug: 'food', direction: 'give', title: 'Soup', summary: '', onPublished: vi.fn(), republishFromListingId: 'old-1' }), { wrapper });
    await waitFor(() => expect(result.current.carriedMediaPaths).toHaveLength(2));
    act(() => { result.current.setDetail('expires_at', '2099-11-20T10:00:00Z'); result.current.setSubcategoryId('cat-cooked'); result.current.removeCarriedMedia('u1/b/0.jpg'); result.current.removeCarriedMedia('u1/b/1.jpg'); });
    await act(() => result.current.publish());
    expect(result.current.error).toEqual({ message: 'marketplace.errors.offer_photo_required', field: 'photos' });
    expect(repo.createListing).not.toHaveBeenCalled();
  });

  it('keeps edit mode on the source with its dates and saves through updateMyListing', async () => {
    const onSaved = vi.fn();
    // An open listing being edited: its expiry is still ahead.
    const open = { ...source, details: { food_type: 'cooked', expires_at: '2099-01-01T10:00:00Z' } };
    repo.getListingDetail.mockResolvedValue(open);
    const { result } = renderHook(() => useListingCreateForm({ worldSlug: 'food', direction: 'give', title: 'Soup', summary: '', onPublished: vi.fn(), editListingId: 'old-1', onSaved }), { wrapper });
    await waitFor(() => expect(result.current.details).toEqual(open.details));
    expect(result.current.carriedMediaPaths).toEqual([]);
    await act(() => result.current.publish());
    expect(repo.createListing).not.toHaveBeenCalled();
    expect(repo.updateMyListing).toHaveBeenCalledWith('old-1', expect.objectContaining({ details: open.details }));
    expect(onSaved).toHaveBeenCalled();
  });
});

describe('rideAutoTitle (#1411)', () => {
  const fmt = (o: string, d: string) => `${o} → ${d}`;
  it('builds the title from the route labels', async () => {
    const { rideAutoTitle } = await import('../useListingCreateForm');
    expect(rideAutoTitle({ origin_label: ' Lod ', dest_label: 'Tel Aviv' }, fmt)).toBe('Lod → Tel Aviv');
  });
  it('is empty until both ends are chosen', async () => {
    const { rideAutoTitle } = await import('../useListingCreateForm');
    expect(rideAutoTitle({ origin_label: 'Lod' }, fmt)).toBe('');
    expect(rideAutoTitle({}, fmt)).toBe('');
  });
});

describe('leave now for rides (#1411)', () => {
  const rideKind = { kindId: 'k-ride', slug: 'give_ride', direction: 'give', detailSchema: { properties: {} } } as unknown as ListingKindOption;
  const route = { origin_lat: 32.08, origin_lng: 34.78, dest_lat: 31.77, dest_lng: 35.21, origin_label: 'Tel Aviv', dest_label: 'Jerusalem' };

  beforeEach(() => {
    vi.clearAllMocks();
    auth.current = 'u1';
    repo.listKindsForWorld.mockResolvedValue([rideKind]);
    repo.createListing.mockResolvedValue('ride-1');
  });
  afterEach(() => vi.useRealTimers());

  it('publishes the departure at the moment of publishing plus the lead, not the time the switch was turned on', async () => {
    const { result } = renderHook(() => useListingCreateForm({ worldSlug: 'rides', direction: 'give', title: '', summary: '', onPublished: vi.fn() }), { wrapper });
    await waitFor(() => expect(result.current.kind?.kindId).toBe('k-ride'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T20:00:00Z'));
    // The switch was turned on at 20:00 (departure 20:05); the member publishes ten minutes later.
    act(() => {
      result.current.setDetails({ ...route, departs_at: '2026-11-04T20:05:00.000Z', arrives_at: '2026-11-04T21:15:00.000Z', seats_available: 3 });
      result.current.setLeaveNow(true);
    });
    vi.setSystemTime(new Date('2026-11-04T20:10:00Z'));

    await act(() => result.current.publish());

    expect(result.current.error).toBeNull();
    const sent = repo.createListing.mock.calls[0]![0].details;
    expect(sent.departs_at).toBe('2026-11-04T20:15:00.000Z');
    expect(sent.arrives_at).toBe('2026-11-04T21:25:00.000Z');
  });

  it('keeps the departure the member picked when leave now is off', async () => {
    const { result } = renderHook(() => useListingCreateForm({ worldSlug: 'rides', direction: 'give', title: '', summary: '', onPublished: vi.fn() }), { wrapper });
    await waitFor(() => expect(result.current.kind?.kindId).toBe('k-ride'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T20:00:00Z'));
    act(() => result.current.setDetails({ ...route, departs_at: '2026-11-05T07:00:00.000Z', seats_available: 3 }));

    await act(() => result.current.publish());

    expect(repo.createListing.mock.calls[0]![0].details.departs_at).toBe('2026-11-05T07:00:00.000Z');
  });
});
