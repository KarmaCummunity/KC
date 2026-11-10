// @vitest-environment jsdom
// G1 step 4a (ADR-006) — a listing route forwards to its post's detail, the one detail screen.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('expo-router', () => ({ useRouter: () => ({ replace }) }));

import { useListingPostRedirect } from '../useListingPostRedirect';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useListingPostRedirect', () => {
  it('replaces the listing route with the post detail when the listing has a post', () => {
    const { result } = renderHook(() => useListingPostRedirect({ feedPostId: 'p_1' }));

    expect(result.current).toBe(true);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith({ pathname: '/post/[id]', params: { id: 'p_1' } });
  });

  it('stays on the listing detail while loading or when the listing has no post', () => {
    const { result, rerender } = renderHook(
      ({ detail }: { detail: { feedPostId: string | null } | null }) => useListingPostRedirect(detail),
      { initialProps: { detail: null as { feedPostId: string | null } | null } },
    );
    expect(result.current).toBe(false);

    rerender({ detail: { feedPostId: null } });
    expect(result.current).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('forwards once per post, not on every render', () => {
    const { rerender } = renderHook(
      ({ detail }: { detail: { feedPostId: string | null } }) => useListingPostRedirect(detail),
      { initialProps: { detail: { feedPostId: 'p_1' } } },
    );
    rerender({ detail: { feedPostId: 'p_1' } });
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
