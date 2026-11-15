-- 0469_browse_listings_subcategory | KC#1102 / KC#1111 — browse items / food by world subcategory.
--
-- The create form stores a world subcategory on items and food listings (`0462`, KC#1296), but the
-- world hubs could only filter by world, direction, urgency, availability and distance. Adds an
-- optional trailing `p_category_id` to `browse_listings` (`0410`); every other argument, the keyset
-- order and the visibility check are unchanged. The signature changes, so the function is dropped
-- and recreated with the grants it had (`0436`).
--
-- Mapped to spec: docs/spec/05_giving_worlds.md §5.1 / §5.2, docs/spec/94_glossary_and_naming.md
-- (world subcategory). Idempotent.

begin;

drop function if exists public.browse_listings(
  text, text, smallint, text, double precision, double precision, numeric, integer, integer, uuid,
  double precision, smallint, timestamp with time zone, uuid
);
drop function if exists public.browse_listings(
  text, text, smallint, text, double precision, double precision, numeric, integer, integer, uuid,
  double precision, smallint, timestamp with time zone, uuid, uuid
);

create function public.browse_listings(p_world_slug text DEFAULT NULL::text, p_direction text DEFAULT NULL::text, p_urgency_min smallint DEFAULT NULL::smallint, p_availability text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_radius_km numeric DEFAULT NULL::numeric, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0, p_viewer uuid DEFAULT auth.uid(), p_cursor_sort double precision DEFAULT NULL::double precision, p_cursor_urgency smallint DEFAULT NULL::smallint, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(listing_id uuid, world_slug text, kind_slug text, direction text, title text, summary text, urgency_level smallint, availability_status text, city_id text, distance_km numeric, geo geography, created_at timestamp with time zone, sort_key double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
declare
  v_anchor geography;
  v_radius_m double precision := coalesce(p_radius_km, 25)::double precision * 1000.0;
  v_lim int := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_skip int := case when p_cursor_id is null then greatest(coalesce(p_offset, 0), 0) else 0 end;
  v_has_cursor boolean := p_cursor_id is not null and p_cursor_created_at is not null;
  v_n int := 0;
  v_cur refcursor;
  r record;
begin
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

revoke all on function public.browse_listings(
  text, text, smallint, text, double precision, double precision, numeric, integer, integer, uuid,
  double precision, smallint, timestamp with time zone, uuid, uuid
) from public;
grant execute on function public.browse_listings(
  text, text, smallint, text, double precision, double precision, numeric, integer, integer, uuid,
  double precision, smallint, timestamp with time zone, uuid, uuid
) to anon, authenticated, service_role;

commit;
