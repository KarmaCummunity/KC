// @vitest-environment jsdom
// KC#2288 — the street and house number of an event: validation messages, the one-line label,
// hydration from the stored address on an edit, and a save that never fails the publish.
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ save: vi.fn(), getOwn: vi.fn(), report: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../services/listingStreetAddressComposition', () => ({
  listingStreetAddressUseCases: { save: () => ({ execute: mocks.save }), getOwn: () => ({ execute: mocks.getOwn }) },
  listingStreetAddressQueryKey: (id: string) => ['listing-street-address', id],
}));
vi.mock('../../lib/observability/reportHandledError', () => ({ reportHandledError: mocks.report }));

import { useListingStreetAddress } from '../useListingStreetAddress';

function renderAddress(args: { enabled: boolean; editListingId: string | null }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useListingStreetAddress(args), { wrapper });
}

beforeEach(() => {
  mocks.save.mockResolvedValue(undefined);
  mocks.getOwn.mockResolvedValue(null);
});
afterEach(() => vi.clearAllMocks());

describe('useListingStreetAddress', () => {
  it('asks for nothing and stores nothing for a kind without a street address', async () => {
    const { result } = renderAddress({ enabled: false, editListingId: 'L1' });
    expect(result.current.problem()).toBeNull();
    expect(result.current.label).toBeNull();
    await act(() => result.current.save('L1'));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.getOwn).not.toHaveBeenCalled();
  });

  it('names the missing part, then builds the one-line label', () => {
    const { result } = renderAddress({ enabled: true, editListingId: null });
    expect(result.current.problem()).toBe('errors.createPost.missingAddressPairBeforePublish');
    act(() => result.current.setStreet('הרצל'));
    expect(result.current.problem()).toBe('errors.createPost.missingStreetNumberBeforePublish');
    act(() => result.current.setStreetNumber('12'));
    expect(result.current.problem()).toBeNull();
    expect(result.current.label).toBe('הרצל 12');
  });

  it('starts an edit from the stored address', async () => {
    mocks.getOwn.mockResolvedValue({ street: 'הרצל', streetNumber: '7א' });
    const { result } = renderAddress({ enabled: true, editListingId: 'L1' });
    await waitFor(() => expect(result.current.street).toBe('הרצל'));
    expect(result.current.streetNumber).toBe('7א');
    expect(mocks.getOwn).toHaveBeenCalledWith('L1');
  });

  it('clears the street and the number when the city changes', () => {
    const { result } = renderAddress({ enabled: true, editListingId: null });
    act(() => {
      result.current.setStreet('הרצל');
      result.current.setStreetNumber('12');
    });
    act(() => result.current.clear());
    expect(result.current.label).toBe('');
  });

  it('reports a failed save instead of throwing: the listing is already published', async () => {
    mocks.save.mockRejectedValue(new Error('offline'));
    const { result } = renderAddress({ enabled: true, editListingId: null });
    act(() => {
      result.current.setStreet('הרצל');
      result.current.setStreetNumber('12');
    });
    await act(() => result.current.save('L9'));
    expect(mocks.save).toHaveBeenCalledWith('L9', { street: 'הרצל', streetNumber: '12' });
    expect(mocks.report).toHaveBeenCalledTimes(1);
  });
});
