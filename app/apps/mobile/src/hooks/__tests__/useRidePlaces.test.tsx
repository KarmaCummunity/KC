// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listRidePlaces } = vi.hoisted(() => ({ listRidePlaces: vi.fn() }));
vi.mock('../../services/ridePlaceComposition', () => ({ listRidePlaces, RIDE_PLACES_QUERY_KEY: ['ride-places'] }));
import { useRidePlaces } from '../useRidePlaces';

let client: QueryClient;
function renderPlaces() {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useRidePlaces(), { wrapper });
}
beforeEach(() => { vi.clearAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { client.clear(); });

describe('useRidePlaces', () => {
  it('loads the catalog and reuses it while fresh', async () => {
    const places = [{ id: 'city-1' }];
    listRidePlaces.mockResolvedValue(places);
    const { result, unmount } = renderPlaces();
    await waitFor(() => expect(result.current.data).toEqual(places));
    expect(client.getQueryState(['ride-places'])?.isInvalidated).toBe(false);
    unmount();
    renderPlaces();
    expect(listRidePlaces).toHaveBeenCalledTimes(1);
  });

  it('surfaces catalog failures', async () => {
    listRidePlaces.mockRejectedValue(new Error('offline'));
    const { result } = renderPlaces();
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
