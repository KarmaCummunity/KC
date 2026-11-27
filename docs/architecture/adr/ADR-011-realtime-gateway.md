# ADR-011 — Realtime gateway: one WebSocket, the same topics, the same policies

- **Status:** Accepted (2026-11-23) · phase 6 of [ADR-009](./ADR-009-backend-platform.md)
- **Decision log:** `D-247` in [`../../SSOT/DECISIONS.md`](../../SSOT/DECISIONS.md)
- **Related:** [ADR-003 realtime](./ADR-003-realtime.md) (topics, mechanisms, lifecycle; unchanged by this ADR), [ADR-010 port gateway](./ADR-010-port-gateway.md), topic registry [`docs/SSOT/social_realtime_conventions.md`](../../SSOT/social_realtime_conventions.md)

## Context

Realtime is the last thing the app does outside the API besides sign-in: five adapters open Supabase Realtime channels (`app/scripts/check-api-door.mjs` lists them). ADR-003 fixed what is sent and who may receive it: database-sent Broadcast on private, entity-scoped topics, client-sent Broadcast for typing, Presence for "who is here", and a few `postgres_changes` streams. Authorization is row-level security on `realtime.messages`: a member may join a topic when they could read a message of that topic.

Leaving Supabase means replacing the service that carries those messages, not the contract. Two properties must survive: the app's ports and topics, and the rule that **authorization lives in SQL next to the data**.

## Decision

### 1. One WebSocket endpoint in the API

`GET /v1/realtime` upgrades to a WebSocket. Frames are JSON objects with an `op`:

| From the app | Meaning |
|---|---|
| `auth { token }` | Must be the first frame, within 10 seconds. Sent again to replace a token before it expires. The token never goes in the URL: URLs are logged |
| `subscribe { ref, topic, extension }` | Join a topic for `broadcast` or `presence`. Answered `ok { ref }` or `error { ref, code }` |
| `unsubscribe { ref, topic, extension }` | Leave it |
| `broadcast { topic, event, payload }` | Client-sent event (typing). Needs the send right on the topic |
| `track { topic, meta }` / `untrack { topic }` | Presence |
| `ping` | Heartbeat; answered `pong` |

| From the server | Meaning |
|---|---|
| `event { topic, event, payload }` | A broadcast |
| `presence_state { topic, members }` then `presence_diff { topic, joins, leaves }` | Presence |
| `ok`, `error`, `pong` | Answers |

A connection without a valid token, a frame that is not understood, too many subscriptions or frames that are too large or too fast close the socket with a code the client maps to "sign in again", "bug" or "slow down".

### 2. Topics and authorization are the database's, unchanged

The topics are ADR-003's. Whether a caller may **receive** on a topic is decided by the policies already written on `realtime.messages`: in a transaction that is always rolled back, the gateway writes one probe row for the topic and extension, switches to the caller (role and claims, as every request does), sets `realtime.topic`, and reads the probe. Visible means allowed. Whether a caller may **send** is the same question for `insert`. This is the algorithm of the service being replaced, so every policy, and every SQL test of a policy, keeps its meaning. A new topic is still "a policy and an SQL test in the same migration" (ADR-003).

The right is checked when a topic is joined and again when the connection's token is replaced, as today.

### 3. Database-sent events: the table is the queue, `NOTIFY` is the bell

Every database event already goes through `kc_private.broadcast` → `realtime.send`, which stores a row in `realtime.messages`. On KC's own PostgreSQL `realtime.send` also calls `pg_notify('kc_realtime', <row id>)`. A notification is delivered when the transaction commits, so it never announces a row that cannot be read yet.

Each API instance keeps one listening connection. On a notification it reads that row and hands it to the subscribers connected to it. Because every instance hears every notification, database events need no second fan-out system. A sweep every few seconds reads the rows of the last seconds that this instance has not delivered, which covers a notification lost while the listening connection was being re-established. Delivery is at most once per connection and may be missed; ADR-003 already makes realtime an accelerator and never the source of truth, and that rule is what makes this simple design correct.

Old rows are deleted by a scheduled job.

### 4. Client-sent events and presence: Redis

Typing events and presence are not stored. An instance publishes them to Redis and every instance delivers them to its own subscribers. Presence membership is kept in Redis with an expiry that the connection's heartbeat renews, so a crashed instance's members disappear on their own.

### 5. The app side

`@kc/infrastructure-api` gets one realtime client (connect, authenticate, heartbeat, reconnect with back-off, re-subscribe) and, on top of it, the channel interface the existing realtime adapters already use. So the adapters do not change, the way the data adapters did not (ADR-010): the composition root hands them `viaApiRealtime(client)`, which is the Supabase client itself until realtime is switched to the API. Screens do not change either: they depend on the ports, and they already fall back to a query when a channel errors.

### 6. `postgres_changes` streams become Broadcast

The streams that still read row changes (chat inbox rows, the member's own row, rides, community stats) move to database-sent Broadcast on owner-scoped topics, each with its policy and SQL test. ADR-003 already names this as the direction; it is done per stream, together with the adapter that uses it.

## Order of work

| Step | What | State |
|---|---|---|
| 1 | Topic authorizer on the real policies | Done (`platform/realtime/topicAuthorizer.ts`); every guarded row of ADR-003's table has a case for the member it is for and for another, on the KC schema |
| 2 | Event intake (`NOTIFY`, row read, sweep) and the hub that delivers to subscribers | Done (`databaseEvents.ts`, `realtimeHub.ts`); checked over a real WebSocket, including an event whose notification was lost |
| 3 | The WebSocket endpoint: frames, limits, heartbeat | Done (`realtimeGateway.ts`, `realtimeConnection.ts`; the frames are `@kc/infrastructure-api`'s `realtimeWire.ts`) |
| 4 | Client-sent Broadcast and Presence over Redis | Done (`redisEphemeralEvents.ts`): events are published to every instance; presence is a Redis hash per topic with entries their instance renews, and an instance that stops removes its members. Checked with two instances on one Redis. Without Redis an event still reaches the instance it arrived at. An in-memory implementation of the same class serves unit tests |
| 5 | The realtime client in `@kc/infrastructure-api`; composition switch | Done. The app's realtime adapters run unchanged: `createApiRealtimeHost` gives them the four client members they use (`channel`, `removeChannel`, `getChannels`, `realtime.setAuth`) over one `RealtimeSocket` (sign-in, heartbeat, reconnect with back-off, re-join, re-track). `viaApiRealtime(client)` in the app picks it when `EXPO_PUBLIC_KC_API_REALTIME=1`. Chat messages, typing, online presence and the feed signal are checked through the unchanged adapters with the real database triggers |
| 6 | `postgres_changes` streams as Broadcast (migrations, adapters) | Nothing to do: the baseline already sends every stream as Broadcast, and no adapter subscribes to row changes any more |
| 7 | Retention job; load test | The job is done (`realtime-retention`, one hour). The load test waits for a deployed API |

It is switched on with the database move (ADR-009 phase 10): until KC runs its own PostgreSQL, `realtime.messages` belongs to Supabase's service and is not KC's to add a notification to. Everything above is built and tested before that on the plain PostgreSQL the repository's database suites already use, whose `realtime` schema (`supabase/baseline/local/supabase_shim.sql`) is the starting point of KC's own.

## Consequences

- Authorization does not move: one set of policies, tested in SQL, decides for both the old service and the new one.
- No new infrastructure for database events; Redis, already there, carries only what is not stored.
- Every instance reads every event row once. At KC's scale that is a few hundred small reads a second at most; if it ever matters, one instance can tail and publish to Redis without changing the protocol.
- The protocol is KC's own, so the Supabase client library leaves the app with the last adapter.

## Limits

- An event can be missed (a reconnect, a restart). Screens must keep their query fallback (ADR-003 §4).
- A right that is revoked while a member is subscribed takes effect at the next join or token replacement, as today.
- Presence is eventually consistent across instances: a member who vanishes without a close is removed when their entry expires.
