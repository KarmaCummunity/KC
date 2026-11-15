-- supabase/tests/0410_keyset_pagination.sql | keyset cursors (0410–0413) never skip or repeat rows.

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', privacy_mode = 'Public', onboarding_state = 'completed'
   where user_id = p_id;
end $$;

-- ── fixtures ────────────────────────────────────────────────────────────────
do $$
declare
  v_owner uuid := '00000000-0000-0000-0000-000000410001';
  v_feed_user uuid := '00000000-0000-0000-0000-000000410002';
  v_kind uuid;
  v_city text;
  i int;
begin
  perform pg_temp.mk_user(v_owner, 'keyset_owner');
  perform pg_temp.mk_user(v_feed_user, 'keyset_feed_user');
  select kind_id into v_kind from public.listing_kinds where world_slug = 'items' and slug = 'give_item';
  select city_id into v_city from public.cities limit 1;

  -- 10 listings: 4 share one created_at (tie-break on listing_id), the rest are spread out.
  for i in 1..10 loop
    insert into public.listings (
      owner_id, world_slug, kind_id, direction, title, summary, origin, moderation_status,
      published_at, details, urgency_level, created_at
    ) values (
      v_owner, 'items', v_kind, 'give', 'keysetlisting ' || i, null, 'native', 'published', now(),
      '{}'::jsonb, 2,
      case when i <= 4 then timestamptz '2026-01-01 10:00:00+00'
           else timestamptz '2026-01-01 10:00:00+00' - make_interval(mins => i) end
    );
  end loop;

  -- One unpublished listing must never appear.
  insert into public.listings (owner_id, world_slug, kind_id, direction, title, origin, moderation_status, details)
  values (v_owner, 'items', v_kind, 'give', 'keysetlisting hidden', 'native', 'pending_review', '{}'::jsonb);

  -- 20 posts inserted in one transaction share created_at = now().
  perform public.seed_feed_performance_posts(v_feed_user, v_city, 20);
  perform public.refresh_feed_open_posts_mv(false);
end $$;

-- ── browse_listings: page through with limit 3 ──────────────────────────────
do $$
declare
  v_owner uuid := '00000000-0000-0000-0000-000000410001';
  v_seen uuid[] := '{}';
  r record;
  c_sort double precision; c_urg smallint; c_at timestamptz; c_id uuid;
  v_page int := 0;
  v_got int;
begin
  loop
    v_got := 0;
    for r in
      select * from public.browse_listings(
        p_world_slug => 'items', p_limit => 3, p_viewer => null,
        p_cursor_sort => c_sort, p_cursor_urgency => c_urg, p_cursor_created_at => c_at, p_cursor_id => c_id)
    loop
      v_got := v_got + 1;
      if r.listing_id = any(v_seen) then
        raise exception 'ASSERT FAILED: browse_listings repeated % on page %', r.listing_id, v_page;
      end if;
      v_seen := v_seen || r.listing_id;
      c_sort := r.sort_key; c_urg := r.urgency_level; c_at := r.created_at; c_id := r.listing_id;
    end loop;
    exit when v_got < 3;
    v_page := v_page + 1;
    if v_page > 100 then raise exception 'ASSERT FAILED: browse_listings paging did not terminate'; end if;
  end loop;

  if (select count(*) from public.listings l
       where l.owner_id = v_owner and l.moderation_status = 'published' and l.listing_id <> all(v_seen)) > 0 then
    raise exception 'ASSERT FAILED: browse_listings keyset skipped a published listing';
  end if;
  if exists (select 1 from public.listings l
              where l.owner_id = v_owner and l.moderation_status = 'pending_review' and l.listing_id = any(v_seen)) then
    raise exception 'ASSERT FAILED: unpublished listing leaked into browse_listings';
  end if;

  -- Legacy offset callers still work (first page via p_offset).
  if (select count(*) from public.browse_listings(null, null, null, null, null, null, null, 5, 0, null)) = 0 then
    raise exception 'ASSERT FAILED: browse_listings positional/offset call returned nothing';
  end if;
end $$;

-- ── search_listings: (score, id) cursor ─────────────────────────────────────
do $$
declare
  v_seen uuid[] := '{}';
  r record;
  c_score numeric; c_id uuid;
  v_got int;
  v_guard int := 0;
begin
  loop
    v_got := 0;
    for r in select * from public.marketplace_search('keysetlisting', 'items', 3, null, c_score, c_id) loop
      v_got := v_got + 1;
      if r.listing_id = any(v_seen) then
        raise exception 'ASSERT FAILED: marketplace_search repeated %', r.listing_id;
      end if;
      v_seen := v_seen || r.listing_id;
      c_score := r.rrf_score; c_id := r.listing_id;
    end loop;
    exit when v_got < 3;
    v_guard := v_guard + 1;
    if v_guard > 50 then raise exception 'ASSERT FAILED: search paging did not terminate'; end if;
  end loop;
  if cardinality(v_seen) <> 10 then
    raise exception 'ASSERT FAILED: expected 10 search hits across pages, got %', cardinality(v_seen);
  end if;
end $$;

-- ── list_my_listings: (updated_at, id) cursor ───────────────────────────────
do $$
declare
  v_owner uuid := '00000000-0000-0000-0000-000000410001';
  v_seen uuid[] := '{}';
  r record;
  c_at timestamptz; c_id uuid;
  v_got int;
  v_total int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  loop
    v_got := 0;
    for r in select * from public.list_my_listings(4, 0, c_at, c_id) loop
      v_got := v_got + 1;
      if r.listing_id = any(v_seen) then
        raise exception 'ASSERT FAILED: list_my_listings repeated %', r.listing_id;
      end if;
      v_seen := v_seen || r.listing_id;
      c_at := r.updated_at; c_id := r.listing_id;
    end loop;
    exit when v_got < 4;
  end loop;
  select count(*) into v_total from public.listings where owner_id = v_owner and status <> 'removed_admin';
  if cardinality(v_seen) <> v_total then
    raise exception 'ASSERT FAILED: list_my_listings paged % of % rows', cardinality(v_seen), v_total;
  end if;
end $$;

-- ── feed_ranked_ids: 20 posts with identical created_at ─────────────────────
do $$
declare
  v_feed_user uuid := '00000000-0000-0000-0000-000000410002';
  v_sort text;
  v_seen uuid[];
  r record;
  c_at timestamptz; c_id uuid; c_score double precision;
  v_got int;
  v_guard int;
begin
  foreach v_sort in array array['newest', 'oldest', 'personalized'] loop
    v_seen := '{}'; c_at := null; c_id := null; c_score := null; v_guard := 0;
    loop
      v_got := 0;
      for r in
        select f.*, p.created_at as p_created
          from public.feed_ranked_ids(
            p_viewer_id => v_feed_user, p_sort_order => v_sort, p_page_limit => 6,
            p_cursor_created_at => c_at, p_cursor_post_id => c_id, p_cursor_rank_score => c_score) f
          join public.posts p on p.post_id = f.post_id
      loop
        v_got := v_got + 1;
        if r.post_id = any(v_seen) then
          raise exception 'ASSERT FAILED: feed_ranked_ids(%) repeated %', v_sort, r.post_id;
        end if;
        v_seen := v_seen || r.post_id;
        c_at := r.p_created; c_id := r.post_id; c_score := r.rank_score;
      end loop;
      exit when v_got < 6;
      v_guard := v_guard + 1;
      if v_guard > 50 then raise exception 'ASSERT FAILED: feed paging (%) did not terminate', v_sort; end if;
    end loop;
    if (select count(*) from public.posts where owner_id = v_feed_user and status = 'open'
          and post_id <> all(v_seen)) > 0 then
      raise exception 'ASSERT FAILED: feed_ranked_ids(%) skipped posts sharing created_at (saw %)', v_sort, cardinality(v_seen);
    end if;
  end loop;
end $$;

-- ── search_all: people search works (pg_trgm in `extensions`) ───────────────
do $$
declare
  v_json jsonb;
begin
  v_json := public.search_all('keyset_owner', array['people'], 5);
  if jsonb_typeof(v_json->'people') <> 'array' then
    raise exception 'ASSERT FAILED: search_all people did not return an array';
  end if;
end $$;

rollback;

\echo '✓ 0410_keyset_pagination.sql passed'
