// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { runAfterInteractions, cancel } = vi.hoisted(() => ({
  runAfterInteractions: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('react-native', () => ({
  InteractionManager: { runAfterInteractions },
}));

import { LIST_END_THRESHOLD, usePrefetchNextPage } from '../usePrefetchNextPage';

type GuardCase = [string, {
  enabled?: boolean;
  data?: { pages: readonly unknown[] };
  hasNextPage?: boolean;
  isFetching?: boolean;
}];

afterEach(() => vi.clearAllMocks());

describe('usePrefetchNextPage', () => {
  it('schedules one next page after interactions and cancels on cleanup', () => {
    let callback: (() => void) | undefined;
    runAfterInteractions.mockImplementation((fn: () => void) => {
      callback = fn;
      return { cancel };
    });
    const fetchNextPage = vi.fn();
    const { unmount } = renderHook(() => usePrefetchNextPage({
      data: { pages: [{}] }, hasNextPage: true, isFetchingNextPage: false,
      isFetching: false, fetchNextPage,
    }));
    expect(runAfterInteractions).toHaveBeenCalledTimes(1);
    expect(fetchNextPage).not.toHaveBeenCalled();
    callback?.();
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(LIST_END_THRESHOLD).toBe(1.5);
  });

  it.each<GuardCase>([
    ['disabled', { enabled: false }],
    ['empty pages', { data: { pages: [] } }],
    ['at the eager page limit', { data: { pages: [{}, {}] } }],
    ['without another page', { hasNextPage: false }],
    ['while fetching', { isFetching: true }],
  ])('does not schedule when %s', (_label, overrides) => {
    const query = {
      data: { pages: [{}] }, hasNextPage: true, isFetchingNextPage: false,
      isFetching: false, fetchNextPage: vi.fn(),
    };
    const enabled = 'enabled' in overrides ? overrides.enabled : true;
    const queryOverrides = { ...overrides };
    delete queryOverrides.enabled;
    renderHook(() => usePrefetchNextPage({ ...query, ...queryOverrides }, enabled));
    expect(runAfterInteractions).not.toHaveBeenCalled();
  });
});
