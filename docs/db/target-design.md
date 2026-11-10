# Database — target design (production baseline)

> Phase 2 of the production-database rebuild. **Status: approved by the PM on 2026-11-10 (§12); implementation has not started.**
> Evidence: [`current-state.md`](./current-state.md). Product source of truth: [`docs/spec/`](../spec/README.md); where this document needs a product call it says so in §12.

## 1. Goals and constraints

| Goal | Consequence |
| --- | --- |
| One clean baseline replaces 543 migrations | Schema is authored per domain and assembled into one file (§10) |
| Real user data is treated as sacred | Least privilege by grant *and* RLS, private data physically separated, audit trail, tested restore |
| 100× growth without redesign | Keyset pagination, indexes per real query, queues instead of trigger fan-out, partitioning only for append-only logs |
| Modular monolith | One Postgres, clear domain modules, no separate service until a measured limit is hit (§9) |
| kc-prod is empty | No data migration; kc-dev is rebuilt from the same baseline plus dev seed |

Assumptions (not verified, to confirm): Supabase plan allows PITR on kc-prod; local Supabase (Docker) or a Supabase branch is available for validation; Hebrew remains the only UI language at launch.

## 2. Physical layout

### 2.1 Schemas

| Schema | Exposed through the API | Holds |
| --- | --- | --- |
| `public` | yes | **The contract**: tables the client reads or writes under RLS, and the RPCs the client calls |
| `kc_private` | no | Trigger functions, policy helpers, sweeps, queue workers, internal tables (outbox, rate limits, FSM kernel, matching state, feed cache) |
| `billing` | no | Payments, ledger, KYC, receipts, webhook events — reached only through `public` RPCs and service-role functions |
| `audit` | no | Append-only audit log and deletion tombstones |
| `integrations` | no | WhatsApp bot, ingestion, entity resolution |
| `ops` | no | Health checks, job telemetry |

Why not one schema per domain for every table: PostgREST, generated types, Realtime filters and 98 adapter files address tables by name in `public`. Moving client-facing tables behind per-domain schemas buys naming, not security. The boundary that matters is **exposed vs. not exposed**; domain modularity is carried by source layout (§10) and a naming rule (`<domain>_<entity>` for new tables). Money, audit and integrations get real schemas because nothing in the client should ever address them.

Rule: a function lives in `public` only if a client or Edge Function calls it by name. Everything else is `kc_private` and is not executable by `anon` / `authenticated`.

### 2.2 Conventions

- Keys: `uuid` (`gen_random_uuid()`), named `id`; foreign keys `<entity>_id`; every foreign key indexed.
- Time: `timestamptz`, `created_at` / `updated_at` on every mutable table, one shared `updated_at` trigger.
- Vocabularies: `text` + foreign key to `kc_private.fsm_state(machine_id, status)` for lifecycle columns (one source for SQL, TypeScript and tests); small closed sets use `CHECK`. No Postgres enums (they cannot drop a value).
- Money: integer agorot (`bigint`) + currency code; never `numeric` floats in ledgers.
- Text limits as `CHECK` constraints mirrored from `packages/domain`.
- Naming follows [`docs/spec/94_glossary_and_naming.md`](../spec/94_glossary_and_naming.md): `giving world`, `item subcategory`, `post type`.

## 3. Domain modules

### 3.1 Identity and profiles

| Table | Purpose |
| --- | --- |
| `users` | Public profile only: handle, display name, city, biography, avatar, privacy mode, verification level, language |
| `user_private` | 1:1, owner-only: phone, date of birth, street address, notification preferences, onboarding flags |
| `user_account` | 1:1, server-written: account status, suspension end, deletion request / purge dates, sanction counters |
| `user_stats` | 1:1 counters: followers, following, posts by visibility, given / received, karma, volunteer hours |
| `user_devices`, `user_consents`, `user_entitlements`, `user_active_days` | Push tokens; one consent table (legal versions, driver declaration, housing conduct); Pro tier; activity |
| `admin_role_grants`, `legal_documents`, `legal_document_versions` | Unchanged in shape |

Splitting `users` removes column-level privacy from views and RPCs: other members can only ever select a row that contains nothing private. Counters move out so that a reaction or a follow never rewrites the profile row (less bloat, no Realtime noise). `auth_identities` is dropped; `auth.identities` is the source.

### 3.2 Giving content (marketplace)

**Model: one `posts` table + 1:1 detail tables for structured worlds + validated JSONB for the long tail.**

| Table | Purpose |
| --- | --- |
| `posts` | Core of every post in every giving world (see columns below) |
| `post_ride_details`, `post_housing_details`, `post_event_details`, `post_food_details` | 1:1; fields that are filtered, sorted, constrained or indexed |
| `post_private_locations` | 1:1, owner + confirmed counterparty: exact point, street, house number, access notes |
| `post_media`, `post_actor_identity`, `post_additional_worlds` | Media rows; anonymity; secondary worlds |
| `post_handoffs` + `handoff_booking_details` | One closing stage for every type; housing dates / guests in the detail row |
| `post_ratings` | One two-sided rating for every type (D24), replaces three tables |
| `ride_series`, `ride_saved_routes`, `ride_route_alerts`, `post_emergencies` | Recurring rides, route alerts, emergency reports on a ride |
| `worlds`, `world_links`, `post_kinds`, `item_subcategories`, `external_bodies`, `world_rules` | Configuration; `post_kinds.detail_schema` is the JSON Schema for `posts.details` |
| `challenges`, `challenge_participations`, `challenge_progress_entries` | Unchanged |

`posts` columns: `id`, `owner_id`, `beneficiary_org_id`, `world_slug`, `kind_id`, `post_type`, `direction`, `status`, `status_before_removal`, `visibility`, `title`, `description`, `item_subcategory_id`, `details` (JSONB), `city_id`, `location_display_level`, `geo_approx`, `time_window`, `urgency_level`, `expires_at`, `source`, `source_language`, `search_vector`, `published_at`, `created_at`, `updated_at`.

Why a hybrid and not pure JSONB or a table per world:

| Option | For | Against |
| --- | --- | --- |
| Table per world | Strong typing | 14 worlds → 14 tables, feed and search become unions; every new world is a migration |
| Pure JSONB | Zero migrations | Rides need range queries on departure, seats arithmetic, exclusion of overlaps; housing needs date constraints — these need real columns, indexes and constraints |
| **Hybrid (chosen)** | Feed, search, RLS, FSM and matching run on one table; rides / housing / events / food get typed columns; a new low-structure world (animals, creative, environment) is configuration only | Two places to look; mitigated by one rule — a field is promoted to a detail table when a query filters or a constraint depends on it |

Removed from `posts`: `type`, `category`, `city`, `street`, `street_number`, `urgency`, `listing_id`, `legacy_listing_id`, `listing_world_slug`, `moderation_status`, `availability_status`, `feed_hidden`, counters, and ride keys duplicated inside `details`. Volunteering shifts become event posts (G18), so `volunteer_*` tables are not carried over (product call, §12).

### 3.3 Lifecycle state machines (enforced in the database)

The request named `draft, active, reserved, handed_over, closed, removed, restored`. The approved spec machine (S1, decisions D127–D131, 2026-11-09) uses other names and puts reservation on the handoff, not on the post. Proposal: **keep S1 as the post machine, add `draft`, and treat the rest as the handoff machine and derived availability.** Renaming S1 states is a product decision (§12, Q1).

| Requested term | Target representation |
| --- | --- |
| `draft` | `posts.status = 'draft'` (new; replaces `moderation_status = 'draft'`) |
| `active` | `open` (and `paused` for owner pause) |
| `reserved`, `handed_over` | `post_handoffs.status`; the post exposes derived `availability` (`available` / `reserved` / `taken`) from live handoffs and capacity |
| `closed` | `closed_delivered`, `deleted_no_recipient`, `expired` |
| `removed` | `hidden_pending_review` (automatic), `removed_admin` |
| `restored` | A transition, not a state: `removed_admin → status_before_removal` (D129) |

```
draft ─► open ◄─► paused
          │  ├─► closed_delivered ─► open (reopen)
          │  ├─► deleted_no_recipient ─► open (reopen)
          │  └─► expired            (republish = new post, D127)
 any live ─► hidden_pending_review ─► open | removed_admin
 any      ─► removed_admin ─► status_before_removal
```

Enforcement, the same for every machine (post, handoff per world, account, onboarding, report, follow request, comment, topic, payment, standing order):

1. Edges live in `kc_private.fsm_edge(machine_id, from_status, to_status, role)`; the domain package generates its TypeScript machines from the same seed file.
2. One generic `BEFORE UPDATE OF status` trigger calls `fsm_assert_transition`; a same-status write is a no-op.
3. Clients have **no `UPDATE` privilege on `status`**. Every move goes through a named RPC that states the actor role.
4. pgTAP walks every edge and every non-edge of every machine.

### 3.4 Social, feed, search

- `follows` (edges), `follow_requests`, `blocks`, `post_reactions`, `post_comments`, `post_comment_reactions`, `post_shares`, `saved_posts`, `post_stats` (counter row), `topics`, `topic_aliases`, `topic_follows`.
- Feed: `feed_impressions` (monthly partitions, 90-day retention), `feed_hides`, `feed_mute_filters`, `feed_ranking_config`.
- **One feed path**: candidates come from partial indexes on `posts`, ranked in a single SQL function, paged by keyset `(score_bucket, published_at, id)`. The materialized view, `user_feed_cache` and the pgmq feed queue are not carried over; a cache is reintroduced only if a measured p95 requires it.
- Search: `tsvector` (`simple` config) + trigram index for Hebrew substring matching, one `search_all` RPC.

### 3.5 Messaging

- `chats` + `chat_members(chat_id, user_id, last_read_at, hidden_at, role)` instead of `participant_a` / `participant_b` — group and organizer chats need no redesign, and unread counts become `messages.created_at > last_read_at` on one index.
- `messages` (`kind`: user / system / media; one check), `message_reactions`. Read state is per member, so `messages.status` is dropped (resolves the unused `delivered` state, state-machines §7 Q3).
- One anchor: `chats.anchor_post_id`.
- Index `messages(chat_id, created_at desc, id)`; partition by month only past roughly 100 M rows.

### 3.6 Notifications

- `kc_private.notification_outbox` (queue, 14-day TTL) and `public.notifications` (inbox, grouped, 180-day retention, monthly partitions).
- Delivery: outbox insert → `pgmq` → `dispatch-notification` function with visibility timeout. Replaces the every-minute retry cron and removes double sends.

### 3.7 Moderation, admin, audit

- `reports`, `report_hides`, `moderation_queue` (absorbs `operator_cases`), `user_sanctions` (history of suspensions and bans).
- `audit.events`: append-only, monthly partitions, written by every privileged RPC and by triggers on `user_account`, `admin_role_grants`, `posts.status` (admin edges), `billing.*`. No `UPDATE` / `DELETE` for any role, including the service role.
- Back-office tools (`admin_tasks`, `crm_contacts`, `timesheet_entries`) stay as-is in `kc_private` behind their RPCs.

### 3.8 Organizations and billing

- `organizations`, `org_memberships`, `org_applications`, `donation_links` in `public`.
- `billing`: `payment_providers`, `payment_methods`, `donation_intents`, `payments`, `refunds`, `payouts`, `standing_orders`, `receipts`, `kyc_profiles`, `webhook_events`, `ledger_entries` (double-entry, balanced per transaction by a deferred constraint trigger), `org_finance_entries`.
- One status vocabulary (state-machines §7 Q4). Idempotency keys unique per table. Card data never stored — provider tokens only.

### 3.9 Geo

- `cities`, `streets`, `road_junctions` with `geography(Point, 4326)` only (no parallel `lat` / `lng` floats) and GiST indexes.
- **Privacy**: the exact point lives only in `post_private_locations`. `posts.geo_approx` is derived by trigger from `location_display_level`: city centroid for `CityOnly`, street centroid for `CityAndStreet`, and for `FullAddress` a point snapped to a ~300 m grid with a per-post stable offset. Distance search, map pins and matching read `geo_approx` only. The exact address is released by RPC to the owner and to a counterparty with a confirmed handoff, and each release is audited.
- Indexes: GiST on `posts(geo_approx)` partial on `status = 'open'`; rides use GiST on origin and destination points in `post_ride_details`.
- Map clusters are computed server-side from `geo_approx` (`ST_SnapToGrid`), never from exact points.

### 3.10 Matching, AI, translation, integrations

- `kc_private`: `match_candidates`, `match_state`, `match_weights`, `matching_settings`, `embedding_jobs`; `public.post_embeddings` stays private-by-RLS with an HNSW index.
- Matching and embedding run from `pgmq` queues consumed by Edge Functions, not from `AFTER` triggers on `posts`.
- `content_translations` unchanged. Matching v1 tables are not carried over.
- `integrations`: the 22 WhatsApp / bot / ingestion tables, unchanged in shape, behind `api_*` RPCs granted to the service role only.

## 4. Security model

| Layer | Rule |
| --- | --- |
| Grants | `REVOKE ALL` from `anon`, `authenticated`, `PUBLIC` on every schema, then grant per table and per column what a policy can actually allow. Default privileges are altered so new objects start with none |
| RLS | Enabled and forced on every table in every schema. Policies name their role (`TO authenticated`), wrap `auth.uid()` as `(select auth.uid())`, and use at most one indexed `EXISTS` per policy |
| Functions | `SECURITY INVOKER` by default. `SECURITY DEFINER` only where a caller must cross RLS; each one pins `search_path = ''`, schema-qualifies every name, checks the caller first, and has an explicit `GRANT EXECUTE`. Trigger functions are never executable through the API |
| `anon` | A short, reviewed allow-list (public landing statistics, public research form, nonprofit public page). Everything else requires sign-in |
| Views | `security_invoker = true` only |
| PII | Private columns live in separate tables (§3.1, §3.2, §3.9); logs and audit rows store ids, never names, phones or message bodies |
| Secrets | Supabase Vault for anything the database must call out with; nothing in settings, tables or migrations |
| Storage | Every bucket has a size limit and a MIME allow-list; paths are `<user_id>/…`; private buckets for chat media and identity documents; EXIF stripped before a file becomes public |
| Abuse | One `kc_private.rate_limit` table and function used by every write RPC |
| Auth | Leaked-password protection on; Google and Apple providers; short-lived JWT |

### 4.1 Soft delete and account deletion (30 days)

1. Request: `user_account.status = 'pending_deletion'`, `deletion_purge_at = now() + 30 days`; sessions revoked; profile and posts hidden at once by RLS.
2. Within 30 days the member can restore; status returns to `status_before_deletion`.
3. Purge (daily job → `purge-deleted-accounts` function, idempotent): delete storage objects, then the `auth.users` row; cascade removes profile, private data, devices, follows, reactions, saved posts. Messages sent to others stay with `sender_id = null`; ratings and reports keep a null actor.
4. Retained for legal reasons: `billing.*` and receipts (statutory retention; retention period is an open question, §12 Q5) with the user reference replaced by a tombstone id; `audit.deletion_tombstones` (salted hash of the id, dates) proves the deletion.
5. Soft delete for content is a status (`deleted_no_recipient`, comment `deleted`), not a `deleted_at` column scattered across tables; hard delete of content follows the same purge job after its own grace period.

## 5. Performance model

| Topic | Decision |
| --- | --- |
| Pagination | Keyset on `(created_at desc, id desc)` or the ranking tuple everywhere; `OFFSET` stays banned (`check-sql-no-offset`) |
| Indexes | One per real query in §6 of the current-state report; every foreign key; partial indexes on `status = 'open'`; no duplicate or never-used index is carried over |
| Counters | `post_stats`, `user_stats` updated by statement-level triggers; nightly reconciliation job writes drift to `ops` |
| Trigger budget | `posts` keeps validation, FSM, `search_vector`, `geo_approx` and one outbox enqueue. Notifications, matching, embeddings, karma and activity logs consume the outbox asynchronously |
| Session start | One `bootstrap_session()` RPC returns account gate, private profile, unread counts, admin roles, legal and survey prompts — one round trip instead of nine |
| Policies | Visibility is decided by indexed columns and `EXISTS` on `follows` / `blocks`, not by a per-row function over the whole row |
| Partitioning | Only append-only logs: `feed_impressions`, `notifications`, `audit.events`, `notification_outbox` (monthly, `pg_partman`, retention by dropping partitions) |
| Realtime | **Broadcast only** (private channels with RLS on `realtime.messages`), emitted by triggers for chat messages, chat list, notifications, ride bookings. No table is added to `supabase_realtime`; `postgres_changes` is removed from the client |
| Connections | Clients through PostgREST; Edge Functions through the transaction pooler |
| Targets (to be verified by k6 on the baseline) | feed page p95 < 150 ms, post create p95 < 250 ms, chat send p95 < 100 ms at 5,000 concurrent users |

### 5.1 Speed layers (what makes the app feel fast)

Perceived speed is decided before a request reaches Postgres. The layers, outermost first:

| Layer | What it does | Status |
| --- | --- | --- |
| 1. Device cache | React Query with a persisted cache (already in the app): screens paint from the last known data, then refresh. Optimistic writes for reactions, saves, follows, chat send | Exists; the baseline keeps response shapes stable so the cache stays valid |
| 2. CDN | Images, thumbnails and video segments never touch the database or an Edge Function; immutable file names + long cache headers | Storage CDN now; see §5.2 |
| 3. Edge cache for public reads | Public, identical-for-everyone responses (landing statistics, nonprofit pages, reference lists, world configuration) served with `Cache-Control` and revalidated in the background | New |
| 4. One round trip per screen | A screen is one RPC returning everything it shows (feed page with author, counters, viewer state; `bootstrap_session`) — no per-row follow-up calls | New rule, enforced by perf budgets |
| 5. Indexed, keyset queries | §5 above | New |
| 6. Async everything else | Notifications, matching, embeddings, karma, media processing run from queues after the response is sent | New |
| 7. Read scaling | Supabase read replica for feed / search / map reads; primary for writes | Added when primary CPU stays above ~60 % |

### 5.2 Redis — where it fits and where it does not

**Not in the first baseline; a defined slot for it later.** A cache hides slow queries, it does not fix them, and every cached value that depends on the viewer (visibility, blocks, follows, anonymity) is a privacy bug waiting to happen when it goes stale.

| Need | First answer | Redis (Upstash, called from Edge Functions) when |
| --- | --- | --- |
| Feed page | Keyset query on partial indexes + device cache | p95 above 150 ms at real load — then cache **candidate post ids per world / city**, never per-viewer rows |
| Counters (reactions, unread) | Counter rows + Broadcast | Write contention on hot posts (viral post, live event) |
| Rate limiting | `kc_private.rate_limit` | Limits must hold before the request reaches the database (login, public endpoints under attack) |
| Presence, typing | Realtime Presence | — |
| Sessions | Supabase Auth JWT (stateless) | — |
| Public reads | Edge cache (layer 3) | — |

The outbox and the "one RPC per screen" rule are what make this pluggable: a cache can be put in front of any read RPC without a schema change.

### 5.3 Media (images now, video later)

| Topic | Decision |
| --- | --- |
| Storage of files | Never in Postgres. The database holds one `post_media` row per file: owner, kind, storage key, width, height, duration, blurhash, processing status |
| Upload | Direct from the device to storage with a signed, resumable upload (TUS); the API only issues the permission and records the row. Client compresses and resizes before upload |
| Images | Fixed variants (thumbnail, feed, full) generated once on upload, immutable names, served from the CDN; `blurhash` in the row so the feed never jumps while loading |
| Video | **Not through Supabase Storage.** A dedicated video service (Cloudflare Stream or Mux) transcodes to adaptive HLS and serves from its own CDN; the database stores the provider asset id and status. Chosen when video is specified (§12 Q8) |
| Safety | EXIF stripped before a file is public; MIME and size limits per bucket; private media served by short-lived signed URLs; a moderation hook on `processing_status` before a file becomes visible |
| Cleanup | Orphan reconciliation job; account purge deletes files first (§4.1) |
| Growth | Media bytes scale in object storage and CDN, independent of the database — the database row is ~200 bytes whether the file is 50 KB or 500 MB |

## 6. Operations

- **Backups**: PITR on kc-prod (7-day window minimum), daily logical dump to private storage before every deploy (existing Deploy step), a restore drill into a scratch project each quarter.
- **Migrations**: after the baseline, forward-only numbered files; destructive SQL keeps the existing `migration-safety` gate; expand → backfill → contract for every breaking change.
- **Environments**: kc-prod and kc-dev are built from the same baseline. Seed and demo data live in `supabase/seed/` and run only against kc-dev and local; no seed, demo or `dev_*` object exists in the schema.
- **Typed client**: `database.types.ts` is generated from the baseline in CI and the build fails on drift.
- **Checks in CI**: baseline applies on an empty database; pgTAP suite; schema diff between the declared schema and kc-dev; Supabase advisors with zero errors; RPC grant allow-list.
- **Monitoring**: `ops.health_checks`, failed-job alert, queue depth alert, slow-statement report from `pg_stat_statements`.

## 7. Separate services — recommendation

**Stay a modular monolith: Postgres + Edge Functions.** Nothing measured needs its own service.

| Candidate | Decision | Revisit when |
| --- | --- | --- |
| Push / WhatsApp delivery | Edge Functions consuming `pgmq` | Sustained backlog over one minute |
| Embeddings and LLM rerank | Edge Functions; vectors in `pgvector` | Over ~5 M vectors or recall problems |
| Search | Postgres FTS + trigram | Typo tolerance or ranking needs exceed FTS; then a search engine fed from the outbox |
| Images | Supabase Storage + CDN, variants generated on upload (§5.3) | CDN egress cost → move the bucket to R2 behind the same keys |
| Analytics | PostHog (already integrated); no analytics tables in the product database | — |
| Payments | Provider-hosted checkout; database holds the ledger only | — |
| Feed ranking | SQL function | Model-based ranking → a ranking worker writing scores back |
| Cache (Redis) | Not at launch; slot defined in §5.2 | A measured p95 or contention trigger in §5.2 |
| Video | External video service from day one of the feature (§5.3) | — |

The outbox is the seam: any of these can leave Postgres later without touching the write path.

## 8. Old → new mapping

| Old object | New object |
| --- | --- |
| `users` (46 columns) | `users`, `user_private`, `user_account`, `user_stats` |
| `auth_identities` | dropped (`auth.identities`) |
| `devices` | `user_devices` |
| `user_legal_acceptances`, `driver_declarations`, `housing_conduct_acceptances` | `user_consents` |
| `posts.type`, `category`, `city`, `street`, `street_number`, `urgency` | `direction`, `item_subcategory_id`, `city_id`, `post_private_locations`, `urgency_level` |
| `posts.listing_id`, `legacy_listing_id`, `listing_world_slug` | dropped |
| `posts.moderation_status`, `availability_status`, `feed_hidden` | `status` (`draft`, `hidden_pending_review`), derived availability |
| views `listings`, `ride_listings`, `giving_handoffs` | dropped; code reads `posts` / `post_handoffs` |
| `ride_post_details`, `event_post_details`, `housing_private_details`, `ride_listing_house_numbers` | `post_ride_details`, `post_event_details`, `post_private_locations` |
| `housing_booking_details` | `handoff_booking_details` |
| `media_assets`, `listing_media` | `post_media` |
| `listing_worlds` | `post_additional_worlds` |
| `listing_kinds`, `categories`, `donation_categories`, `marketplace_rules` + `_params` | `post_kinds`, `item_subcategories`, `donation_link_categories`, `world_rules` |
| `recipients` | `post_handoffs` |
| `giving_handoff_ratings`, `ride_ratings`, `match_feedback` | `post_ratings` |
| `ride_templates`, `ride_participants`, `ride_stops`, `ride_emergency_events` | dropped (`ride_series`, `post_handoffs`, `post_emergencies`) |
| `ride_listing_emergencies` | `post_emergencies` |
| `volunteer_opportunities`, `volunteer_shifts`, `volunteer_shift_signups` | event posts + `post_event_details` + `post_handoffs` |
| `follow_edges` | `follows` |
| `knowledge_topics`, `_aliases`, `_follows` | `topics`, `topic_aliases`, `topic_follows` |
| `chats.participant_a/b`, `inbox_hidden_at_a/b`, `anchor_ride_id`, `anchor_listing_id` | `chat_members`, `chats.anchor_post_id` |
| `messages.status`, `delivered_at`, `read_at` | `chat_members.last_read_at` |
| `notifications_outbox` | `kc_private.notification_outbox` + queue |
| `notification_inbox` | `notifications` |
| `operator_cases`, `operator_case_events`, `moderation_queue_entries` | `moderation_queue` |
| `audit_events` | `audit.events` |
| `payments`, `payment_*`, `donation_intents`, `donation_receipts`, `standing_orders`, `payer_kyc_profiles`, `provider_webhook_events`, `finance_*` | `billing.*` |
| `match_*`, `matching_settings`, `embedding_jobs`, `rate_limit_buckets`, `fsm_*` | `kc_private.*` |
| `whatsapp_*`, `bot_*`, `ingestion_*`, `raw_records`, `extractions`, `field_provenance`, `entity_*`, `er_candidates` | `integrations.*` |
| `match_runs`, `listing_matches`, `claim_requests`, `marketplace_actors`, `listing_feed_posts`, `listing_user_signals`, `profile_enrichments`, `closure_cleanup_metrics`, `user_feed_cache`, `feed_mv_refresh_state`, `feed_open_posts_mv`, `social_rpc_explain_snapshots`, `kc_dev_*` | not carried over |
| 48 unreferenced functions, 31 detached trigger functions, demo seed / wipe RPCs | not carried over |
| `supabase_realtime` publication tables | Broadcast channels |

## 9. Application changes required

All database access is in `packages/infrastructure-supabase` and `supabase/functions`; ports in `packages/application` change only where a field moves.

| Area | Change |
| --- | --- |
| Users adapter, auth gate | Read `user_private` / `user_account` / `user_stats`; replace nine start-up calls with `bootstrap_session` |
| Posts adapter, search, mobile direct queries | Column renames (`direction`, `item_subcategory_id`, `city_id`); address through the private-location RPC |
| Marketplace and rides adapters | Stop reading `listings` / `ride_listings`; remove legacy ride tables and `rpc_ride_start` / `rpc_ride_arrive` |
| Chat adapter | `chat_members`; unread from `last_read_at`; Broadcast for message and list updates |
| Realtime module | Remove every `postgres_changes` subscription; subscribe to private Broadcast topics |
| Notifications | Table rename; device table rename |
| Volunteering | Use event posts (if Q3 is approved) |
| Ratings | One `post_ratings` RPC pair |
| Edge Functions | `dispatch-notification`, `embed-worker`, `match-rerank` consume queues; billing functions use the `billing` schema; `mock-login` and demo seeding move to dev-only seed scripts |
| Domain package | FSM machines generated from the shared edge seed; `AccountStatus`, post status and handoff status lists follow |
| Generated types, RPC contract allow-list, SQL tests | Regenerated against the baseline |

## 10. Source layout and delivery (Phase 3 outline)

```
supabase/schemas/            authored source, one folder per module, files ≤ 300 lines
  00_extensions.sql  01_schemas_roles.sql  10_identity/…  20_posts/…  30_social/…
  40_messaging/…  50_notifications/…  60_moderation/…  70_billing/…  80_geo/…  90_integrations/…
supabase/migrations/1000_baseline.sql   generated by concatenation; CI fails if it differs from the source
supabase/migrations/archive/            the 543 old files, read-only
supabase/seed/                          reference data (cities, streets, worlds) + dev-only demo data
supabase/tests/                         pgTAP: RLS matrix per table and role, every FSM edge, grants allow-list
```

Small PRs to `dev`, in order: (1) tooling — assembler, CI job that applies the baseline to an empty database; (2) identity; (3) posts + FSM + geo; (4) social + feed + search; (5) messaging + notifications + Realtime; (6) moderation + audit; (7) billing; (8) integrations; (9) adapters and Edge Functions per module behind the same ports; (10) cut-over: rebuild kc-dev from the baseline (approval required), archive old migrations; (11) kc-prod apply after explicit approval and a backup.

Validation order for every step: local / branch database → kc-dev → kc-prod.

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Re-authoring ~313 live RPCs introduces regressions | Module-by-module PRs; existing 191 SQL tests and contract tests ported with each module; RPC names kept unless listed in §8 |
| Feature work continues on the old chain during the rebuild | Freeze window per module; a migration added to the old chain must add the same change to `supabase/schemas` (CI check) |
| kc-dev rebuild wipes test data | It is test data; seed scripts recreate demo content; done once, with PM approval |
| Design assumptions about load are wrong | k6 against the baseline before the kc-prod apply |

## 12. Decisions (PM, 2026-11-10)

| # | Question | Decision |
| --- | --- | --- |
| Q1 | Post state names | Left to engineering: **keep the S1 names and add `draft`** (§3.3) — no spec or app churn |
| Q2 | Physical schemas as in §2.1 | **Approved** |
| Q3 | Volunteering | **Approved**: folded into event posts (G18); the `volunteer_*` tables are not carried over |
| Q4 | WhatsApp bot and ingestion | Not in the launch baseline, **but designed for now**: the `integrations` schema, `posts.source = 'imported'`, the outbox and the service-role `api_*` contract are part of the baseline, so the module lands later as one additive migration with no change to existing tables |
| Q5 | Retention of billing records and receipts after account deletion | **Open — needs legal advice.** Until answered the baseline keeps these rows with a tombstone reference and no automatic purge; the period becomes a single setting in `billing` |
| Q6 | Rebuild kc-dev from the baseline at cut-over | **Approved** |
| Q7 | Non-KC schema in kc-dev | **Approved to remove.** Not yet executed: it is still being written to and one of its functions is callable by the auth service, so removal waits for the confirmation step in `AGENTS.md` §7 |
| Q8 | Video provider and maximum clip length | Decided when video is specified; `post_media` already supports it |

Recorded as `D-228` in [`docs/SSOT/DECISIONS.md`](../SSOT/DECISIONS.md). Phase 3 starts with step (1) of §10.
