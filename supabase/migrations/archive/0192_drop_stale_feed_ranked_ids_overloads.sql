-- 0192_drop_stale_feed_ranked_ids_overloads | DB hygiene — remove duplicate
-- function overloads that cause PostgREST PGRST203 ("could not choose the best
-- candidate function") on ambiguous RPC calls.
--
-- Background: feed_ranked_ids gained parameters over time via `create or replace
-- function` with a CHANGED signature. In Postgres that creates a NEW overload
-- instead of replacing the old one, so three overloads coexisted on every
-- environment:
--   * 0022 — 13-arg (original)
--   * 0025 — 14-arg (+ p_followers_only)
--   * 0126 — 15-arg (+ p_filter_search_query, p_followers_only)  ← the live one
--
-- The 15-arg overload (0126) is the only one any caller uses; the supabase-js
-- client always sends both p_filter_search_query and p_followers_only. The two
-- stale overloads are dead weight and a latent PGRST203 hazard for any partial
-- call. Drop them so feed_ranked_ids resolves unambiguously.
--
-- Idempotent: `drop function if exists` is a no-op when the overload is already
-- gone (e.g. a fresh stack that somehow only built the 15-arg). Safe to re-run.
--
-- Mapped to spec: NA (infra/DB hygiene — no FR behavior change).

-- 13-arg (0022_feed_ranked_ids)
drop function if exists public.feed_ranked_ids(
  uuid, text, text[], text[], text, text, double precision,
  text, text, integer, double precision, timestamptz, uuid
);

-- 14-arg (0025_feed_ranked_ids_followers): + p_followers_only boolean
drop function if exists public.feed_ranked_ids(
  uuid, text, text[], text[], text, text, double precision,
  text, text, integer, double precision, timestamptz, uuid, boolean
);
