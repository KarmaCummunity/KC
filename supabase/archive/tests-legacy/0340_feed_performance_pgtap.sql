-- supabase/tests/0340_feed_performance_pgtap.sql | KC#899 pgTAP + EXPLAIN evidence

\set ON_ERROR_STOP on

create extension if not exists pgtap;

begin;

select plan(8);

-- ── fixtures ────────────────────────────────────────────────────────────────
create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@perf.test', now(),
          jsonb_build_object('full_name', 'Perf ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Perf ' || p_handle,
         account_status = 'active', privacy_mode = 'Public'
   where user_id = p_id;
end $$;

-- posts_enforce_active_cap (0002) allows max 20 open posts per owner, so the
-- 900-row load is spread across 45 synthetic owners × 20 posts.
do $$
declare
  v_owner uuid;
  v_city text;
  v_seeded int := 0;
  v_u int;
begin
  select city_id into v_city from public.cities limit 1;
  for v_u in 1..45 loop
    v_owner := ('00000000-0000-0000-0000-000000' || lpad((899000 + v_u)::text, 6, '0'))::uuid;
    perform pg_temp.mk_user(v_owner, 'feed_perf_' || v_u::text);
    v_seeded := v_seeded + public.seed_feed_performance_posts(v_owner, v_city, 20);
  end loop;
  perform set_config('test.feed_seeded', v_seeded::text, true);
end $$;

select ok(current_setting('test.feed_seeded')::int >= 800, 'seeded >= 800 open posts');

select ok(
  (select row_count >= 800 from public.feed_mv_refresh_state where singleton_id = 1),
  'materialized feed row_count >= 800'
);

select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'kc_private'
       and indexname = 'feed_open_posts_mv_open_newest_idx'
  ),
  'MV newest index exists'
);

select has_index(
  'public',
  'posts',
  'posts_open_created_post_id_idx',
  'posts open newest index exists'
);

-- ── functional + latency ────────────────────────────────────────────────────
do $$
declare
  v_owner uuid := '00000000-0000-0000-0000-000000899001';
  v_n int;
  v_t0 timestamptz;
  v_ms double precision;
begin
  v_t0 := clock_timestamp();
  select count(*) into v_n from public.feed_ranked_ids(
    v_owner, null, null, null, 'open', null, null,
    'newest', null, 20, null, null, null, null, false, null
  );
  v_ms := extract(epoch from (clock_timestamp() - v_t0)) * 1000.0;
  perform set_config('test.feed_page_count', v_n::text, true);
  perform set_config('test.feed_elapsed_ms', v_ms::text, true);
end $$;

select ok(current_setting('test.feed_page_count')::int = 20, 'newest feed returns 20 rows');

select diag('feed_ranked_ids newest elapsed_ms = ' || current_setting('test.feed_elapsed_ms'));
-- Target is < 50ms on dedicated hardware (FEED_899_EXPLAIN.md); CI runners are
-- shared and cold, so the gate is a 500ms regression ceiling.
select ok(
  current_setting('test.feed_elapsed_ms')::double precision < 500,
  'feed_ranked_ids newest < 500ms on seeded data (CI ceiling)'
);

-- ── fast-path shape ─────────────────────────────────────────────────────────
-- EXPLAIN on a plpgsql call only shows a Function Scan, so assert the newest
-- fast path reads the MV in the function body instead.
select ok(
  exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'feed_ranked_ids'
       and position('feed_open_posts_mv' in p.prosrc) > 0
  ),
  'feed_ranked_ids newest fast path reads feed_open_posts_mv'
);

select diag('feed_newest_explain_analyze_ms = ' ||
  (public.feed_newest_explain_analyze_ms('00000000-0000-0000-0000-000000899001'::uuid)->>'elapsed_ms'));
select ok(
  (public.feed_newest_explain_analyze_ms('00000000-0000-0000-0000-000000899001'::uuid)->>'elapsed_ms')::float < 500,
  'feed_newest_explain_analyze_ms elapsed < 500ms (CI ceiling)'
);

select finish();

rollback;
