// PERF-6 / #894 — offline-first React Query cache (AsyncStorage native, IndexedDB web).
// Wiped on sign-out via `clearPersistedQueryCache` → `clearAllPersistedStores`.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, type Query } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';

export const RQ_CACHE_KEY = 'kc-rq-cache';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

import { isPersistableQueryKey } from './queryPersistKeys';

export { isPersistableQueryKey } from './queryPersistKeys';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60_000,
      gcTime: WEEK_MS,
      networkMode: 'offlineFirst',
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      retry: 2,
      throwOnError: false,
    },
    mutations: {
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
