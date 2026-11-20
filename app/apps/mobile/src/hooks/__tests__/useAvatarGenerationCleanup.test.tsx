// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const { lifecycle } = vi.hoisted(() => ({
  lifecycle: { retirePreviousAvatar: vi.fn(async () => 'delete_queued'), discardUnsavedAvatar: vi.fn(async () => 'delete_queued') },
}));
vi.mock('../../services/avatarLifecycle', () => lifecycle);
vi.mock('../../services/userComposition', () => ({ getUserRepo: () => ({ findById: async () => ({ avatarUrl: 'saved' }) }) }));

import { useAvatarGenerationCleanup } from '../useAvatarGenerationCleanup';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const uploaded = (calls: unknown[][]) => calls.map((c) => (c[0] as { uploadedUrl: string }).uploadedUrl);

describe('useAvatarGenerationCleanup', () => {
  it('discards an unsaved upload when another photo is picked or the photo is removed', () => {
    const { result } = renderHook(() => useAvatarGenerationCleanup('u1', 'initial'));
    act(() => result.current.trackPicked('gen-1'));
    act(() => result.current.trackPicked('gen-2'));
    act(() => result.current.trackPicked(null));
    expect(uploaded(lifecycle.discardUnsavedAvatar.mock.calls)).toEqual(['gen-1', 'gen-2']);
  });

  it('discards the unsaved upload when the screen closes without saving', () => {
    const { result, unmount } = renderHook(() => useAvatarGenerationCleanup('u1', 'initial'));
    act(() => result.current.trackPicked('gen-1'));
    unmount();
    expect(uploaded(lifecycle.discardUnsavedAvatar.mock.calls)).toEqual(['gen-1']);
  });

  it('after a save, retires the previous generation and keeps the saved one', () => {
    const { result, unmount } = renderHook(() => useAvatarGenerationCleanup('u1', 'initial'));
    act(() => result.current.trackPicked('gen-1'));
    act(() => result.current.committed('gen-1'));
    unmount();
    expect(lifecycle.discardUnsavedAvatar).not.toHaveBeenCalled();
    expect(lifecycle.retirePreviousAvatar).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', previousUrl: 'initial', committedUrl: 'gen-1' }));
  });

  it('never touches the initial avatar when it is merely re-selected or nothing changed', () => {
    const { result, unmount } = renderHook(() => useAvatarGenerationCleanup('u1', 'initial'));
    act(() => result.current.trackPicked('initial'));
    act(() => result.current.committed('initial'));
    unmount();
    expect(lifecycle.discardUnsavedAvatar).not.toHaveBeenCalled();
    expect(lifecycle.retirePreviousAvatar).not.toHaveBeenCalled();
  });

  it('a pick that arrives after the screen closed is discarded at once (late upload result)', () => {
    const { result, unmount } = renderHook(() => useAvatarGenerationCleanup('u1', 'initial'));
    const late = result.current;
    unmount();
    act(() => late.trackPicked('gen-late'));
    expect(uploaded(lifecycle.discardUnsavedAvatar.mock.calls)).toEqual(['gen-late']);
  });
});
