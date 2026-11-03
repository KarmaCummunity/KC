# ADR-003 — Realtime: Broadcast, Presence, postgres_changes

- **Status:** Accepted (2026-10-30) · records the mechanisms shipped in #885 / #994 and the rules for new ones
- **Issue:** KC#1017 · **Decision log:** `D-201` in [`../../SSOT/DECISIONS.md`](../../SSOT/DECISIONS.md)
- **Related:** [ADR-001 client state](./ADR-001-client-state.md) (realtime patches the query cache), [ADR-002 data layer](./ADR-002-data-layer.md), #879 / #881 (scale and load tests)

## Context

Supabase Realtime offers three mechanisms:

- **Broadcast**: messages on a topic. They can be sent from the database (`realtime.send`, `realtime.broadcast_changes` in a trigger) or from a client. Private topics are authorized by RLS on `realtime.messages`.
- **Presence**: per-topic state of who is connected, synced by the server, also authorized by RLS on private topics.
- **postgres_changes**: row changes from the `supabase_realtime` publication. Each change is checked against every subscriber's RLS, which is the most expensive mechanism at scale.

The app uses all three. The rules lived only in migration comments, and channel pile-up on remount (#994) showed that the lifecycle needs one pattern.

## Decision

### 1. Mechanism per feature

| Feature | Mechanism | Topic | Auth | Source |
|---|---|---|---|---|
| Chat messages (insert / update) | DB → **Broadcast** (private) | `chat:<chat_id>:messages` | `chat_realtime_broadcast_receive`: participant + `is_chat_visible_to` | `0259` trigger; `messages` left the publication in `0349` |
| Typing indicator | client → **Broadcast** (private) | `chat:<chat_id>:typing` | `chat_realtime_client_send` (send) + receive policy above | `0415` |
| In-chat presence | **Presence** (private) | `chat:<chat_id>:presence` | same chat policies | `0415` |
| "Online" dot | **Presence** (private) | `presence:online` | `online_presence_receive` / `online_presence_track`; respects "show my active status" | `0415`, `0419` |
| Feed "new posts" banner | DB → **Broadcast** (private) | `feed:public` | receive policy on `feed:public`; payload is a **ping**, the client refetches the RLS-gated feed on tap | `0416` |
| Notification badge / inbox | DB → **Broadcast** (private) | `user:<user_id>:notifications` | topic uuid must equal `auth.uid()` | `0256` |
| Post likes / comments / shares | DB → **Broadcast** (private) | `post:<post_id>:engagement` | `post_engagement_broadcast_receive`: `is_post_visible_to` | `0253` |
| Chat inbox rows | **postgres_changes** on `chats` | unique per mount | table RLS | `SupabaseChatRealtime` |
| Own user row, rides feed / participants, community stats | **postgres_changes** | unique per mount | table RLS | `SupabaseUserRealtime`, `SupabaseRidesRealtime`, `useCommunityStatsAbout` |

The live topic registry (events, payloads, sources) is [`docs/SSOT/social_realtime_conventions.md`](../../SSOT/social_realtime_conventions.md); a new topic is added there in the same PR.

**Default for new features: DB-sent Broadcast on a private, entity-scoped topic.** Use Presence only for "who is here / online". Use postgres_changes only for low-fan-out, owner-filtered streams (a `filter: col=eq.<id>`), never for a public, high-traffic table.

### 2. Topic naming and authorization

- Format `<entity>:<uuid>:<facet>` (`chat:…:messages`, `user:…:notifications`) or `<scope>:<name>` for global topics (`feed:public`, `presence:online`). `public.realtime_topic_uuid(topic)` parses the uuid and returns null on malformed input, never raising.
- Private topics: `{ config: { private: true } }` on the client **and** a `create policy … on realtime.messages` in the same migration, with `select` (receive) and, if clients send, `insert` (send), each checking `realtime.topic()` + `realtime.messages.extension` (`broadcast` / `presence`) + the caller's right to the entity. Use `(select auth.uid())`.
- DB-sent payloads carry **ids or a ping**, not row content the receiver might not be allowed to read. The client re-reads through RLS (feed banner, rides).

### 3. Subscribe / unsubscribe lifecycle

- Adapters in `infrastructure-supabase` own every channel, behind a port (`IChatRealtime`, `IRidesRealtime`, …) that returns an `Unsubscribe`. Screens and hooks don't call `supabase.channel` directly. Two hooks still do (`useNotificationInboxBadge`, `useCommunityStatsAbout`); move them when touched.
- **Private, exact topics** go through `openExactTopicChannel()` (`realtime/exactTopicChannel.ts`). It calls `setAuth()` first, removes a stale cached channel on the same topic, then binds and subscribes; `close()` is idempotent, including before the channel is open.
- **postgres_changes** channels use a unique topic per mount (`uniqueTopic` / `uniqueTopicSuffix`), so a fast remount never reuses a half-closed cached channel.
- Subscribe in an effect and return the unsubscribe from that effect. One channel per entity per screen. App-wide streams are **one shared channel** owned by a lifecycle hook (online presence: `SupabaseOnlinePresence`, joined while signed in and foregrounded); UI rows read the shared state and never open their own channel. Handle `CHANNEL_ERROR` / `TIMED_OUT` by surfacing an error to the caller, which falls back (§4).
- Realtime events update **server state in the query cache** (`setQueryData` / `invalidateQueries`, ADR-001). Stores hold only lifecycle and optimistic state.

### 4. Scale limits and fallback

- Plan quotas (concurrent connections, messages per second, channel joins) are the ceiling. Check them in the Supabase dashboard for the current plan, and measure with the k6 load tests (#881) before a launch push. postgres_changes counts against database load too; it's the first thing to move to Broadcast if load grows (#879).
- Realtime is an **accelerator, never the source of truth**. Every realtime-fed screen also loads through a normal query, so a lost socket costs freshness, not data:
  - query defaults refetch on mount and reconnect (`networkMode: 'offlineFirst'`, ADR-001);
  - screens that must stay fresh without realtime poll: `refetchInterval` (e.g. active ride 30 s, active posts count 60 s);
  - DB-sent pings ask the client to refetch, so a missed ping is fixed by the next refetch.
- Pass a new realtime feature through the checklist: topic + policy migration with an SQL test (receive allowed for the right user and refused for another), adapter + port, effect cleanup, a polling or refetch fallback, and a row added to the table in §1.

## Consequences

- One default (private DB Broadcast) keeps fan-out cheap and authorization in SQL next to the data.
- Pings + refetch keep realtime payloads free of data the receiver may not see, at the cost of one extra read per event.
- Two hooks that open channels directly, and the postgres_changes streams in §1, are known exceptions that move when touched.
