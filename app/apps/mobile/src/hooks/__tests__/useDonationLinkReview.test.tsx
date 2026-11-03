// @vitest-environment jsdom
// useDonationLinkReview (D9): loads the queue for a status only when allowed, and a decision
// resolves true on success (refreshing the queue) and false when the server refuses it.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({ list: vi.fn(), review: vi.fn() }));
vi.mock('../../lib/container', () => ({
  container: { listDonationLinksForReview: { execute: m.list }, reviewDonationLink: { execute: m.review } },
}));

import { useDonationLinkReview } from '../useDonationLinkReview';

const ITEM = { id: 'l_1', displayName: 'NGO', reviewStatus: 'pending' };

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useDonationLinkReview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the pending queue when allowed, and nothing when not', async () => {
    m.list.mockResolvedValue([ITEM]);
    const allowed = renderHook(() => useDonationLinkReview('pending', true), { wrapper });
    await waitFor(() => expect(allowed.result.current.items).toEqual([ITEM]));
    expect(m.list).toHaveBeenCalledWith('pending');

    m.list.mockClear();
    renderHook(() => useDonationLinkReview('pending', false), { wrapper });
    expect(m.list).not.toHaveBeenCalled();
  });

  it('resolves true after a decision and refreshes the queue', async () => {
    m.list.mockResolvedValue([ITEM]);
    m.review.mockResolvedValue('approved');
    const { result } = renderHook(() => useDonationLinkReview('pending', true), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    let ok = false;
    await act(async () => {
      ok = await result.current.decide('l_1', true);
    });
    expect(ok).toBe(true);
    expect(m.review).toHaveBeenCalledWith({ linkId: 'l_1', approve: true, note: undefined });
    await waitFor(() => expect(m.list).toHaveBeenCalledTimes(2));
  });

  it('resolves false when the server refuses the decision', async () => {
    m.list.mockResolvedValue([ITEM]);
    m.review.mockRejectedValue(new Error('donation_link_not_pending'));
    const { result } = renderHook(() => useDonationLinkReview('pending', true), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    let ok = true;
    await act(async () => {
      ok = await result.current.decide('l_1', false, 'dup');
    });
    expect(ok).toBe(false);
    expect(result.current.busyId).toBeNull();
  });
});
