// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ListingKindOption } from '@kc/domain';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { repo, auth, upload, track, activation, remember } = vi.hoisted(() => ({
  repo: { listKindsForWorld: vi.fn(), createListing: vi.fn() },
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
    expect(result.current.error).toBe('post.unifiedCreate.errors.titleRequired');
    result.current.setDetail('title', 'unused');
    const validTitle = renderHook(() => useListingCreateForm({ worldSlug: 'food', direction: 'give', title: 'Bread', summary: '', onPublished: vi.fn() }), { wrapper });
    await waitFor(() => expect(validTitle.result.current.kind).toBeTruthy());
    await act(() => validTitle.result.current.publish());
    expect(validTitle.result.current.error).toContain('fieldRequired');
    act(() => { validTitle.result.current.setDetail('food_type', 'fresh'); validTitle.result.current.setDetail('expires_at', '2030-01-01'); });
    await act(() => validTitle.result.current.publish());
    expect(validTitle.result.current.error).toBe('post.unifiedCreate.errors.cityRequired');
    expect(repo.createListing).not.toHaveBeenCalled();
  });
  it('publishes valid details and maps repository errors while releasing busy lock', async () => {
    const onPublished = vi.fn();
    const { result } = renderHook(() => useListingCreateForm({ worldSlug: 'food', direction: 'give', title: ' Bread ', summary: ' fresh ', onPublished }), { wrapper });
    await waitFor(() => expect(result.current.kind).toBeTruthy());
    act(() => { result.current.setDetail('food_type', 'fresh'); result.current.setDetail('expires_at', '2030-01-01'); result.current.setCity({ id: 'city-1', name: 'Town' }); });
    await act(() => result.current.publish());
    expect(repo.createListing).toHaveBeenCalledWith({ kindId: 'k1', title: 'Bread', summary: 'fresh', details: { food_type: 'fresh', expires_at: '2030-01-01' }, direction: null, cityId: 'city-1', lat: null, lng: null, maxRadiusKm: 25, mediaPaths: [], externalBodyId: null, categoryId: null });
    expect(onPublished).toHaveBeenCalledWith('l1');
    expect(track).toHaveBeenCalledWith('listing_created', { world: 'food', cityId: 'city-1' });
    expect(activation).toHaveBeenCalledWith({ world: 'food', cityId: 'city-1', accountCreatedAt: 'today' });
    repo.createListing.mockRejectedValueOnce(new Error('offline'));
    await act(() => result.current.publish());
    expect(result.current.error).toBe('marketplace.errors.generic');
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
