-- supabase/tests/0630_g1_browse_recommend_on_posts.sql | 0630 (G1 step 6a-5f, issue #1671): browse
-- and the recommendations read the post of a post-owned listing and return exactly what they
-- returned when they read the listing.
--
-- The oracles are the pre-0630 bodies (browse_listings 0537, recommend_listings_for_user 0323),
-- copied verbatim as pg_temp functions. For every shape (post-owned ride and food request, a
-- mirror ride with a title over 80 characters, a listing made post-owned by the 0554 backfill
-- whose mirror post kept its cut title and its owner's city, a followers-only listing, an items
-- post and an items listing, a knowledge listing without a post), at every stage (created,
-- paused, held, published again, edited) and for every viewer (owner, member, follower, blocked
-- member, another member, guest), the RPC's rows equal the oracle's as ordered JSON text.
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
-- creation and publication time so the recommendations' order (score, created_at), which has no
-- tiebreaker, is fully defined here too.
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
  update public.listings set legacy_post_id = public.post_id_of_listing(v) where listing_id = v;
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

  -- One transaction ties every now(): give each listing its own creation time so every order is defined.
  update public.listings l set created_at = now() - r.n * interval '1 minute'
    from (select listing_id, row_number() over (order by listing_id) as n from shapes) r
   where l.listing_id = r.listing_id;
end $$;

-- ── Oracles: the pre-0630 bodies ────────────────────────────────────────────────────────────────

create function pg_temp.old_browse(p_world_slug text DEFAULT NULL::text, p_direction text DEFAULT NULL::text, p_urgency_min smallint DEFAULT NULL::smallint, p_availability text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_radius_km numeric DEFAULT NULL::numeric, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0, p_viewer uuid DEFAULT auth.uid(), p_cursor_sort double precision DEFAULT NULL::double precision, p_cursor_urgency smallint DEFAULT NULL::smallint, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(listing_id uuid, world_slug text, kind_slug text, direction text, title text, summary text, urgency_level smallint, availability_status text, city_id text, distance_km numeric, geo geography, created_at timestamp with time zone, sort_key double precision)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
declare
  v_anchor geography;
  v_radius_m double precision := least(greatest(coalesce(p_radius_km, 25), 0.1), 500)::double precision * 1000.0;
  v_lim int := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_skip int := case when p_cursor_id is null then least(greatest(coalesce(p_offset, 0), 0), 10000) else 0 end;
  v_has_cursor boolean := p_cursor_id is not null and p_cursor_created_at is not null;
  v_n int := 0;
  v_cur refcursor;
  r record;
begin
  -- 0537: reject partial or out-of-range coordinates.
  if (p_lat is null) <> (p_lng is null)
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if p_lat is not null and p_lng is not null then
    v_anchor := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::geography;
  elsif p_viewer is not null then
    select coalesce(ugp.home_geo, public.listing_geo_from_city(ugp.home_city_id))
      into v_anchor
      from public.user_geo_prefs ugp
     where ugp.user_id = p_viewer;
  end if;

  if v_anchor is null then
    -- No anchor: every row has sort_key 1e15, so order = (urgency, created_at, id) desc,
    -- which walks listings_browse_(world_)keyset_idx and stops after v_lim visible rows.
    open v_cur for
      select l as lrow, 1e15::double precision as sk
        from public.listings l
       where l.status = 'open'
         and l.moderation_status = 'published'
         and l.world_slug <> 'romantic_matchmaking'
         and (p_world_slug is null or l.world_slug = p_world_slug)
         and (p_direction is null or l.direction = p_direction)
         and (p_urgency_min is null or l.urgency_level >= p_urgency_min)
         and (p_availability is null or l.availability_status = p_availability)
         and (p_category_id is null or l.category_id = p_category_id)  -- KC#1102: world subcategory
         and (
           not v_has_cursor
           or (l.urgency_level, l.created_at, l.listing_id)
              < (p_cursor_urgency, p_cursor_created_at, p_cursor_id)
         )
       order by l.urgency_level desc, l.created_at desc, l.listing_id desc;
  else
    open v_cur for
      select c.lrow, c.sk
        from (
          select l as lrow,
                 l.urgency_level as urg,
                 l.created_at as cat,
                 l.listing_id as lid,
                 case when l.geo is null then 1e15::double precision
                      else extensions.st_distance(v_anchor, l.geo)
                 end as sk
            from public.listings l
           where l.status = 'open'
             and l.moderation_status = 'published'
             and l.world_slug <> 'romantic_matchmaking'
             and (p_world_slug is null or l.world_slug = p_world_slug)
             and (p_direction is null or l.direction = p_direction)
             and (p_urgency_min is null or l.urgency_level >= p_urgency_min)
             and (p_availability is null or l.availability_status = p_availability)
             and (p_category_id is null or l.category_id = p_category_id)  -- KC#1102: world subcategory
             and (l.geo is null or extensions.st_dwithin(l.geo, v_anchor, v_radius_m))
        ) c
       where not v_has_cursor
          or c.sk > p_cursor_sort
          or (c.sk = p_cursor_sort
              and (c.urg, c.cat, c.lid) < (p_cursor_urgency, p_cursor_created_at, p_cursor_id))
       order by c.sk, c.urg desc, c.cat desc, c.lid desc;
  end if;

  loop
    fetch v_cur into r;
    exit when not found;
    continue when not public.is_listing_visible_to(r.lrow, p_viewer);
    if v_skip > 0 then
      v_skip := v_skip - 1;
      continue;
    end if;

    listing_id := (r.lrow).listing_id;
    world_slug := (r.lrow).world_slug;
    select lk.slug into kind_slug from public.listing_kinds lk where lk.kind_id = (r.lrow).kind_id;
    direction := (r.lrow).direction;
    title := (r.lrow).title;
    summary := (r.lrow).summary;
    urgency_level := (r.lrow).urgency_level;
    availability_status := (r.lrow).availability_status;
    city_id := (r.lrow).city_id;
    distance_km := case when r.sk >= 1e15 then null else (r.sk / 1000.0)::numeric end;
    geo := (r.lrow).geo;
    created_at := (r.lrow).created_at;
    sort_key := r.sk;
    return next;

    v_n := v_n + 1;
    exit when v_n >= v_lim;
  end loop;
  close v_cur;
end;
$function$;

create function pg_temp.old_recommend(
  p_limit int default 12,
  p_viewer uuid default auth.uid()
)
returns table (
  listing_id uuid,
  score numeric,
  reason text
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 12), 1), 30);
begin
  if p_viewer is null then
    return;
  end if;

  return query
  with recent_worlds as (
    select l.world_slug, max(s.created_at) as last_at
      from public.listing_user_signals s
      join public.listings l on l.listing_id = s.listing_id
     where s.user_id = p_viewer
     group by l.world_slug
     order by last_at desc
     limit 5
  ),
  candidates as (
    select l.*,
           case when rw.world_slug is not null then 0.35 else 0.1 end
             + case when l.urgency_level = 3 then 0.15 else 0 end
             + case when l.created_at > now() - interval '7 days' then 0.1 else 0 end as base_score
      from public.listings l
      left join recent_worlds rw on rw.world_slug = l.world_slug
     where l.status = 'open'
       and l.moderation_status = 'published'
       and l.world_slug <> 'romantic_matchmaking'
       and public.is_listing_visible_to(l, p_viewer)
       and l.owner_id <> p_viewer
  )
  select c.listing_id,
         c.base_score::numeric as score,
         case when rw.world_slug is not null then 'world_affinity' else 'fresh' end as reason
    from candidates c
    left join recent_worlds rw on rw.world_slug = c.world_slug
   order by score desc, c.created_at desc
   limit v_lim;
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

/** Every browse variant and the recommendations agree with their oracles for every viewer. */
create function pg_temp.assert_same(p_stage text)
returns void
language plpgsql
as $$
declare
  p personas;
  v_viewer uuid;
  v_args text;
  v_last record;
begin
  select * into p from personas;
  foreach v_viewer in array array[p.owner, p.viewer, p.follower, p.blocked, p.mentor, null] loop
    perform pg_temp.session(v_viewer);
    foreach v_args in array array[
      '',
      'p_world_slug => ''rides''',
      'p_direction => ''request''',
      'p_availability => ''scheduled''',
      'p_urgency_min => 3::smallint',
      'p_lat => 32.08, p_lng => 34.78, p_radius_km => 200',
      'p_lat => 32.08, p_lng => 34.78, p_radius_km => 200, p_limit => 2, p_offset => 1',
      'p_limit => 3, p_offset => 2'
    ] loop
      perform pg_temp.same(
        format('public.browse_listings(%s)', concat_ws(', ', nullif(v_args, ''), format('p_viewer => %L::uuid', v_viewer))),
        format('pg_temp.old_browse(%s)', concat_ws(', ', nullif(v_args, ''), format('p_viewer => %L::uuid', v_viewer))),
        format('%s: browse(%s) for %s', p_stage, v_args, coalesce(v_viewer::text, 'a guest')));
    end loop;

    -- Keyset pages: the page after the first page's last row, without and with an anchor.
    select * into v_last from pg_temp.old_browse(p_limit => 2, p_viewer => v_viewer) with ordinality x
     order by x.ordinality desc limit 1;
    if v_last.listing_id is not null then
      v_args := format('p_limit => 2, p_cursor_urgency => %s::smallint, p_cursor_created_at => %L::timestamptz, p_cursor_id => %L::uuid, p_cursor_sort => %s',
        v_last.urgency_level, v_last.created_at, v_last.listing_id, v_last.sort_key);
      perform pg_temp.same(format('public.browse_listings(%s, p_viewer => %L::uuid)', v_args, v_viewer),
        format('pg_temp.old_browse(%s, p_viewer => %L::uuid)', v_args, v_viewer),
        format('%s: browse keyset page for %s', p_stage, coalesce(v_viewer::text, 'a guest')));
    end if;
    select * into v_last
      from pg_temp.old_browse(p_lat => 32.08, p_lng => 34.78, p_radius_km => 200, p_limit => 2, p_viewer => v_viewer)
      with ordinality x order by x.ordinality desc limit 1;
    if v_last.listing_id is not null then
      v_args := format('p_lat => 32.08, p_lng => 34.78, p_radius_km => 200, p_limit => 2, p_cursor_urgency => %s::smallint, p_cursor_created_at => %L::timestamptz, p_cursor_id => %L::uuid, p_cursor_sort => %s',
        v_last.urgency_level, v_last.created_at, v_last.listing_id, v_last.sort_key);
      perform pg_temp.same(format('public.browse_listings(%s, p_viewer => %L::uuid)', v_args, v_viewer),
        format('pg_temp.old_browse(%s, p_viewer => %L::uuid)', v_args, v_viewer),
        format('%s: anchored browse keyset page for %s', p_stage, coalesce(v_viewer::text, 'a guest')));
    end if;

    if v_viewer is not null then
      perform pg_temp.same(format('public.recommend_listings_for_user(30, %L::uuid)', v_viewer),
        format('pg_temp.old_recommend(30, %L::uuid)', v_viewer),
        format('%s: recommendations for %s', p_stage, v_viewer));
    end if;
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
\echo '✓ 0630_g1_browse_recommend_on_posts.sql passed'
