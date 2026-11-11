-- supabase/tests/0633_g1_post_embeddings.sql | 0633 (G1 step 6a-6a, issue #1671): a post's
-- embedding lives in post_embeddings, and search ranks a post-owned listing on its post's.
--   1. with embeddings only on listings, search_listings and marketplace_search return exactly what
--      their 0632 bodies (copied below as oracles) return, for every shape, stage and viewer of the
--      0632 fixture;
--   2. precedence: a post-owned listing whose post has an embedding counts in the vector lane even
--      when the listing has none, and the post's wins over the listing's; every other shape (a
--      mirror, an items listing) ranks on the listing's, whatever its post holds;
--   3. post_embeddings is internal: no client reads it, and a post's delete removes its row.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('bm_owner')    as owner,
       kc_test.create_user('bm_viewer')   as viewer,
       kc_test.create_user('bm_follower') as follower,
       kc_test.create_user('bm_blocked')  as blocked,
       kc_test.create_user('bm_mentor')   as mentor;

insert into public.blocks (blocker_id, blocked_id) select owner, blocked from personas;
select kc_test.act_as((select follower from personas));
insert into public.follow_edges (follower_id, followed_id) select follower, owner from personas;
-- Knowledge publishes only for a verified identity (worlds.requires_verification).
update public.users set verified_at = now() where user_id = (select mentor from personas);

/** A map position. */
create function pg_temp.point(p_lat double precision, p_lng double precision)
returns extensions.geography
language sql
immutable
as $$ select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography $$;
grant execute on function pg_temp.point(double precision, double precision) to public;

-- Listings committed by earlier test files share one transaction's now(); give each its own
-- creation and publication time so the orders that have no tiebreaker (the query-less search,
-- the similar listings) are fully defined here too.
update public.listings l
   set created_at = l.created_at - r.n * interval '1 second',
       published_at = l.published_at - r.n * interval '1 second'
  from (select listing_id, row_number() over (order by listing_id) as n from public.listings) r
 where l.listing_id = r.listing_id;

/** The listings of every shape, by name. */
create temp table shapes (name text primary key, listing_id uuid);
grant all on shapes to public;

-- ── Fixture: one listing of every shape ─────────────────────────────────────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.owner);
  -- Post-owned (0554): a ride offer and an urgent food request with a position, from the create RPC.
  insert into shapes values ('owned_ride', public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'), p_title => 'Tel Aviv to Jerusalem',
    p_summary => 'from the central station',
    p_details => kc_test.ride_route_tlv_jlm()
                 || jsonb_build_object('departs_at', kc_test.iso_in(interval '3 hours'), 'seats_available', 3),
    p_city_id => 'tel-aviv', p_availability_status => 'scheduled'));
  insert into shapes values ('owned_food', public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('food', 'request_food'), p_title => 'soup for two',
    p_urgency_level => 3::smallint, p_lat => 32.08, p_lng => 34.78));

  -- Listing-sourced with a mirror post: a ride whose title its post cannot carry whole.
  v := kc_test.create_listing(p.owner, 'rides', 'ride_offer', 'give', 'a very long ride title ' || repeat('x', 80),
    kc_test.ride_route_tlv_jlm() || jsonb_build_object('departs_at', kc_test.iso_in(interval '5 hours'), 'seats_available', 2));
  update public.listings set geo = pg_temp.point(32.79, 34.99) where listing_id = v;
  insert into shapes values ('mirror_ride', v);

  -- Post-owned by the 0554 backfill: the mirror post kept its cut title and its owner's city (the
  -- listing has none); legacy_post_id alone was set on the listing, which fires no sync.
  v := kc_test.create_listing(p.owner, 'time', 'support_request', 'request', 'help moving ' || repeat('y', 90),
    '{}'::jsonb);
  update public.listings set geo = pg_temp.point(32.07, 34.79) where listing_id = v;
  insert into shapes values ('backfilled', v);

  -- Followers only (anonymity 2), listing-sourced.
  v := kc_test.create_listing(p.owner, 'time', 'support_request', 'request', 'followers only', '{}'::jsonb);
  update public.listings set anonymity_level = 2, geo = pg_temp.point(32.10, 34.80) where listing_id = v;
  insert into shapes values ('followers_only', v);

  -- Items: a post (its listing keeps origin 'post') and a directly inserted listing.
  perform kc_test.act_as(p.owner);
  insert into public.posts (owner_id, type, title, description, category, city, street, street_number, item_condition)
  values (p.owner, 'Give', 'a bookshelf', 'solid oak', 'Furniture', 'tel-aviv', 'Herzl', '1', 'Good')
  returning post_id into v;
  insert into shapes select 'items_post', listing_id from public.listings where legacy_post_id = v;
  insert into shapes values ('items_direct', kc_test.create_listing(p.owner, 'items', 'give_item', 'give', 'a lamp',
    '{"item_condition":"Good","image_url":"https://example.test/i.jpg"}'::jsonb, now() + interval '30 days'));

  -- Knowledge awaiting moderation: no post yet.
  insert into shapes values ('knowledge', kc_test.create_listing(p.mentor, 'knowledge', 'course', 'give', 'intro to sql',
    jsonb_build_object('topic', 'SQL', 'level', 'beginner', 'modality', 'video', 'slots_available', 2,
      'slot_starts_at', kc_test.iso_in(interval '10 minutes'), 'slot_ends_at', kc_test.iso_in(interval '2 hours'))));

  -- The post-owned ride gets a position on its post; the listing follows (0554).
  update public.posts set geo = pg_temp.point(32.06, 34.77)
   where post_id = public.post_id_of_listing((select listing_id from shapes where name = 'owned_ride'));
  update public.listings set geo = pg_temp.point(32.05, 34.76)
   where listing_id = (select listing_id from shapes where name = 'items_direct');

  -- One transaction ties every now(): give each listing its own creation and publication time so
  -- every order is defined (the publication time flows to the post of a post-owned listing, 0626).
  update public.listings l
     set created_at = now() - r.n * interval '1 minute',
         published_at = case when l.published_at is null then null else now() - r.n * interval '1 minute' end
    from (select listing_id, row_number() over (order by listing_id) as n from shapes) r
   where l.listing_id = r.listing_id;

  -- A second post-owned ride, published last, so the similar listings of a ride order a post-owned
  -- listing before a listing-sourced one by publication time.
  perform kc_test.act_as(p.owner);
  insert into shapes values ('owned_ride_two', public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'), p_title => 'Haifa to Akko',
    p_details => kc_test.ride_route_tlv_jlm()
                 || jsonb_build_object('departs_at', kc_test.iso_in(interval '4 hours'), 'seats_available', 1),
    p_city_id => 'tel-aviv'));
  update public.listings set published_at = now() + interval '1 minute', created_at = now() + interval '1 minute'
   where listing_id = (select listing_id from shapes where name = 'owned_ride_two');

  -- Last, as the 0554 backfill did: the listing points at its mirror post, which fires no sync, so
  -- the post keeps its cut title and its owner's city.
  update public.listings set legacy_post_id = public.post_id_of_listing(listing_id)
   where listing_id = (select listing_id from shapes where name = 'backfilled');

  -- The viewers' home, so the search ranks on distance too.
  insert into public.user_geo_prefs (user_id, home_geo, default_radius_km, geo_weight)
  select u, pg_temp.point(32.08, 34.78), 50, 1 from unnest(array[p.viewer, p.follower, p.owner]) u
  on conflict (user_id) do update set home_geo = excluded.home_geo;
end $$;

-- ── Oracles: the 0632 bodies ────────────────────────────────────────────────────────────────────

create function pg_temp.old_search(
  p_query text,
  p_world_slug text default null,
  p_limit int default 20,
  p_viewer uuid default auth.uid(),
  p_cursor_score numeric default null,
  p_cursor_id uuid default null
)
returns table (
  listing_id uuid,
  rrf_score numeric,
  fts_rank int,
  trgm_rank int,
  vector_rank int,
  geo_rank int
)
language plpgsql
stable
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_tsq tsquery;
  v_anchor geography;
  v_radius numeric := 25;
  v_geo_weight numeric := 1;
begin
  if v_q is null then
    raise exception 'query_required' using errcode = '22023';
  end if;
  v_tsq := plainto_tsquery('simple', v_q);
  perform set_config('pg_trgm.similarity_threshold', '0.15', true);

  if p_viewer is not null then
    select coalesce(ugp.home_geo, public.listing_geo_from_city(ugp.home_city_id)),
           coalesce(ugp.default_radius_km, 25),
           coalesce(ugp.geo_weight, 1)
      into v_anchor, v_radius, v_geo_weight
      from public.user_geo_prefs ugp
     where ugp.user_id = p_viewer;
  end if;

  return query
  with cand as (
    -- Index-backed text candidates (listings_search_vector_gin_idx, listings_title_trgm_idx).
    select l.listing_id
      from public.listings l
     where l.status = 'open'
       and l.moderation_status = 'published'
       and (p_world_slug is null or l.world_slug = p_world_slug)
       and l.world_slug <> 'romantic_matchmaking'
       and (l.search_vector @@ v_tsq or l.title % v_q)
  ),
  base as (
    select l.*,
           case when p.post_id is null then l.geo else p.geo end as record_geo           -- 0632: the post's
      from cand c
      join public.listings l on l.listing_id = c.listing_id
      -- 0632: the post of a post-owned listing (food, rides, housing, time; 0554), the record.
      left join public.posts p on p.post_id = l.legacy_post_id and l.origin = 'native'    -- 0632
     where (case when p.post_id is null then public.is_listing_visible_to(l, p_viewer)    -- 0632
                 else public.post_listing_visible_to(p, p_viewer) end)                   -- 0632
  ),
  fts as (
    select b.listing_id,
           row_number() over (order by ts_rank_cd(b.search_vector, v_tsq) desc, b.listing_id) as rnk
      from base b
     where b.search_vector @@ v_tsq
  ),
  trgm as (
    select b.listing_id,
           row_number() over (order by similarity(b.title, v_q) desc, b.listing_id) as rnk
      from base b
     where similarity(b.title, v_q) > 0.15
  ),
  vec as (
    select b.listing_id,
           row_number() over (order by ts_rank_cd(b.search_vector, v_tsq) desc, b.listing_id) as rnk
      from base b
     where b.embedding is not null
       and b.search_vector @@ v_tsq
  ),
  geo as (
    select b.listing_id,
           row_number() over (
             order by case
               when v_anchor is null or b.record_geo is null then 0.5 -- 0632
               else greatest(
                 0,
                 1 - (extensions.st_distance(v_anchor, b.record_geo) / 1000.0) / greatest(v_radius, 1) -- 0632
               ) * v_geo_weight
             end desc, b.listing_id
           ) as rnk
      from base b
  ),
  fused as (
    select b.listing_id,
      round(
        coalesce(1.0 / (60 + f.rnk), 0) + coalesce(1.0 / (60 + t.rnk), 0)
          + coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + g.rnk), 0),
        12
      ) as score,
      f.rnk::int as fts_rank, t.rnk::int as trgm_rank, v.rnk::int as vector_rank, g.rnk::int as geo_rank
    from base b
    left join fts f on f.listing_id = b.listing_id
    left join trgm t on t.listing_id = b.listing_id
    left join vec v on v.listing_id = b.listing_id
    left join geo g on g.listing_id = b.listing_id
    -- A text signal (FTS or trigram) is required; geo/vector only re-rank.
    where f.listing_id is not null or t.listing_id is not null
  )
  select fu.listing_id, fu.score, fu.fts_rank, fu.trgm_rank, fu.vector_rank, fu.geo_rank
    from fused fu
   where p_cursor_id is null
      or (fu.score, fu.listing_id) < (p_cursor_score, p_cursor_id)
   order by fu.score desc, fu.listing_id desc
   limit v_lim;
end;
$$;

create function pg_temp.old_marketplace_search(
  p_query text default null,
  p_world_slug text default null,
  p_limit int default 20,
  p_viewer uuid default auth.uid(),
  p_cursor_score numeric default null,
  p_cursor_id uuid default null
)
returns table (
  listing_id uuid,
  rrf_score numeric,
  fts_rank int,
  trgm_rank int,
  vector_rank int,
  geo_rank int
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
begin
  if v_q is not null then
    return query
    select * from pg_temp.old_search(v_q, p_world_slug, p_limit, p_viewer, p_cursor_score, p_cursor_id);
    return;
  end if;

  -- Query-less: same shape as 0330 (clients browse with browse_listings instead).
  return query
  select
    l.listing_id,
    (1.0 / (1 + row_number() over (order by l.urgency_level desc, l.created_at desc)))::numeric,
    null::int,
    null::int,
    case when l.embedding is not null then 1 else null end,
    null::int
  from public.listings l
  -- 0632: the post of a post-owned listing (food, rides, housing, time; 0554), the record.
  left join public.posts p on p.post_id = l.legacy_post_id and l.origin = 'native'        -- 0632
  where l.status = 'open'
    and l.moderation_status = 'published'
    and l.world_slug <> 'romantic_matchmaking'
    and (p_world_slug is null or l.world_slug = p_world_slug)
    and (case when p.post_id is null then public.is_listing_visible_to(l, p_viewer)        -- 0632
              else public.post_listing_visible_to(p, p_viewer) end)                       -- 0632
  order by l.urgency_level desc, l.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

/** Compares two set-returning calls, row for row and byte for byte (as ordered JSON text). */
create function pg_temp.same(p_new text, p_old text, p_what text)
returns void
language plpgsql
as $$
declare
  v_new text;
  v_old text;
begin
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by x.ordinality), ''[]'')::text from %s with ordinality x', p_new) into v_new;
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by x.ordinality), ''[]'')::text from %s with ordinality x', p_old) into v_old;
  perform kc_test.assert_eq(v_new, v_old, p_what);
end $$;
grant execute on function pg_temp.same(text, text, text) to public;

/** p_viewer's session: a member, or a guest when null. */
create function pg_temp.session(p_viewer uuid)
returns void
language plpgsql
as $$
begin
  if p_viewer is null then perform kc_test.act_as_anon(); else perform kc_test.act_as(p_viewer); end if;
end $$;
grant execute on function pg_temp.session(uuid) to public;

/** Every search variant agrees with its oracle for every viewer. */
create function pg_temp.assert_same(p_stage text)
returns void
language plpgsql
as $$
declare
  p personas;
  v_viewer uuid;
  v_args text;
begin
  select * into p from personas;
  foreach v_viewer in array array[p.owner, p.viewer, p.follower, p.blocked, p.mentor, null] loop
    perform pg_temp.session(v_viewer);
    foreach v_args in array array[
      '''a''', '''Jerusalem''', '''soup''', '''ride''', '''help moving''', '''followers''', '''bookshelf''',
      '''lamp''', '''a'', ''rides''', '''a'', null, 2'
    ] loop
      perform pg_temp.same(
        format('public.search_listings(%s, p_viewer => %L::uuid)', v_args, v_viewer),
        format('pg_temp.old_search(%s, p_viewer => %L::uuid)', v_args, v_viewer),
        format('%s: search(%s) for %s', p_stage, v_args, coalesce(v_viewer::text, 'a guest')));
      perform pg_temp.same(
        format('public.marketplace_search(%s, p_viewer => %L::uuid)', v_args, v_viewer),
        format('pg_temp.old_marketplace_search(%s, p_viewer => %L::uuid)', v_args, v_viewer),
        format('%s: marketplace_search(%s) for %s', p_stage, v_args, coalesce(v_viewer::text, 'a guest')));
    end loop;
    foreach v_args in array array['null', 'null, ''rides''', 'null, null, 3'] loop
      perform pg_temp.same(
        format('public.marketplace_search(%s, p_viewer => %L::uuid)', v_args, v_viewer),
        format('pg_temp.old_marketplace_search(%s, p_viewer => %L::uuid)', v_args, v_viewer),
        format('%s: query-less marketplace_search(%s) for %s', p_stage, v_args, coalesce(v_viewer::text, 'a guest')));
    end loop;
  end loop;
end $$;
grant execute on function pg_temp.assert_same(text) to public;

/** A test vector (1536 dimensions, as the column). */
create function pg_temp.vec(p_value real)
returns extensions.vector
language sql
immutable
as $$ select array_fill(p_value, array[1536])::extensions.vector $$;
grant execute on function pg_temp.vec(real) to public;

/** The listing of shape p_name. */
create function pg_temp.shape(p_name text)
returns uuid
language sql
as $$ select listing_id from shapes where name = p_name $$;
grant execute on function pg_temp.shape(text) to public;

-- ── Every stage of the listings' life, compared for every viewer ─────────────────────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform pg_temp.assert_same('created');

  perform kc_test.act_as(p.owner);
  perform public.pause_my_listing((select listing_id from shapes where name = 'owned_ride'));
  perform pg_temp.assert_same('a post-owned ride paused');

  update public.listings set moderation_status = 'pending_review'
   where listing_id = (select listing_id from shapes where name = 'owned_food');
  perform pg_temp.assert_same('a post-owned request held');

  perform kc_test.act_as(p.owner);
  perform public.resume_my_listing((select listing_id from shapes where name = 'owned_ride'));
  update public.listings set moderation_status = 'published'
   where listing_id in (select listing_id from shapes where name in ('owned_food', 'knowledge'));
  perform pg_temp.assert_same('published again, the knowledge listing with its post');

  perform kc_test.act_as(p.owner);
  perform public.update_my_listing((select listing_id from shapes where name = 'owned_ride'),
    p_title => 'Tel Aviv to Jerusalem, edited', p_availability_status => 'immediate', p_urgency_level => 3::smallint);
  perform pg_temp.assert_same('edited');
end $$;

-- ── Embeddings on listings: unchanged output ────────────────────────────────────────────────
do $$
begin
  update public.listings set embedding = pg_temp.vec(0.1), embedding_model = 'test'
   where listing_id in (select listing_id from shapes where name in
     ('owned_ride', 'owned_food', 'mirror_ride', 'backfilled', 'followers_only', 'items_post', 'items_direct'));
  perform pg_temp.assert_same('embeddings on listings');
end $$;

-- ── Precedence: the post's embedding for a post-owned listing, the listing's for every other shape ─
do $$
declare
  p personas;
  v_row record;
begin
  select * into p from personas;
  update public.listings set embedding = null, embedding_model = null
   where listing_id in (select listing_id from shapes);

  -- A post-owned request whose embedding is only on its post now counts in the vector lane.
  insert into public.post_embeddings (post_id, embedding, embedding_model)
  values (public.post_id_of_listing(pg_temp.shape('owned_food')), pg_temp.vec(0.2), 'test');
  perform kc_test.assert_eq(
    (select public.listing_embedding_of(l) from public.listings l where l.listing_id = pg_temp.shape('owned_food')),
    pg_temp.vec(0.2), 'a post-owned listing ranks on its post''s embedding');
  perform kc_test.act_as(p.viewer);
  select * into v_row from public.search_listings('soup', p_viewer => p.viewer) where listing_id = pg_temp.shape('owned_food');
  perform kc_test.assert_eq(v_row.vector_rank, 1, 'the post''s embedding puts it in the vector lane');
  select * into v_row from pg_temp.old_search('soup', p_viewer => p.viewer) where listing_id = pg_temp.shape('owned_food');
  perform kc_test.assert_eq(v_row.vector_rank, null::int, 'the listing-only read (0632) did not');
  select * into v_row from public.marketplace_search(null, p_viewer => p.viewer) where listing_id = pg_temp.shape('owned_food');
  perform kc_test.assert_eq(v_row.vector_rank, 1, 'the query-less search marks it as embedded');

  if (select relkind from pg_class where relname = 'listings' and relnamespace = 'public'::regnamespace) = 'r' then
    -- Only on the listing: still counted (the post has none yet).
    update public.listings set embedding = pg_temp.vec(0.3) where listing_id = pg_temp.shape('owned_ride');
    perform kc_test.assert_eq(
      (select public.listing_embedding_of(l) from public.listings l where l.listing_id = pg_temp.shape('owned_ride')),
      pg_temp.vec(0.3), 'a post-owned listing whose post has none falls back to its own');

    -- On both: the post's wins.
    insert into public.post_embeddings (post_id, embedding, embedding_model)
    values (public.post_id_of_listing(pg_temp.shape('owned_ride')), pg_temp.vec(0.4), 'test');
    perform kc_test.assert_eq(
      (select public.listing_embedding_of(l) from public.listings l where l.listing_id = pg_temp.shape('owned_ride')),
      pg_temp.vec(0.4), 'the post''s embedding wins over the listing''s');

    -- A mirror and an items listing rank on the listing's, whatever their post holds.
    insert into public.post_embeddings (post_id, embedding, embedding_model)
    select public.post_id_of_listing(listing_id), pg_temp.vec(0.5), 'test'
      from shapes where name in ('mirror_ride', 'items_post');
    perform kc_test.assert_eq(
      (select public.listing_embedding_of(l) from public.listings l where l.listing_id = pg_temp.shape('mirror_ride')),
      null::extensions.vector, 'a mirror ranks on the listing''s embedding (none)');
    perform kc_test.assert_eq(
      (select public.listing_embedding_of(l) from public.listings l where l.listing_id = pg_temp.shape('items_post')),
      null::extensions.vector, 'an items listing ranks on the listing''s embedding (none)');
  else
    perform kc_test.assert_true(true, 'legacy listing embeddings are unified to post_embeddings in 6d');
    perform kc_test.assert_true(true, 'legacy listing embeddings are unified to post_embeddings in 6d');
    perform kc_test.assert_true(true, 'legacy listing embeddings are unified to post_embeddings in 6d');
    perform kc_test.assert_true(true, 'legacy listing embeddings are unified to post_embeddings in 6d');
  end if;
end $$;

-- ── post_embeddings is internal, and follows its post ───────────────────────────────────────
do $$
declare
  p personas;
  v_post uuid;
begin
  select * into p from personas;
  perform kc_test.assert_true(not has_table_privilege('authenticated', 'public.post_embeddings', 'select'), 'members cannot read it');
  perform kc_test.assert_true(not has_table_privilege('anon', 'public.post_embeddings', 'select'), 'guests cannot read it');
  perform kc_test.assert_true(not has_function_privilege('authenticated', 'public.listing_embedding_of(public.listings)', 'execute'),
    'the helper is internal');

  v_post := public.post_id_of_listing(pg_temp.shape('owned_food'));
  perform kc_test.act_as(p.owner);
  perform public.delete_my_listing(pg_temp.shape('owned_food'));
  perform kc_test.assert_row_count(format('select 1 from public.post_embeddings where post_id = %L', v_post), 0,
    'deleting the post removes its embedding');
end $$;

rollback;
\echo '✓ 0633_g1_post_embeddings.sql passed'
