# ADR-001 — Client state management

- **Status:** Accepted (2026-10-30) · records and tightens what the mobile app already does
- **Issue:** KC#1015 · **Decision log:** `D-200` in [`../../SSOT/DECISIONS.md`](../../SSOT/DECISIONS.md)
- **Related:** [ADR-002 data layer](./ADR-002-data-layer.md) (where server state comes from), PERF-6 / #894 (offline query cache), TD-103 (persisted state leaking across sign-out)

## Context

The Expo app (`app/apps/mobile`, native + web export) holds three kinds of client state:

1. **Server state**: feed, profiles, chats, listings, matches, notifications. Fetched through use cases / repositories (ADR-002), shared between screens, needs caching, invalidation and offline reads.
2. **Client / session state**: auth session, chat threads with optimistic messages and realtime lifecycle, feed filters, the post draft, theme, redirect intent. Not owned by the server, or owned only until it syncs.
3. **Screen-local UI state**: input values, open sheets, selected chips.

Today the app uses TanStack Query v5 (with `persistQueryClient`, about 40 query hook files), Zustand v5 (10 stores in `src/store/`, 5 of them persisted), `AsyncStorage` / IndexedDB for persistence and `expo-secure-store` for auth tokens. There's no written rule, so agents ask "query or store?" on every feature, and TD-103 showed what happens when persisted state outlives the user who wrote it.

## Options considered

| Option | For | Against |
|---|---|---|
| **A. TanStack Query + Zustand** (current) | Server cache with dedupe, retries, `offlineFirst`, persistence and invalidation built in; Zustand stores are tiny, typed, readable outside React (`getState()` in services) and have `persist` middleware | Two libraries to learn; needs a rule for which state goes where (this ADR) |
| B. Redux Toolkit (+ RTK Query) | One store, devtools, strict patterns | Heavy boilerplate for a small team of agents; migrating 41 hooks and 15 stores is all cost and no product gain; RTK Query offline persistence is weaker than `persistQueryClient` |
| C. React Context only | No dependency | No cache, dedupe or invalidation; every context value change re-renders its subtree; we would rebuild TanStack Query badly |

## Decision

**Option A.** One owner per kind of state:

| State | Owner | Rules |
|---|---|---|
| Anything that comes from Supabase | **TanStack Query** (`useQuery` / `useInfiniteQuery` / `useMutation` in `src/hooks/`) | The query function calls a use case or repository, never `supabase` directly. Key = `[root, ...params]` with a stable string root (e.g. `['feed', filters]`). Mutations update the cache (optimistic `setQueryData` + rollback in `onError`) or `invalidateQueries` in `onSuccess` / `onSettled`. Never copy query data into a store. |
| Realtime-driven or optimistic client state that spans screens | **Zustand store** in `src/store/<name>Store.ts` | Holds only what the server doesn't own yet (optimistic messages, typing state, a draft) or never owns (filters, theme, redirect intent). Realtime events patch the **query cache** for server data (see `chatStore` → `chatInboxQuery` helpers); the store keeps the lifecycle. Selectors pick the fields they need (`useStore((s) => s.x)`). |
| Screen-local UI state | `useState` / `useReducer` in the component | Lift it to a store only when a second screen needs it. |
| Persisted preferences and drafts | Zustand `persist` + `createJSONStorage(() => AsyncStorage)`, key `kc-<name>` | Persist only state that is safe to show the **next** user of the device, or clear it on sign-out: every user-specific persisted store **must** be added to `clearAllPersistedStores()` (`src/store/persistedStoresReset.ts`). |
| Persisted server cache (offline-first) | `persistQueryClient` (`src/lib/queryPersist.ts`, AsyncStorage on native, IndexedDB on web) | Only roots in `PERSISTABLE_ROOTS` (`src/lib/queryPersistKeys.ts`) are written. Add a root only for cold-start-critical, non-sensitive lists. Bump `buster` when a persisted shape changes. Cleared on sign-out. |
| Secrets (auth tokens) | `expo-secure-store` via `src/services/authSecureStorage.ts` only | Never in AsyncStorage, a store, or the query cache. |

Defaults that stay as they are: `staleTime` 10 min, `gcTime` 7 days, `networkMode: 'offlineFirst'`, `retry: 2`, `refetchOnWindowFocus: false` (`queryClient` in `src/lib/queryPersist.ts`). Override per hook when freshness matters (chat, matches), not globally.

No MMKV for now. AsyncStorage + IndexedDB cover the current sizes, and MMKV needs a native module and a rebuild. Revisit if the persisted cache read becomes a cold-start bottleneck (measure `app.cold_start` first).

### Checklist for new state

1. Does it come from the server? → a query hook. Done.
2. Is it optimistic or realtime glue, or client-only and needed by more than one screen? → a Zustand store, selectors only.
3. Must it survive an app restart? → `persist` with a `kc-*` key **and** an entry in `clearAllPersistedStores()` if it's user-specific.
4. Is it a secret? → `authSecureStorage` only.
5. Otherwise → `useState`.

## Consequences

- One answer for "where does this live?", checkable in review.
- Server data has a single source of truth (the query cache), so there's no sync code between stores and queries.
- Persisted state stays scoped to the signed-in user through one reset function. Forgetting to register a new persisted store there is the main risk; reviewers check it.
- Existing deviations (e.g. a store holding server-derived lists) get moved to queries when touched, not in a big-bang refactor.
