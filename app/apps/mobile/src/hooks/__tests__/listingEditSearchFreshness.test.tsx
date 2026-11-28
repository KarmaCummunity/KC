// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
const { execute, back } = vi.hoisted(() => ({ execute: vi.fn(), back: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => ({ back }) }));
vi.mock('../../services/searchComposition', () => ({ getUniversalSearchUseCase: () => ({ execute }) }));
vi.mock('../useListingExposure', () => ({ postActorIdentityQueryKey: (id: string) => ['post-actor-identity', id] }));
import { useListingEditSaved } from '../useListingEditSaved';
import { useUniversalSearch } from '../useUniversalSearch';
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('refetches the still-mounted fresh search before returning from a listing-world edit', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ['universalSearch', 'alpha', {}, null];
  const before = { posts: [{ title: 'alpha' }], users: [], links: [], orgs: [], hashtags: [] };
  const after = { ...before, posts: [] };
  client.setQueryData(key, before);
  execute.mockResolvedValue(after);
  back.mockImplementation(() => expect(client.getQueryData(key)).toEqual(after));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const search = renderHook(() => useUniversalSearch({ debouncedQuery: 'alpha', filters: {}, viewerId: 'u1', expandedSection: null, previewLimit: 5, fullLimit: 30, enabled: true }), { wrapper });
  const saved = renderHook(() => useListingEditSaved('p1', 'p1'), { wrapper });
  expect(search.result.current.results).toEqual(before);
  expect(execute).not.toHaveBeenCalled(); // The primed search is fresh, not a remount refetch.
  await act(async () => { await saved.result.current(); });
  expect(execute).toHaveBeenCalledOnce();
  await waitFor(() => expect(search.result.current.results).toEqual(after));
  expect(back).toHaveBeenCalledOnce();
  client.clear();
});

it('marks inactive cached search variants stale and preserves all existing detail/list invalidations', async () => {
  const client = new QueryClient();
  const keys = [['post', 'p1'], ['feed'], ['my-posts'], ['my-hidden-open-posts'], ['profile-tab-open-count'], ['marketplace', 'detail', 'p1'], ['post-actor-identity', 'p1'], ['universalSearch', 'alpha', {}, null], ['universalSearch', 'beta', {}, 'post']];
  keys.forEach(key => client.setQueryData(key, []));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const saved = renderHook(() => useListingEditSaved('p1', 'p1'), { wrapper });
  await act(async () => { await saved.result.current(); });
  keys.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
  expect(back).toHaveBeenCalledOnce();
  client.clear();
});
