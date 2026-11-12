// PERF-6 / #894 — offline-first React Query cache (AsyncStorage native, IndexedDB web).
// Wiped on sign-out via `clearPersistedQueryCache` → `clearAllPersistedStores`.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MutationCache, QueryCache, QueryClient, type Query } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';

export const RQ_CACHE_KEY = 'kc-rq-cache';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

import { isPersistableQueryKey } from './queryPersistKeys';
import { reportHandledError } from './observability/reportHandledError';
import { shouldRetryQuery, queryRetryDelay } from './queryRetryPolicy';

export { isPersistableQueryKey } from './queryPersistKeys';
export { shouldRetryQuery, queryRetryDelay, isNonRetryableError } from './queryRetryPolicy';
export {
  setupQueryLifecycleSync,
  setupFocusManager,
  setupOnlineManager,
} from './queryLifecycleSync';

export const queryClient = new QueryClient({
  // Single choke point for handled failures: `onError` fires once per query
  // (after retries are exhausted) and once per failed mutation, so every data
  // call in the app is reported without touching each hook.
  queryCache: new QueryCache({
    onError: (error, query) => reportHandledError(error, 'query', query.queryKey),
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) =>
      reportHandledError(error, 'mutation', mutation.options.mutationKey),
  }),
  defaultOptions: {
    queries: {
      staleTime: 10 * 60_000,
      gcTime: WEEK_MS,
      networkMode: 'offlineFirst',
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      retry: (failureCount, error) => shouldRetryQuery(failureCount, error),
      retryDelay: queryRetryDelay,
      throwOnError: false,
    },
    mutations: {
      retry: 0,
      throwOnError: false,
    },
  },
});

function createQueryPersister() {
  if (Platform.OS === 'web') {
    return createAsyncStoragePersister({
      storage: {
        getItem: async (key) => (await get<string>(key)) ?? null,
        setItem: async (key, value) => {
          await set(key, value);
        },
        removeItem: async (key) => {
          await del(key);
        },
      },
      key: RQ_CACHE_KEY,
      throttleTime: 1000,
    });
  }
  return createAsyncStoragePersister({
    storage: AsyncStorage,
    key: RQ_CACHE_KEY,
    throttleTime: 1000,
  });
}

const persister = createQueryPersister();

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: WEEK_MS,
  buster: 'kc-rq-v2',
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Query) =>
      query.state.status === 'success' && isPersistableQueryKey(query.queryKey),
  },
};

export async function clearPersistedQueryCache(): Promise<void> {
  await persister.removeClient();
}
