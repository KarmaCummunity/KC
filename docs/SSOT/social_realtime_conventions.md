# Social realtime & RLS conventions (KC epic #884)

> **Scope:** Post engagement (KC#867) and scale-oriented realtime (KC#878). Mechanism choice, auth and lifecycle rules: [ADR-003](../architecture/adr/ADR-003-realtime.md) (`D-201`); this file is the topic registry. Product vision references live in the external `PRD_V2_NOT_FOR_MVP` tree; this doc is the **implemented** contract in-repo.

## Realtime channels (Broadcast, private)

| Pattern | Example | Events | Source |
| --- | --- | --- | --- |
| Post engagement | `post:<post_id>:engagement` | `INSERT` / `UPDATE` / `DELETE` (via `realtime.broadcast_changes`) | `post_reactions`, `post_comments`, `post_shares`, `post_stats` |
| Notification badge | `user:<user_id>:notifications` | `badge` (via `realtime.send`) | `notification_inbox` read/unread |
| Chat messages | `chat:<chat_id>:messages` | `INSERT` / `UPDATE` / `reaction` | `messages`, `message_reactions` |
| Chat typing | `chat:<chat_id>:typing` | `typing` (client broadcast; send auth `0415`) | — |
| Chat presence | `chat:<chat_id>:presence` | Presence track (client; track auth `0415`; requires show-active-status `0419`) | — |
| Online presence | `presence:online` | Presence track, key = user id (active members with show-active-status ON; `0415`, `0419`) | — |
| Feed new posts | `feed:public` | `new_post` `{post_id, owner_id}` (via `realtime.send`, `0416`) | `posts` INSERT (Public + open) |

**Client lifecycle:** private topics are exact (policies match on them), so the client
uses `openExactTopicChannel` (infrastructure-supabase `realtime/`): it removes any stale
cached channel on the topic before re-creating, and `close()` is idempotent and safe
before the channel opens. Online presence is one shared app-level channel
(`SupabaseOnlinePresence`, started while signed in + foregrounded); UI rows read the
shared set and never open their own channels.

**Show my active status (0419):** `users.show_active_status` (default ON, owner-only via
`rpc_get_show_active_status` / `rpc_set_show_active_status`). Reciprocal: when OFF the user
can neither track nor receive presence on `presence:online` / `chat:<id>:presence` (Realtime
Authorization); the client also leaves the channel. Authorization is checked at join, so
toggling requires leave + rejoin (handled by `useOnlinePresenceLifecycle`).

**Client setup (JS):**

1. `await supabase.realtime.setAuth()` before subscribe.
2. Channel config `{ private: true }` — must match DB broadcasts (default private).
3. Listen: `.on('broadcast', { event: 'INSERT' | 'UPDATE' | 'DELETE' }, handler)`.

**Do not** add engagement tables to `supabase_realtime` publication; fan-out uses Broadcast to avoid per-subscriber RLS on WAL (KC#878).

**Postgres Changes removal (0349):** `public.messages` is **removed** from `supabase_realtime`; chat delivery uses Broadcast triggers in `0259_chat_v2_realtime_broadcast.sql` only. Do not re-add `messages` to the publication.

## Read replicas & pooling (KC#879)

- **Feed/search read routing:** route read-only RPCs (`feed_ranked_ids`, `search_all`, engagement reads) to a read replica connection string when available (`DATABASE_READ_URL` in app infra — not stored in repo).
- **Supavisor:** use **transaction mode** pooler port for serverless/RPC bursts; session mode only when prepared statements are required.
- **Feed MV + cache:** `kc_private.feed_open_posts_mv` refreshes via pg_cron when dirty (`0346`); per-user snapshots in `user_feed_cache` via pgmq worker (`0348`).

## Authorization

Policy `post_engagement_broadcast_receive` on `realtime.messages` (migration `0253`) allows `SELECT` when:

- Topic matches `post:%:engagement`, and
- `is_post_visible_to(post, auth.uid())` holds for the embedded `post_id`.

## RLS patterns (public schema)

- Engagement policies use **`(select auth.uid())`** initplan form (Supabase perf guidance).
- Visibility gate: **`is_post_engagement_visible(post_id, viewer)`** (STABLE, SECURITY DEFINER) → `is_post_visible_to`.
- Mutations require **`is_active_member(auth.uid())`** (same as posts/reports).
- Blocked users cannot react/comment on posts owned by the user they blocked (symmetric block check on owner).

## RPC surface (authenticated)

| RPC | Purpose |
| --- | --- |
| `rpc_set_post_reaction(post_id, reaction_type)` | Upsert `like`/`support`/`thanks`; `NULL` type removes reaction |
| `rpc_create_post_comment(post_id, body, parent_comment_id?)` | Top-level or one-level reply; resolves `@share_handle` mentions |
| `rpc_update_post_comment(comment_id, body)` | Edit; purges comment translations |
| `rpc_delete_post_comment(comment_id)` | Soft delete (`status = deleted`) |
| `rpc_log_post_share(post_id, share_kind, external_channel?, repost_post_id?)` | In-app or external share log |
| `rpc_get_post_engagement_stats(post_id)` | Read denormalized counters (RLS-gated) |

## Rate limits (server-side)

| Action | Limit |
| --- | --- |
| Comments | 20 / minute / author |
| Reactions | 60 / minute / user |
| Shares | 30 / hour / user |

## EXPLAIN ANALYZE runbook (top RPCs)

Run against a **dev** database with representative data (not CI-gated):

```bash
# From repo root after migrations applied:
psql "$DATABASE_URL" -f supabase/scripts/social_rpc_explain_analyze.sql
```

Capture plans for: feed RPCs (`feed_ranked_ids` family), chat unread RPCs, closure RPCs, and the new engagement RPCs listed above. Target: **no sequential scans** on `post_id` / `user_id` policy columns; `is_post_visible_to` should use indexed paths on `posts` and `follow_edges`.

## Counters

`post_stats` is **1:1** with `posts`, maintained by triggers on engagement tables. Clients should read counters from `post_stats` or `rpc_get_post_engagement_stats`, not `count(*)`.
