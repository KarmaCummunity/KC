// app/apps/mobile/src/store/persistedStoresReset.ts
//
// TD-103 (audit 2026-05-16, BACKLOG P2.14): filterStore, searchStore,
// lastAddressStore, and postDraftStore use persist() with globally-scoped
// AsyncStorage keys (kc-filters, kc-search, kc-last-address,
// kc-post-draft-v1). queryClient.clear() resets React Query in memory
// but not these persisted blobs, so user A's filters + exact home address
// + half-typed draft survive sign-out and pre-fill user B's Create Post
// form on the same device. Clearing persisted state + in-memory state on
// sign-out / delete-account closes the leak.
//
// `postDraftStore` also enforces a defense-in-depth `ownerId` check on
// read (see `readDraftForOwner`); clearing here is the belt to its
// braces, so the next session never sees the previous user's draft even
// for the brief window before AuthGate routes to (auth).
//
// Future evolution: per-user-id namespaced storage keys would preserve a
// returning user's preferences. Out of scope here — clearing is the
// principle-of-least-surprise fix and mirrors queryClient.clear().

import { useFilterStore } from './filterStore';
import { useSearchStore } from './searchStore';
import { useLastAddressStore } from './lastAddressStore';
import { usePostDraftStore } from './postDraftStore';
import { clearPersistedQueryCache } from '../lib/queryPersist';

export async function clearAllPersistedStores(): Promise<void> {
  await Promise.all([
    useFilterStore.persist.clearStorage(),
    useSearchStore.persist.clearStorage(),
    useLastAddressStore.persist.clearStorage(),
    usePostDraftStore.persist.clearStorage(),
    // PERF-6: the persisted React Query snapshot holds the previous user's
    // feed / profile / inbox — wipe it too so the next user never sees it.
    clearPersistedQueryCache(),
  ]);
  // In-memory reset so the next render doesn't show stale state until
  // the store rehydrates with defaults.
  useFilterStore.getState().clearAll();
  useSearchStore.getState().clearFilters();
  useSearchStore.getState().clearRecentSearches();
  useLastAddressStore.getState().clear();
  usePostDraftStore.getState().clearDraft();
}
