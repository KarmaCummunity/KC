// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

const { session, track } = vi.hoisted(() => ({ session: { current: null as { userId: string } | null }, track: vi.fn() }));
vi.mock('../../store/authStore', () => ({ useAuthStore: (selector: (state: { session: { userId: string } | null }) => unknown) => selector({ session: session.current }) }));
vi.mock('../../lib/analyticsCoreLoop', () => ({ trackReturnVisitIfReturning: track }));
import { useCoreLoopReturnVisit } from '../useCoreLoopReturnVisit';

afterEach(() => { cleanup(); vi.clearAllMocks(); session.current = null; });

describe('useCoreLoopReturnVisit', () => {
  it('does not track for a signed-out user', () => {
    renderHook(() => useCoreLoopReturnVisit());
    expect(track).not.toHaveBeenCalled();
  });

  it('tracks once with empty properties for an authenticated user', async () => {
    session.current = { userId: 'user-1' };
    const { rerender } = renderHook(() => useCoreLoopReturnVisit());
    await waitFor(() => expect(track).toHaveBeenCalledWith({}));
    rerender();
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('tracks again when the authenticated identity changes', async () => {
    session.current = { userId: 'user-1' };
    const { rerender } = renderHook(() => useCoreLoopReturnVisit());
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1));
    session.current = { userId: 'user-2' };
    rerender();
    await waitFor(() => expect(track).toHaveBeenCalledTimes(2));
    expect(track).toHaveBeenLastCalledWith({});
  });
});
