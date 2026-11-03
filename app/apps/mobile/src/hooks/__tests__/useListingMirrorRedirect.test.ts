// @vitest-environment jsdom
// D-206 — a feed mirror of a listing redirects the post detail to the listing detail.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('expo-router', () => ({ useRouter: () => ({ replace }) }));

import { useListingMirrorRedirect } from '../useListingMirrorRedirect';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useListingMirrorRedirect', () => {
  it('replaces the route with the listing detail when the post mirrors a listing', () => {
    const { result } = renderHook(() => useListingMirrorRedirect({ listingId: 'l_1' }));

    expect(result.current).toBe(true);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith({
      pathname: '/listing/[listingId]',
      params: { listingId: 'l_1' },
    });
  });

  it('does nothing for a plain post or while the post is still loading', () => {
    const { result, rerender } = renderHook(
      ({ post }: { post: { listingId: string | null } | null }) => useListingMirrorRedirect(post),
      { initialProps: { post: null as { listingId: string | null } | null } },
    );
    expect(result.current).toBe(false);

    rerender({ post: { listingId: null } });
    expect(result.current).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects once per listing, not on every render', () => {
    const { rerender } = renderHook(
      ({ post }: { post: { listingId: string | null } }) => useListingMirrorRedirect(post),
      { initialProps: { post: { listingId: 'l_1' } } },
    );
    rerender({ post: { listingId: 'l_1' } });
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
