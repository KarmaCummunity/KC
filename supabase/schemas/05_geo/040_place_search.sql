-- Geo · place search
--
-- One search over the places a ride can start, end or meet at that are picked by name:
-- cities and road junctions (D71). Streets are not searched here; they are picked inside a
-- chosen city, straight from public.streets. A function rather than two table reads because
-- the picker needs one ranked list across both catalogs with plain latitude / longitude,
-- which a table read of a geography column does not give.

-- Returns at most p_limit places whose Hebrew or English name contains p_query, names that
-- start with it first. Runs with the caller's rights: the tables' own policies apply.
-- junction_kind tells a junction from an interchange so the client can word the label.
create function public.search_places(
  p_query text,
  p_kinds text[] default array['city', 'junction'],
  p_limit integer default 20
)
returns table (
  place_kind    text,
  place_id      text,
  name_he       text,
  name_en       text,
  junction_kind text,
  roads         text,
  city_id       text,
  lat           double precision,
  lng           double precision
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_query   text := btrim(coalesce(p_query, ''));
  v_pattern text;
begin
  if char_length(v_query) not between 1 and 80 then
    raise exception 'place_query_invalid' using errcode = '22023';
  end if;
  if p_kinds is null or cardinality(p_kinds) = 0 or not (p_kinds <@ array['city', 'junction']) then
    raise exception 'place_kinds_invalid' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'place_limit_invalid' using errcode = '22023';
  end if;

  -- The query is matched literally: pattern characters typed by the member are escaped.
  v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select p.place_kind, p.place_id, p.name_he, p.name_en, p.junction_kind, p.roads, p.city_id,
         extensions.st_y(p.location::extensions.geometry),
         extensions.st_x(p.location::extensions.geometry)
    from (
      -- A city without a centre cannot be placed on a route, so it is not a ride place.
      select 'city'::text as place_kind, c.city_id as place_id, c.name_he, c.name_en,
             null::text as junction_kind, null::text as roads, c.city_id, c.location
        from public.cities c
       where 'city' = any (p_kinds)
         and c.location is not null
         and (c.name_he ilike v_pattern or lower(c.name_en) like lower(v_pattern))
      union all
      select 'junction', j.junction_id::text, j.name_he, j.name_en, j.kind, j.roads, null, j.location
        from public.road_junctions j
       where 'junction' = any (p_kinds)
         and (j.name_he ilike v_pattern or lower(j.name_en) like lower(v_pattern))
    ) p
   -- Total order, so equal names always come back in the same sequence.
   order by (p.name_he ilike substr(v_pattern, 2) or lower(p.name_en) like lower(substr(v_pattern, 2))) desc,
            p.name_he, p.place_kind, p.place_id
   limit p_limit;
end;
$$;
comment on function public.search_places(text, text[], integer) is
  'Place picker search over cities and road junctions (D71): at most 50 rows, names starting with the query first.';

grant execute on function public.search_places(text, text[], integer) to authenticated;
