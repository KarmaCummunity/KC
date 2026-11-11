# Database — current state (kc-dev, read 2026-11-10)

> Phase 1 of the production-database rebuild. **Read-only discovery**: nothing was written to any database.
> Companion: [`target-design.md`](./target-design.md) (Phase 2, awaiting PM approval).

## 0. Method and limits

| Source | What was read |
| --- | --- |
| kc-dev (`enbqriuxvvuontiwslun`) Postgres 17 catalog | tables, columns, constraints, indexes, policies, functions, triggers, views, enums, buckets, cron, publications, `pg_stat_statements`, `pg_stat_user_*`, Supabase advisors |
| kc-prod (`kdqtbdbzwvlugkhonexg`) catalog | object counts only |
| Repo at `dev` (`b43fcbb3`, app 1.8.27) | `supabase/migrations` (543 files, 153,506 lines, `0001`…`0702`), `supabase/functions` (20), `app/packages/infrastructure-supabase`, `app/apps/mobile` |

Limits, stated once:

- **Code usage is a static scan**: `.from('x')` / `.rpc('x')` literals plus every string literal equal to a function name. A name built at runtime would be missed; none was found.
- **Runtime statistics are dev traffic** (E2E, seeding, a handful of testers) since the stats reset of 2026-10-02. They show shape, not production load.
- "Unreferenced" means: not in app or Edge Function code, not attached as a trigger, not in a policy, view, default, check, index or cron command, and not called by another function.
- Security findings are listed here by **category and count only**. The itemized list is handed to the PM privately (`CLAUDE.md` §7).

## 1. Headline facts

1. **kc-prod is empty**: 0 tables and 0 functions in `public`, no buckets, no migration history table, 1 auth user. A baseline can be applied there with no data migration.
2. **kc-dev `public`**: 164 tables (+1 partitioned parent with 4 children), 12 views, 1 materialized view (`kc_private`), 730 functions (591 `SECURITY DEFINER`), 252 RLS policies, 455 indexes, 28 cron jobs, 4 storage buckets, 2 enums.
3. **RLS is enabled on every `public` table.** No table is unprotected.
4. **`posts` is already the single content table** for every giving world (ADR-006). `listings`, `ride_listings` and `giving_handoffs` are compatibility views over `posts` / `post_handoffs`.
5. **Test data only**: 209 users, 866 posts, 885 messages, 151 chats, 35 storage objects. Database size 361 MB, of which under 40 MB is KC product data.
6. **kc-dev also holds a schema that is not KC** (59 tables, about 170 MB, never referenced by this repo). It is out of scope for the baseline and must never reach kc-prod. Details were given to the PM privately.
7. **Two scheduled jobs are failing continuously** (§7.1): the feed-cache worker (288 of 288 runs in 24 h) and the notification retry (512 of 1,440).

## 2. Entities by domain

Access column: **direct** = PostgREST table access from the named module; **RPC** = reached only through functions; **none** = no code path found. Row counts are kc-dev estimates.

### 2.1 Identity and access

| Table | Rows | Access | Notes |
| --- | --- | --- | --- |
| `users` (46 cols, 11 triggers) | 209 | direct: infra `users`, `posts`, `chat`, `search`; mobile; fn `mock-login`, `dispatch-notification`, `validate-donation-link` | Profile, privacy, account status, onboarding, 9 denormalized counters, karma, address, phone, date of birth, deletion grace — all in one row |
| `auth_identities` | 209 | RPC / trigger | Duplicates `auth.identities` |
| `devices` | 1 | direct: infra `notifications`; fn `dispatch-notification` | Push tokens |
| `admin_role_grants` | 11 | direct: fn `mock-login`; RPC | Role hierarchy with manager links |
| `user_legal_acceptances`, `legal_documents`, `legal_document_versions` | 0 / 2 / 2 | direct: infra `legal`; RPC | Append-only by trigger |
| `driver_declarations`, `housing_conduct_acceptances` | 66 / 202 | direct: infra `rides`, `housing` | Per-world consents |
| `user_entitlements` | 0 | RPC (fn `revenuecat-webhook`) | Pro tier |
| `user_active_days`, `user_geo_prefs`, `profile_enrichments` | 22 / 0 / 0 | RPC | `profile_enrichments` has no reader |
| `about_team_members` | 0 | view `about_team_profiles` (infra `about`) | |

### 2.2 Giving content (marketplace)

| Table | Rows | Access | Notes |
| --- | --- | --- | --- |
| `posts` (44 cols, 16 indexes, 47 triggers) | 866 | direct: infra `posts`, `search`; mobile; views `listings`, `ride_listings`, `feed_visible_posts`; most RPCs | See §3.1 |
| `media_assets` | 114 | direct: infra `posts`; fn `reconcile-storage-orphans` | |
| `post_actor_identity` | 1 | direct: infra `posts` | Anonymity per post |
| `post_handoffs` (6 triggers) | 2 | direct: infra `marketplace`; RPC | One table for reservations, ride bookings, housing bookings, event registrations, knowledge sessions |
| `housing_booking_details`, `housing_private_details`, `event_post_details`, `ride_post_details` | 0 / 0 / 0 / 126 | RPC | 1:1 detail tables |
| `ride_series`, `ride_saved_routes`, `ride_route_alerts`, `ride_listing_house_numbers`, `ride_listing_emergencies` | 0 | direct (`ride_series`, `ride_saved_routes`) / RPC | Current ride model |
| `ride_templates`, `ride_participants`, `ride_stops`, `ride_ratings`, `ride_emergency_events` | 0 | direct: infra `rides` | **Legacy ride model**, cron retired in `0695`; code still imports it |
| `recipients` (6 triggers) | 86 | RPC | **Legacy closure**; superseded by `post_handoffs` |
| `giving_handoff_ratings` | 1 | RPC | One of three rating tables |
| `worlds`, `world_links`, `listing_kinds`, `categories`, `external_bodies`, `marketplace_rules`, `marketplace_rule_params`, `donation_categories` | 14 / 12 / 34 / 90 / 10 / 17 / 9 / 11 | direct: infra `marketplace` (`categories`, `listing_kinds`); RPC | Catalog / configuration |
| `listing_media`, `listing_worlds`, `listing_feed_posts`, `listing_matches`, `claim_requests`, `marketplace_actors`, `listing_user_signals` | 0 (signals: 14) | RPC or none | **Leftovers of the retired `listings` table** |
| `volunteer_opportunities`, `volunteer_shifts`, `volunteer_shift_signups` | 0 | RPC | Parallel to `event_post_details` (see §4) |
| `challenges`, `challenge_participations`, `challenge_progress_entries` | 9 / 10 / 2 | RPC | Each challenge also owns a `posts` row |

### 2.3 Social, feed, search

| Table | Rows | Access | Notes |
| --- | --- | --- | --- |
| `follow_edges` (7 triggers), `follow_requests`, `blocks` | 1,467 / 0 / 4 | direct: infra `users`, `posts`, `blocks` | |
| `post_reactions`, `post_comments` (9 triggers), `post_comment_reactions`, `post_shares`, `post_stats`, `saved_posts` | 4 / 7 / 2 / 0 / 866 / 400 | direct: infra `posts`; RPC | `post_stats` is a counter row per post |
| `feed_impressions` (monthly partitions), `feed_post_hides`, `feed_mute_filters`, `feed_ranking_config` | 1,521 / 0 / 1 / 5 | RPC | |
| `user_feed_cache`, `feed_mv_refresh_state`, `kc_private.feed_open_posts_mv`, queue `pgmq.q_feed_cache_refresh` | 2 / 1 / — / 308,900 | RPC / cron | Three caching layers for one feed (§7.1) |
| `search_hashtags` | 10 | RPC | |
| `knowledge_topics`, `knowledge_topic_aliases`, `knowledge_topic_follows` | 56 / 78 / 0 | direct: infra `knowledge` | |

### 2.4 Messaging and notifications

| Table | Rows | Access | Notes |
| --- | --- | --- | --- |
| `chats` | 151 | direct: infra `chat`, `posts` | Two-participant model (`participant_a` / `participant_b`), three anchor columns |
| `messages` (9 triggers), `message_reactions` | 885 / 1 | direct: infra `chat` | |
| `kc_support_channels` | 2 | RPC | |
| `notifications_outbox` | 2,482 | direct: fn `dispatch-notification` | Push queue, retried by cron every minute |
| `notification_inbox` | 2,485 | RPC | In-app inbox with grouping |

### 2.5 Moderation, admin, audit

| Table | Rows | Access | Notes |
| --- | --- | --- | --- |
| `reports` (7 triggers), `reporter_hides`, `moderation_queue_entries` | 2 / 2 / 0 | direct: infra `reports`; RPC | |
| `operator_cases`, `operator_case_events` | 39 / 39 | RPC | Only `open` is ever written |
| `audit_events` | 57 | RPC | Admin actions only |
| `admin_tasks`, `admin_task_activities`, `crm_contacts`, `timesheet_entries`, `user_feedback`, `user_personal_activity_log` | 1 / 1 / 0 / 0 / 0 / 962 | RPC (`user_feedback` direct: infra `survey`) | Back-office tools living in the product schema |

### 2.6 Organizations and money

| Table | Rows | Access | Notes |
| --- | --- | --- | --- |
| `organizations`, `org_memberships`, `org_applications` | 2 / 0 / 0 | direct: infra `marketplace` (`org_memberships`); RPC | |
| `donation_links` | 86 | direct: infra `donations`, `search`; fn `validate-donation-link` | |
| `donation_intents`, `payments`, `payment_methods`, `payment_refunds`, `payment_payouts`, `payment_providers`, `payment_ledger_entries`, `payment_recipients_kyc`, `payer_kyc_profiles`, `donation_receipts`, `standing_orders`, `provider_webhook_events` | 0 (providers: 1) | RPC; fn `payments-webhook`, `receipts-issuer`, `subscriptions-charger` | Sandbox only (`sandbox_payments` flag) |
| `finance_accounts`, `finance_ledger_entries` | 3 / 0 | RPC | Org bookkeeping; a second ledger beside `payment_ledger_entries` |
| `karma_ledger`, `karma_recompute_runs`, `karma_drift_events`, `stats_recompute_runs`, `stats_drift_events` | 2,441 / 24 / 0 / 0 / 0 | direct: mobile (`karma_ledger`); RPC | |

### 2.7 Matching, AI, translation

| Table | Rows | Access | Notes |
| --- | --- | --- | --- |
| `match_candidates` (10 indexes) | 1,053 | RPC; fn `match-rerank` | Matching v2 |
| `match_listing_state`, `match_weights`, `matching_settings`, `match_alert_subscriptions`, `match_feedback` | 716 / 13 / 1 / 0 / 0 | RPC | |
| `match_runs`, `listing_matches` | 0 | none | Matching v1 remains |
| `embedding_jobs`, `post_embeddings` | 849 / 0 | RPC; fn `embed-worker` | 849 jobs, no stored embedding |
| `content_translations` | 0 | direct: infra `translations`; fn `translate` | |

### 2.8 WhatsApp bot and ingestion

`whatsapp_identities`, `whatsapp_link_codes`, `whatsapp_link_failures`, `whatsapp_consent_events`, `whatsapp_match_consent`, `whatsapp_inbound_claims`, `whatsapp_rate_counters`, `whatsapp_send_limits`, `whatsapp_message_templates`, `whatsapp_channel_config`, `bot_conversation_sessions`, `bot_outbound_messages`, `bot_match_responses`, `bot_admin_review_items`, `ingestion_sources`, `ingestion_runs`, `raw_records`, `extractions`, `field_provenance`, `entity_aliases`, `entity_merges`, `er_candidates` — 22 tables, all empty or configuration-only, reached through `api_whatsapp_*` / `api_bot_*` RPCs from the three `whatsapp-*` functions.

### 2.9 Reference, research, platform

| Table | Rows | Access |
| --- | --- | --- |
| `cities`, `streets`, `road_junctions` | 1,307 / 63,565 / 449 | direct: infra `cities`, `streets`, `rides`; RPC |
| `surveys`, `survey_versions`, `survey_questions`, `survey_answers`, `public_research_responses`, `public_research_contact_requests`, `research_secrets` | 3 / 3 / 8 / 9 / 0 / 0 / 1 | RPC; fn `public-research-submit`, `rotate-research-salt` |
| `app_flags`, `fsm_state`, `fsm_edge`, `rate_limit_buckets` | 16 / 46 / 92 / 27 | direct: mobile (`app_flags`); RPC |
| `closure_cleanup_metrics`, `social_rpc_explain_snapshots`, `kc_dev_demo_config`, `kc_dev_demo_operation_state`, `ops.health_checks` | — | Dev and ops tooling inside the product database |

### 2.10 Other objects

- **Views**: `listings`, `ride_listings`, `giving_handoffs` (compatibility), `feed_visible_posts`, `users_public`, `user_ride_rating_summary`, `user_legal_acceptances_latest` (all `security_invoker`); `community_stats`, `about_team_profiles`, `marketplace_listing_card`, `listing_owner_trust_score`, `giving_user_trust_score` (owner-rights views).
- **Buckets**: `avatars`, `post-images`, `listing-images` (public), `chat-media` (private). `listing-images` has no size or MIME limit.
- **Realtime**: publication `supabase_realtime` carries `users`, `chats`, `ride_participants`. Broadcast (`realtime.messages`) is used by feed and chat triggers.
- **Cron**: 28 jobs — 12 sweeps for expiry / bookings / no-show, 5 notification jobs, 3 feed jobs, 3 Edge Function callers (purge accounts, storage orphans, EXIF strip), karma recompute, retention purges, one dev-only cleanup.
- **Extensions in use**: `postgis`, `pg_trgm`, `vector`, `pg_cron`, `pg_net`, `pgmq`, `pg_partman`, `pg_jsonschema`, `pgcrypto`, `pgtap`, `pg_stat_statements`.

## 3. Structural findings

### 3.1 `posts` carries two generations of columns

| Concept | Old column(s) | New column(s) | State |
| --- | --- | --- | --- |
| Offer or request | `type` (`Give` / `Request`) | `direction` (`offer` / `request`) | Both required, tied by a check |
| Item subcategory | `category` (10 fixed values, NOT NULL) | `category_id` → `categories` | Both; `category` is meaningless outside the items world |
| Location | `city`, `street`, `street_number` (NOT NULL text) | `geo` geography point | Both; `geo` has **no spatial index** |
| Urgency | `urgency` (free text) | `urgency_level` (1–3) | Both |
| Listing link | `listing_id`, `legacy_listing_id`, `listing_world_slug` | `world_slug`, `kind_id` | Three link columns to a table that no longer exists |
| Per-world fields | — | `details` JSONB + `ride_post_details` (29 cols) | Ride fields exist in both `details` and the detail table |
| Visibility of state | `status` (7), `moderation_status` (4), `availability_status` (3), `feed_hidden` | — | Four columns describe "can this be seen and taken" |

47 triggers fire on `posts`: world-rule guards (rides, housing, food, events), counter / karma / activity writers, notification and broadcast emitters, embedding / matching / operator enqueuers, translation purges, and the FSM. A single insert measured 1.1 s mean on kc-dev (25 calls); `create_marketplace_listing` 785 ms (80 calls).

### 3.2 Duplicated concepts

| Concept | Copies |
| --- | --- |
| Rating | `giving_handoff_ratings`, `ride_ratings`, `match_feedback` (target: one `post_ratings`, D24) |
| Closing a post with a recipient | `recipients` (legacy) and `post_handoffs` |
| Recurring ride | `ride_templates` and `ride_series` |
| Ride emergency | `ride_emergency_events` and `ride_listing_emergencies` |
| Volunteering event | `volunteer_opportunities` + shifts + signups, and `event_post_details` + `post_handoffs` |
| Category list | `posts.category` check, `categories`, `donation_categories`, `listing_kinds` |
| Ledger | `payment_ledger_entries`, `finance_ledger_entries`, `karma_ledger` (three shapes) |
| Rate limiting | `rate_limit_buckets`, `whatsapp_rate_counters`, the `posts_rate_limit` trigger |
| Activity / audit trail | `audit_events`, `admin_task_activities`, `operator_case_events`, `user_personal_activity_log` |
| Matching | v1 (`listing_matches`, `match_runs`) and v2 (`match_candidates`) |
| Feed cache | materialized view, `user_feed_cache`, pgmq queue |
| Identity link | `auth_identities` and `auth.identities` |
| Message kind check | `messages_kind_check` (user, system) and `messages_kind_chk` (user, system, media) both exist; together they reject `media` |
| Status vocabulary | 63 `text` status / kind / role / direction columns, each with its own check; 10 machines are in the FSM kernel, the rest are not |

### 3.3 Dead or legacy objects

- **Functions**: 48 non-trigger functions are unreferenced (24 of them executable by signed-in users), among them the v1 bot review, entity-merge, share-log and volunteer-publish functions; 31 trigger functions are attached to nothing (the `listings_*` and `ride_listings_*` families left by `0667`).
- **Tables with no reader**: `match_runs`, `listing_matches`, `claim_requests`, `marketplace_actors`, `listing_media`, `listing_worlds`, `listing_feed_posts`, `profile_enrichments`, `closure_cleanup_metrics`.
- **Legacy still imported by code**: `ride_templates`, `ride_participants`, `ride_stops`, `ride_ratings`, `ride_emergency_events`, the `listings` and `ride_listings` views, `rpc_ride_start` / `rpc_ride_arrive` (write a status the post machine forbids).
- **Dev tooling in the product schema**: `kc_dev_*` tables and functions, demo seed / wipe RPCs (one seed call averaged 80 s), explain-snapshot tooling, `rpc_dev_reset_onboarding`, mock identity verification.
- **Indexes**: 73 of 455 were never scanned; 8 exact duplicates (for example `follow_edges_pkey` = `follow_edges_follower_followed_idx`).

## 4. Security posture (categories only)

| Category | Count |
| --- | --- |
| Tables without RLS in `public` | 0 |
| Policies | 252; 139 call `auth.uid()` per row instead of once per statement; 82 are granted to every role instead of a named one |
| `SECURITY DEFINER` functions | 591 of 730 — all pin `search_path`; advisor flags 276 as callable by signed-in users and 31 as callable without sign-in |
| Functions with a mutable `search_path` | 53 (advisor) |
| Owner-rights views | 5 (advisor level: error) |
| Table privileges | Supabase default grants are still in place: access is decided by RLS alone, not by grants |
| Trigger functions callable through the API | present (trigger functions keep default `EXECUTE`) |
| Auth settings | leaked-password protection is off |
| Secrets | Vault is empty; Edge Function callers in cron read a database setting |
| PII in one row | phone, date of birth, street address and push preferences sit in `users` beside public profile fields; column privacy depends on a view and a self-only RPC |
| Storage | one public bucket without size / MIME limits |

## 5. Indexes and query shape

- **Missing**: no GiST index on `posts.geo` (map, radius and matching queries); 113 foreign keys without a covering index, including `posts(category_id)`, `posts(kind_id)`, `post_comments(author_id)`, `saved_posts(post_id)`, `feed_impressions(post_id)`, `notification_inbox(outbox_id)`, `payments(user_id)`.
- **Sequential scans** (dev): `match_candidates` — 1.0 billion tuples read over 822 k scans of a 1,053-row table; `posts` 130 M; `feed_impressions` 32 M; `feed_ranking_config` read 313 k times.
- **Coordinates as two floats** instead of geography: `ride_post_details`, `ride_saved_routes`, `road_junctions`, `ride_emergency_events`.

## 6. Hot paths (kc-dev `pg_stat_statements`, API roles)

| Statement | Calls | Mean | Note |
| --- | --- | --- | --- |
| `recommend_listings_for_user` | 3,268 | 428 ms | Largest API cost |
| `feed_visible_posts` (view + embeds) | 8,525 | 147 ms | Per-row filter function |
| `rpc_my_matches` | 2,220 | 224 ms | |
| `rpc_feed_log_impressions` | 5,434 | 77 ms | Write on every scroll |
| `get_marketplace_listing_detail` | 591 | 297 ms | |
| `browse_listings`, `list_rides_feed`, `reports_open_inbox` | 507 / 223 / 238 | 281 / 260 / 292 ms | |

**Session-start fan-out** (inferred from call counts, not traced). Nine separate calls run at session scale: `auth_check_account_gate`, `users_get_self_private_fields`, `needs_legal_reacknowledgement`, `check_survey_prompt_eligibility`, `rpc_chat_unread_total`, `rpc_notification_inbox_unread_count`, `get_my_admin_roles`, `rpc_record_active_day`, `community_stats` (30–60 ms each; 4.5 k–14 k calls each).

**Realtime.** WAL polling for `postgres_changes` is the largest single consumer of database time (23 %). The client subscribes to `postgres_changes` on `blocks`, `saved_posts`, `messages`, `devices`, `ride_listings` and `community_stats`, none of which is in the publication (two are views) — those subscriptions receive nothing.

## 7. Operations

### 7.1 Failing jobs (last 24 h)

| Job | Failed / runs | Effect |
| --- | --- | --- |
| `feed_cache_worker` | 288 / 288 | Queue `q_feed_cache_refresh` holds 308,900 messages (105 distinct payloads, oldest 2026-10-27) and grows; 61 MB |
| `notifications_retry_pending` | 512 / 1,440 | Push retries fail a third of the time |
| `feed_open_posts_mv_if_dirty` | 6 / 720 | |

### 7.2 Migration chain

- 543 files, numbered `0001`–`0702` with gaps; kc-dev history matches (543 rows).
- A fresh database needs the full chain replayed: 153 k lines, most of them superseded (`create or replace` of the same function many times; 756 distinct function names defined, 730 alive).
- Seed and demo data are created by RPCs inside the schema, not by seed files alone.

## 8. What this means for the baseline

1. No production data exists, so the baseline is a **design decision, not a migration problem**.
2. The live contract is narrower than the schema: 53 tables / views read directly and about 313 functions referenced by code, against 164 tables and 730 functions.
3. The unified `posts` model is the right base and is already live; the baseline finishes it by dropping the first-generation columns, the compatibility views and the legacy ride / listing satellites.
4. Runtime cost is concentrated in trigger fan-out on `posts`, per-row policy functions, the feed cache and Realtime polling — all addressable in the design, none needing a separate service.
