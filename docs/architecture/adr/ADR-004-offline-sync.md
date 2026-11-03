# ADR-004 — Offline-first and sync strategy

- **Status:** Proposed
- **Issue:** KC#1018
- **Related:** [ADR-001 client state](./ADR-001-client-state.md) (query cache & Zustand stores), [ADR-002 data layer](./ADR-002-data-layer.md) (repositories & RPCs), [ADR-003 realtime](./ADR-003-realtime.md) (reconnect refetch & realtime fallbacks)

## Context

KC users frequently encounter unstable mobile connectivity during core physical interactions: in-person handoffs, food pickups, and ride coordination. The mobile app (`apps/mobile`) currently implements partial offline read caching via TanStack Query (`queryPersist.ts`, PERF-6 / #894) with `networkMode: 'offlineFirst'`, and in-memory optimistic updates for chat messages (`useChatSend.ts`, `chatStore.ts`).

However:
1. **Writes fail immediately when offline**: creating a post (`useCreatePostPublish`), booking or claiming handoffs (`GivingHandoffActions`), and chat sends outside active screens fail with network errors.
2. **Optimistic state is ephemeral**: chat optimistic messages live only in memory (`chatStore.ts`) and vanish on app restart.
3. **No persistent write outbox**: mutations are not queued or retried with idempotency protections across application restarts.
4. **No unified conflict and UX model**: no global offline indicator, no retry affordances for failed background writes, and no explicit policy for concurrent server mutations (e.g. claiming already-reserved food).

This ADR defines the target offline read and write synchronization strategy across all layers.

## Decision

### 1. Offline read cache & TTLs

Read data is served from the persistent TanStack Query cache (`apps/mobile/src/lib/queryPersist.ts`), backed by `AsyncStorage` on native and `IndexedDB` (`idb-keyval`) on web.

| Layer / Query Root | Stored In | TTL (`staleTime` / `gcTime`) | Persistence Rules |
|---|---|---|---|
| **Public feed & listings** (`feed`, `saved-posts`) | React Query cache (`PERSISTABLE_ROOTS`) | `staleTime: 10 min`, `gcTime: 7 days` | Persisted. Keyset-paginated pages hydrated immediately on app launch. |
| **User profiles** (`user-profile`, `profile-other`, `profile-posts`, `following`, `followers`) | React Query cache (`PERSISTABLE_ROOTS`) | `staleTime: 10 min`, `gcTime: 7 days` | Persisted. Enables viewing self and visited member profiles offline. |
| **Chat inbox & threads** (`chat-inbox`, `chat-messages`) | React Query cache + `chatStore` | `staleTime: 0`, `gcTime: 7 days` | `chat-inbox` persisted in `PERSISTABLE_ROOTS`. Active thread messages cached to permit offline reading of recent chats. |
| **Notification inbox** (`notification-inbox`) | React Query cache (`PERSISTABLE_ROOTS`) | `staleTime: 2 min`, `gcTime: 7 days` | Persisted for instant launch; badges reconciled upon reconnect. |
| **Giving handoffs & bookings** (`giving-handoff`, `giving-handoffs`) | React Query cache | `staleTime: 1 min`, `gcTime: 24 hours` | Persisted to allow reviewing pickup instructions and scheduled times offline. |

**What NOT to persist:**
- **Auth secrets & tokens**: Kept exclusively in `expo-secure-store` via `authSecureStorage.ts` (ADR-001); never placed in `AsyncStorage` or query cache.
- **Sensitive PII**: Private phone numbers, exact unconfirmed addresses (when `locationDisplayLevel` is neighborhood/city), and identity verification documents.
- **Admin & moderation data**: Admin review queues (`reports`, `suspects`) and financial/donation provider session payloads.
- **Cache invalidation on sign-out**: `clearAllPersistedStores()` (`src/store/persistedStoresReset.ts`) continues to clear `kc-rq-cache` and all user-specific stores.

### 2. Client write outbox & idempotency

To support offline actions, the mobile app introduces a client-side persistent **Outbox Store** (`kc-sync-outbox`, managed via Zustand `persist` with `AsyncStorage` and registered in `clearAllPersistedStores()`).

#### Outbox Entry Structure
Each write action enqueues an `OutboxItem`:
```ts
interface OutboxItem {
  id: string;                 // Client-generated UUID (primary key in outbox)
  entityType: 'post' | 'chat_message' | 'giving_handoff';
  action: 'create_post' | 'send_message' | 'reserve_item' | 'claim_food' | 'confirm_handoff';
  payload: Record<string, unknown>;
  idempotencyKey: string;     // Unique per semantic action
  createdAt: string;          // ISO timestamp
  attempts: number;
  maxAttempts: number;        // Default 5
  status: 'queued' | 'in_flight' | 'failed' | 'applied';
  lastError?: { code: string; message: string; fatal: boolean };
}
```

#### Idempotency Keys per Entity
- **Posts (`CreatePostUseCase`)**: `idempotencyKey = post:<client_post_uuid>`. The client generates the `postId` before insert. `posts` table insert uses `on_conflict_do_nothing` or client UUID as primary key, preventing duplicate posts on retry.
- **Chat messages (`SendMessageUseCase`)**: `idempotencyKey = chat:<chat_id>:<client_id>`. Already partially in code via `clientId` in `OptimisticMessage` (`useChatSend.ts`). The `messages` table enforces uniqueness on `(chat_id, client_id)`.
- **Claims & handoffs (`givingHandoffUseCases`)**: `idempotencyKey = handoff:<listing_id>:<user_id>:<action>`. Handed to RPCs (`reserve_item_giving`, `claim_food_giving`) as parameter `p_idempotency_key` checked against an RPC audit/execution log.

### 3. Retry and backoff strategy

1. **Trigger mechanisms**:
   - **Network status change**: `@react-native-community/netinfo` listener and browser `online` event trigger an outbox flush when transitioning from offline to online.
   - **App foregrounding**: `AppState === 'active'` triggers queue processing.
   - **Post-reconnect realtime ping**: Realtime reconnect signals flush outbox before subscribing to changes (ADR-003).
2. **Exponential backoff with jitter**:
   - `delay = min(maxDelay, baseDelay * 2^attempt) + jitter`
   - Default: `baseDelay = 1s`, `factor = 2`, `maxDelay = 30s`, `jitter = random(0, 500ms)`.
3. **Error classification**:
   - **Transient errors** (network drops, timeout, HTTP 503): Increment `attempts` and retry with backoff.
   - **Fatal / domain errors** (validation errors `PostError('title_too_long')`, permission errors `ChatError('send_to_deleted_user')`, business invariant violations): Immediately transition to `status: 'failed'`, stop retries, and notify the user.

### 4. Conflict resolution rules (per entity)

| Entity | Action | Conflict Rule | Resolution Mechanism |
|---|---|---|---|
| **Chat messages** | `send_message` | **Append-only** | No data collision possible. Messages sorted by `created_at`. If recipient was deleted or blocked while offline, server returns domain error; outbox marks message `failed`. |
| **Posts** | `create_post` | **Client-created UUID / Append-only** | Created post always succeeds once online unless author was suspended. Media uploads happen prior to post row insert via resilient chunked/resumable upload queue. |
| **Posts** | `update_post` / `close` | **Server wins on status; Last-Write-Wins on fields** | If post was closed or deleted by admin/moderation on server, client update is rejected with error toast. Field updates (title, description) apply LWW with server timestamp check. |
| **Claims & Handoffs** | `reserve_item`, `claim_food` | **Server wins (Pessimistic / First-come)** | Scarce physical resources cannot be merged. If another user claimed the food or reserved the item while the client was offline, the RPC returns `listing_not_available` or `seats_exhausted`. The outbox marks action as `failed`, surfaces an alert, and invalidates the listing query. |
| **Handoff confirmation** | `confirm_item_handoff`, `mark_giving_handed_over` | **Server state machine wins** | If handoff was already cancelled or expired (`confirm_by` passed), state transition fails gracefully. |

### 5. UX states & feedback

1. **Global offline banner**:
   - A non-intrusive banner pinned below the header when device is offline: *"No internet connection — working offline"*.
   - Dismisses automatically when connection is restored.
2. **Pending & failed badges**:
   - **Chat**: Clock icon for `'queued'` / `'in_flight'`; red retry icon for `'failed'`. Tap opens action sheet: *Retry* or *Delete*.
   - **Feed & Posts**: Newly created offline posts appear at the top of the user's feed/profile with an amber *"Pending upload"* badge.
   - **Handoffs**: Claims show *"Pending confirmation"* with an explicit note that reservation will finalize when back online.
3. **Manual retry & outbox management**:
   - Failed outbox items surface an in-app banner or toast: *"1 item failed to sync. Tap to review"*.
   - Dedicated modal or section in Settings allowing users to retry all or purge stalled items.

### 6. Phased rollout plan

1. **Phase 1 — Read cache hardening & offline indicator**:
   - Integrate NetInfo connectivity store (`useNetworkStatus`).
   - Add global offline banner and tighten React Query offline-first defaults.
2. **Phase 2 — Persistent chat outbox**:
   - Transition `OptimisticMessage` in `chatStore.ts` to use persistent outbox queue.
   - Add message retry/discard UI and backend `client_id` deduplication.
3. **Phase 3 — Post creation & media upload outbox**:
   - Support offline post creation with persistent draft and background media upload pipeline.
   - Idempotent `create_post` RPC / repo integration.
4. **Phase 4 — Handoffs and claims sync**:
   - Persistent outbox for reservation, claiming, and handoff state machine actions.
   - Conflict resolution modal for unavailable listings (`listing_not_available`).

## Follow-up implementation issues

- `feat(mobile): add network connectivity store and global offline banner`
- `feat(mobile): implement persistent write outbox store with exponential backoff runner`
- `feat(chat): persist pending optimistic chat messages across restarts with outbox sync`
- `feat(posts): offline post creation queue with background media upload worker`
- `feat(giving): offline handoff actions with server-wins conflict resolution and error feedback`
- `feat(infra): add idempotency key support to post creation and handoff RPCs`

## Consequences

- **Predictable offline behavior**: Users can read cached feeds, profiles, and chats without connectivity, and draft messages or posts with confidence they will sync.
- **Zero data duplication**: Idempotency keys eliminate double posts and repeated chat messages after network drops.
- **Clear conflict boundaries**: Server-wins model for scarce resources (handoffs) avoids ambiguous physical commitments while providing explicit user feedback.
- **Architecture alignment**: Outbox acts as an infrastructure layer behind existing application use cases and repositories without leaking Supabase concerns into domain code.
