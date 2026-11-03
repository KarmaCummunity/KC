# Matching v2 — automatic offer↔request matching (migrations 0420–0427)

KC core goal #2: pair open **offers** (`direction='give'`) with open **requests** inside the same
world (items, food, rides, time, knowledge) automatically, and surface them in-app and on WhatsApp.

## Pipeline

| Stage | Where | Notes |
|---|---|---|
| Write trigger | `listings_match_v2` → `match_on_listing_write` | On insert / relevant update of an open, published listing: `match_compute_for_listing` + `match_deliver_pending(50, listing)`. Errors are swallowed into `match_listing_state.last_error`; a listing write never fails because of matching. Closing a listing expires its suggested pairs. |
| Sweep | pg_cron `matching_v2_sweep` every 10 min → `match_run_sweep` | Expires pairs of closed/expired listings, (re)computes missing/stale listings (`recompute_after_hours`), then delivers. |
| Candidates | `match_compute_for_listing` | Same world, opposite direction, open + published, anonymity > 1, unexpired; PostGIS pre-filter (`st_dwithin`, world radius ×2, ≥30 km; none for remote/rides); cheap pre-score keeps the top `max(3N, 30)`; full `match_score_pair` on those; keeps top `max_candidates_per_listing` with score ≥ `min_score`. Idempotent upsert into `match_candidates (offer, request)`; never touches answered rows. |
| Scoring | `match_score_pair` | Hard filters: world/direction/owner/open, inactive owner, visibility both ways (`is_listing_visible_to` → blocks, privacy), feed mutes both ways (user/world/category/keyword/hidden post), owners declined before, rides seats, category mismatch, too far, time mismatch. Components (weights per world in `matching_settings.weights`): category (tree), geo (`effective_geo` radius; rides origin+destination corridor ≤25 km), time (windows overlap; rides departure ≤6 h), text (pg_trgm), trust (`combined_trust_score` + verified bonus; ×0.6 for unverified offers in `requires_verification` worlds), feedback (owners' accept/decline history). |
| Delivery | `match_deliver_pending` | Pairs with score ≥ `notify_min_score`, fresh (`notify_max_age_hours`). Per side: once, skip if answered, quiet hours (user `quietHours` pref, else platform 22:00–08:00 Asia/Jerusalem) → deferred, daily cap `max_notify_per_user_day`, and the user's per-type opt-out (`notification_preferences.kinds.match_suggested = false` → side settled as `opted_out`, nothing sent, not counted toward the cap — FR-NOTIF-017, `0460`). In-app: `enqueue_notification` kind `match_suggested` (push + inbox). WhatsApp: `match_found_v1` via `api_whatsapp_queue_outbound` (#963) only when the channel is enabled and the user can receive (#957 opt-in / STOP); otherwise records `skipped_channel_disabled` / `skipped_no_consent` and writes nothing to the outbound queue. |
| Response | `rpc_match_respond(candidate, accept|decline)` | Decline closes the pair and blocks re-pairing the two owners; mutual accept → `match_accepted` + WhatsApp `confirm_handoff_v1`; one-sided → `match_interest`. Responses feed `match_user_feedback`. |
| Read | `rpc_my_matches(limit)` | Caller's pairs (not declined by me), counterpart visible to me, accepted first then effective score. |
| Quality metrics | `admin_match_quality(days)` → Admin → Match quality (`/(admin)/matching`) | Super admin / moderator (`matching.view_quality`, FR-ADMIN-029, `0454`). Per world, pairs whose first real alert (opted-out sides excluded) is within the last 1..365 days: alerted pairs, precision proxy = accepted / answers, notification→chat = owners exchanged a user message after the first alert, completion = handed-over `giving_handoffs` between the two owners on either listing (items, food, rides, knowledge; null elsewhere). |
| LLM (optional) | Edge fn `match-rerank` (deployed with every function by the Edge Functions stage of `deploy.yml`) + `api_match_llm_pending/store` | Off: `matching_settings.llm_rerank_enabled=false` and no `GEMINI_API_KEY` → clean no-op. When on, `match_effective_score` blends `llm_score` with `llm_weight`. Service-role only; listing text is sent as untrusted JSON data. |

## Quality layer (0424–0425)

* **Text** (`match_text_score`): Hebrew-aware tokens (final letters folded, stop words, `[e2e …]` tags and `/ת` dropped), stems for one/two prefix letters (ו ה ב ל מ ש כ) and plural/construct suffixes (ים/ות/י/ה/ת), English plural. Head noun = first Hebrew token / last English token before a preposition; `או`/`or`/`,` give alternative heads. `text = 0.55·head + 0.30·overlap + 0.15·trigram`.
* **items/food gate**: head match ≥ 0.5 (or near-identical trigram) else `text_mismatch` — kills same-category-different-object pairs (books ↔ bookshelf, stroller ↔ crib).
* **Notify floor**: `components.text ≥ notify_min_text` (0.5; rides exempt). Weights moved from category to text (items/food: category 0.15, text 0.30).
* **Rides**: pickup and drop-off within a corridor (15% of the route, 8–25 km) around the driver's line, in driving order (`wrong_direction`); time gap to the rider's flexible window (native) or departure, ≤30 min perfect, >3 h cut; `passengers ≤ seats_available`. Rides pre-score uses origin + destination + departure.
* Stale unanswered pairs are re-scored on recompute (not only withdrawn).

## kc-dev only (guarded by the fake seed, no-op on prod)

* 0426: up to 30 `[DEMO]` native ride requests with time windows derived from seed offers (same route / en route / reverse).
* 0427: `kc_dev_cleanup_e2e_listings` + daily pg_cron `kc_dev_e2e_cleanup` (03:30 UTC) deleting e2e-tagged posts/rides/listings of `@seed.kc.test` users older than 12 h.

## Client

* `SupabaseMatchRepository` (`@kc/infrastructure-supabase`), hooks `useMyMatches` / `useRespondToMatch` / `useRefreshMyMatches`.
* `/matches` screen (pull-to-refresh → `rpc_match_refresh_mine`, throttled 10 min/listing), donations hub "Matches for you" card.
* Push kinds `match_suggested|match_interest|match_accepted` → `/matches` (closed allowlist).

## Tuning (super-admin, `matching_settings` singleton)

`enabled`, `inline_on_write`, `worlds`, `min_score` 0.45, `notify_min_score` 0.60, `max_candidates_per_listing` 10,
`scan_limit` 500, `max_notify_per_user_day` 3, `notify_max_age_hours` 72, quiet window, `sweep_batch` 200,
`recompute_after_hours` 24, `weights`, `llm_rerank_enabled` false, `llm_weight` 0.3.

## Out of scope / follow-ups

* Cross-world matching — backlog P3.MATCH-XW.
* WhatsApp templates still need Meta approval and `whatsapp_channel_config.is_enabled`.
* v1 (`listing_matches`, 0260/0261) remains for operators; v2 does not write to it.
