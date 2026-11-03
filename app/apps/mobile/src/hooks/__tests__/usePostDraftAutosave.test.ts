// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePostDraftStore } from '../../store/postDraftStore';
import { POST_DRAFT_DEFAULTS, type PostDraftFormState } from '../../lib/postDraftFormState';
import { POST_DRAFT_AUTOSAVE_DEBOUNCE_MS, usePostDraftAutosave } from '../usePostDraftAutosave';

const base = {
  ...POST_DRAFT_DEFAULTS,
  ownerId: 'user-1', isHydrating: false, isResumePending: false, isPostCategory: true,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  usePostDraftStore.getState().clearDraft();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('usePostDraftAutosave', () => {
  it('saves the latest content after the debounce with exact owner and timestamp', () => {
    const input = { ...base, title: 'A table' };
    renderHook(({ value }) => usePostDraftAutosave(value), { initialProps: { value: input } });
    expect(usePostDraftStore.getState().draft).toBeNull();
    act(() => vi.advanceTimersByTime(POST_DRAFT_AUTOSAVE_DEBOUNCE_MS - 1));
    expect(usePostDraftStore.getState().draft).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(usePostDraftStore.getState().draft).toEqual({
      ownerId: 'user-1', updatedAt: Date.now(), ...POST_DRAFT_DEFAULTS, title: 'A table',
    });
  });

  it('does not schedule writes while any guard blocks autosave or content is at defaults', () => {
    const guarded = [
      { ...base, title: 'Content', ownerId: undefined },
      { ...base, title: 'Content', isHydrating: true },
      { ...base, title: 'Content', isResumePending: true },
      { ...base, title: 'Content', isPostCategory: false },
      base,
    ];
    for (const value of guarded) renderHook(() => usePostDraftAutosave(value));
    act(() => vi.runOnlyPendingTimers());
    expect(usePostDraftStore.getState().draft).toBeNull();
  });

  it('debounces changed input and clears its pending timer on unmount', () => {
    const { rerender, unmount } = renderHook(
      ({ value }: { value: typeof base & PostDraftFormState }) => usePostDraftAutosave(value),
      { initialProps: { value: { ...base, title: 'First' } } },
    );
    act(() => vi.advanceTimersByTime(200));
    rerender({ value: { ...base, title: 'Latest' } });
    act(() => vi.advanceTimersByTime(POST_DRAFT_AUTOSAVE_DEBOUNCE_MS - 1));
    expect(usePostDraftStore.getState().draft).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(usePostDraftStore.getState().draft?.title).toBe('Latest');
    usePostDraftStore.getState().clearDraft();
    rerender({ value: { ...base, title: 'Unmounted' } });
    unmount();
    act(() => vi.runOnlyPendingTimers());
    expect(usePostDraftStore.getState().draft).toBeNull();
  });
});
