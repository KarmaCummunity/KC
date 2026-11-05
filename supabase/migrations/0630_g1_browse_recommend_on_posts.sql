-- 0630_g1_browse_recommend_on_posts | G1 step 6a-5f (ADR-006, D-214, issue #1671): browse and the
-- recommendations read the post of a post-owned listing.
--
-- Same rule as 0629: a post-owned listing (origin 'native' with legacy_post_id: food, rides,
-- housing, time since 0554) is read from its post, the record; every other shape — mirrors of
-- listing-sourced listings, items, listings without a post — keeps reading the listing.
--   1. browse_listings (0537)  the candidate scan, its filters, order and keyset are unchanged, so
--      the plan still walks listings_browse_(world_)keyset_idx or the geo filter; per row, a
--      post-owned listing is checked with post_listing_visible_to (0628) and returns the post's
--      world, kind, direction, urgency, availability and geo
--   2. recommend_listings_for_user (0323)  a post-owned candidate is checked on its post and
--      scored on the post's urgency
-- Only fields both syncs keep equal are taken from the post (0554, 0626). Title, summary and city
-- stay the listing's: a listing made post-owned by the 0554 backfill kept its mirror post, whose
-- title is cut to 80 characters and whose description and city fall back to the details and the
-- owner's city (0557), until a later write converges the two. created_at stays the listing's for
-- the same reason (such a post carries the listing's publication time). Output is byte-identical
-- to the pre-0630 bodies, which the test uses as oracles. Names, arguments, return shapes and
-- grants are unchanged; changed lines carry `-- 0630`.

begin;

-- ── 1. browse_listings (0537) ───────────────────────────────────────────────────────────────────
create or replace function public.browse_listings(p_world_slug text DEFAULT NULL::text, p_direction text DEFAULT NULL::text, p_urgency_min smallint DEFAULT NULL::smallint, p_availability text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_radius_km numeric DEFAULT NULL::numeric, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0, p_viewer uuid DEFAULT auth.uid(), p_cursor_sort double precision DEFAULT NULL::double precision, p_cursor_urgency smallint DEFAULT NULL::smallint, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(listing_id uuid, world_slug text, kind_slug text, direction text, title text, summary text, urgency_level smallint, availability_status text, city_id text, distance_km numeric, geo geography, created_at timestamp with time zone, sort_key double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
  v_post public.posts; -- 0630
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
    -- 0630: a post-owned listing (food, rides, housing, time; 0554) is read from its post, the record.
    v_post := null;                                                                         -- 0630
    if (r.lrow).origin = 'native' and (r.lrow).legacy_post_id is not null then              -- 0630
      select * into v_post from public.posts where post_id = (r.lrow).legacy_post_id;       -- 0630
    end if;                                                                                 -- 0630
    if v_post.post_id is not null then                                                      -- 0630
      continue when not public.post_listing_visible_to(v_post, p_viewer);                   -- 0630
    else                                                                                    -- 0630
      continue when not public.is_listing_visible_to(r.lrow, p_viewer);
    end if;                                                                                 -- 0630
    if v_skip > 0 then
      v_skip := v_skip - 1;
      continue;
    end if;

    listing_id := (r.lrow).listing_id;
    if v_post.post_id is not null then                                                      -- 0630
      -- 0630: the fields both syncs keep equal (0554, 0626); title, summary and city stay the
      -- 0630: listing's, which a listing made post-owned by the 0554 backfill may still differ on.
      world_slug := v_post.world_slug;                                                      -- 0630
      select lk.slug into kind_slug from public.listing_kinds lk                            -- 0630
       where lk.kind_id = coalesce(v_post.kind_id, (r.lrow).kind_id);                       -- 0630
      direction := case when v_post.direction = 'request' then 'request' else 'give' end;   -- 0630
      urgency_level := v_post.urgency_level;                                                -- 0630
      availability_status := v_post.availability_status;                                   -- 0630
      geo := v_post.geo;                                                                    -- 0630
    else                                                                                    -- 0630
      world_slug := (r.lrow).world_slug;
      select lk.slug into kind_slug from public.listing_kinds lk where lk.kind_id = (r.lrow).kind_id;
      direction := (r.lrow).direction;
      urgency_level := (r.lrow).urgency_level;
      availability_status := (r.lrow).availability_status;
      geo := (r.lrow).geo;
    end if;                                                                                 -- 0630
    title := (r.lrow).title;
    summary := (r.lrow).summary;
    city_id := (r.lrow).city_id;
    distance_km := case when r.sk >= 1e15 then null else (r.sk / 1000.0)::numeric end;
    created_at := (r.lrow).created_at;
    sort_key := r.sk;
    return next;

    v_n := v_n + 1;
    exit when v_n >= v_lim;
  end loop;
  close v_cur;
end;
$function$;

revoke all on function public.browse_listings(
  text, text, smallint, text, double precision, double precision, numeric, integer, integer, uuid,
  double precision, smallint, timestamp with time zone, uuid, uuid
) from public;
grant execute on function public.browse_listings(
  text, text, smallint, text, double precision, double precision, numeric, integer, integer, uuid,
  double precision, smallint, timestamp with time zone, uuid, uuid
) to anon, authenticated, service_role;

-- ── 2. recommend_listings_for_user (0323) ───────────────────────────────────────────────────────
create or replace function public.recommend_listings_for_user(
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
security definer
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
             + case when coalesce(p.urgency_level, l.urgency_level) = 3 then 0.15 else 0 end -- 0630: the post's
             + case when l.created_at > now() - interval '7 days' then 0.1 else 0 end as base_score
      from public.listings l
      -- 0630: the post of a post-owned listing (food, rides, housing, time; 0554), the record.
      left join public.posts p on p.post_id = l.legacy_post_id and l.origin = 'native'    -- 0630
      left join recent_worlds rw on rw.world_slug = l.world_slug
     where l.status = 'open'
       and l.moderation_status = 'published'
       and l.world_slug <> 'romantic_matchmaking'
       and (case when p.post_id is null then public.is_listing_visible_to(l, p_viewer)     -- 0630
                 else public.post_listing_visible_to(p, p_viewer) end)                    -- 0630
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

revoke all on function public.recommend_listings_for_user(int, uuid) from public;
grant execute on function public.recommend_listings_for_user(int, uuid) to authenticated, service_role;

commit;
