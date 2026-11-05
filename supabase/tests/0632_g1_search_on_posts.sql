-- supabase/tests/0632_g1_search_on_posts.sql | 0632 (G1 step 6a-5g, issue #1671): search and the
-- similar listings read the post of a post-owned listing and return exactly what they returned
-- when they read the listing.
--
-- The oracles are the pre-0632 bodies (search_listings and marketplace_search 0411,
-- similar_listings 0336), copied verbatim as pg_temp functions. For every shape (post-owned ride
-- and food request, a mirror ride with a title over 80 characters, a listing made post-owned by
-- the 0554 backfill whose mirror post kept its cut title and its owner's city, a followers-only
-- listing, an items post and an items listing, a knowledge listing without a post), at every stage
-- (created, paused, held, published again, edited) and for every viewer (owner, member, follower,
-- blocked member, another member, guest; members ranked from a home position), the RPC's rows
-- equal the oracle's as ordered JSON text: text, trigram and query-less searches, a keyset page,
-- a world filter, and the similar listings of every listing.
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

-- ── Oracles: the pre-0632 bodies ────────────────────────────────────────────────────────────────

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
    select l.*
      from cand c
      join public.listings l on l.listing_id = c.listing_id
     where public.is_listing_visible_to(l, p_viewer)
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
               when v_anchor is null or b.geo is null then 0.5
               else greatest(
                 0,
                 1 - (extensions.st_distance(v_anchor, b.geo) / 1000.0) / greatest(v_radius, 1)
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
  where l.status = 'open'
    and l.moderation_status = 'published'
    and l.world_slug <> 'romantic_matchmaking'
    and (p_world_slug is null or l.world_slug = p_world_slug)
    and public.is_listing_visible_to(l, p_viewer)
  order by l.urgency_level desc, l.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

create function pg_temp.old_similar(
  p_listing_id uuid,
  p_limit int default 6
)
returns table (listing_id uuid, title text, world_slug text, kind_slug text)
language sql
stable
set search_path = public
as $$
  with base as (
    select l.world_slug, l.kind_id, l.search_vector
      from public.listings l
     where l.listing_id = p_listing_id
       and l.status = 'open'
       and l.moderation_status = 'published'
  )
  select
    l.listing_id,
    l.title,
    l.world_slug,
    lk.slug as kind_slug
  from public.listings l
  join public.listing_kinds lk on lk.kind_id = l.kind_id
  cross join base b
  where l.listing_id <> p_listing_id
    and l.status = 'open'
    and l.moderation_status = 'published'
    and l.world_slug = b.world_slug
    and public.is_listing_visible_to(l, auth.uid())
  order by
    case when l.kind_id = b.kind_id then 0 else 1 end,
    l.published_at desc nulls last
  limit least(greatest(coalesce(p_limit, 6), 1), 12);
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

/** Every search variant and the similar listings agree with their oracles for every viewer. */
create function pg_temp.assert_same(p_stage text)
returns void
language plpgsql
as $$
declare
  p personas;
  v_viewer uuid;
  v_args text;
  v_listing uuid;
  v_last record;
begin
  select * into p from personas;
  foreach v_viewer in array array[p.owner, p.viewer, p.follower, p.blocked, p.mentor, null] loop
    perform pg_temp.session(v_viewer);
    foreach v_args in array array[
      '''a''', '''Jerusalem''', '''soup''', '''ride''', '''help moving''', '''followers''', '''Jerusalm''',
      '''bookshelf''', '''sql''', '''a'', ''rides''', '''a'', null, 2'
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

    -- A keyset page: the page after the first page's last row.
    select * into v_last from pg_temp.old_search('a', null, 2, v_viewer) with ordinality x
     order by x.ordinality desc limit 1;
    if v_last.listing_id is not null then
      v_args := format('''a'', null, 2, %L::uuid, %s, %L::uuid', v_viewer, v_last.rrf_score, v_last.listing_id);
      perform pg_temp.same(format('public.search_listings(%s)', v_args), format('pg_temp.old_search(%s)', v_args),
        format('%s: search keyset page for %s', p_stage, coalesce(v_viewer::text, 'a guest')));
    end if;

    for v_listing in select listing_id from shapes loop
      perform pg_temp.same(format('public.similar_listings(%L)', v_listing), format('pg_temp.old_similar(%L)', v_listing),
        format('%s: similar to %s for %s', p_stage, v_listing, coalesce(v_viewer::text, 'a guest')));
    end loop;
  end loop;
end $$;
grant execute on function pg_temp.assert_same(text) to public;

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

rollback;
\echo '✓ 0632_g1_search_on_posts.sql passed'
