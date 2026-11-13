// @vitest-environment jsdom
// G1 step 4a (ADR-006) — a listing route forwards to its post's detail, the one detail screen.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  canGoBack: vi.fn(() => true),
}));

vi.mock('expo-router', () => ({ useRouter: () => nav }));

import { useListingPostRedirect } from '../useListingPostRedirect';

const POST = { pathname: '/post/[id]', params: { id: 'p_1' } };

beforeEach(() => {
  vi.clearAllMocks();
  nav.canGoBack.mockReturnValue(true);
});

describe('useListingPostRedirect', () => {
  // Maestro flow 17: a `replace` to the root-level post route replaced the whole tab host, so Back
  // from a ride's detail left the app. The hop is popped and the post pushed, so Back returns.
  it('pops the listing route and pushes the post when there is history to return to', () => {
    const { result } = renderHook(() => useListingPostRedirect({ feedPostId: 'p_1' }));

    expect(result.current).toBe(true);
    expect(nav.back).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith(POST);
    expect(nav.back.mock.invocationCallOrder[0]).toBeLessThan(nav.push.mock.invocationCallOrder[0]);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('replaces the listing route with the post when it was opened with no history (deep link)', () => {
    nav.canGoBack.mockReturnValue(false);
    renderHook(() => useListingPostRedirect({ feedPostId: 'p_1' }));

    expect(nav.replace).toHaveBeenCalledWith(POST);
    expect(nav.back).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('stays on the listing detail while loading or when the listing has no post', () => {
    const { result, rerender } = renderHook(
      ({ detail }: { detail: { feedPostId: string | null } | null }) => useListingPostRedirect(detail),
      { initialProps: { detail: null as { feedPostId: string | null } | null } },
    );
    expect(result.current).toBe(false);

    rerender({ detail: { feedPostId: null } });
    expect(result.current).toBe(false);
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('forwards once per post, not on every render', () => {
    const { rerender } = renderHook(
      ({ detail }: { detail: { feedPostId: string | null } }) => useListingPostRedirect(detail),
      { initialProps: { detail: { feedPostId: 'p_1' } } },
    );
    rerender({ detail: { feedPostId: 'p_1' } });
    expect(nav.push).toHaveBeenCalledTimes(1);
  });
});
