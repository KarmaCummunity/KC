-- 0391: ride offer/request detail schema (origin/dest geo, departure, seats) and
-- legacy ride_listings sync that fills the same geo fields from public.cities.
-- Only departs_at is required by the schema so legacy-synced rows (origin='ride_listing')
-- keep validating; the native create form always sends origin/dest coordinates and
-- find_ride_listing_matches (0392) only considers rows that have them.

begin;

update public.listing_kinds
   set detail_schema = '{
     "type":"object",
     "additionalProperties":false,
     "required":["departs_at"],
     "properties":{
       "origin_label":{"type":"string","maxLength":120},
       "dest_label":{"type":"string","maxLength":120},
       "origin_city_id":{"type":"string"},
       "dest_city_id":{"type":"string"},
       "origin_lat":{"type":"number","minimum":-90,"maximum":90},
       "origin_lng":{"type":"number","minimum":-180,"maximum":180},
       "dest_lat":{"type":"number","minimum":-90,"maximum":90},
       "dest_lng":{"type":"number","minimum":-180,"maximum":180},
       "departs_at":{"type":"string","format":"date-time"},
       "seats_available":{"type":"integer"},
       "cargo_items":{"type":"boolean"},
       "cargo_food":{"type":"boolean"},
       "reward_model":{"enum":["free","expense_share"]},
       "cost_share_ils":{"type":"number","minimum":0},
       "linked_listing_id":{"type":"string","format":"uuid"}
     }
   }'::jsonb
 where world_slug = 'rides' and slug = 'ride_offer';

update public.listing_kinds
   set detail_schema = '{
     "type":"object",
     "additionalProperties":false,
     "required":["departs_at"],
     "properties":{
       "origin_label":{"type":"string","maxLength":120},
       "dest_label":{"type":"string","maxLength":120},
       "origin_city_id":{"type":"string"},
       "dest_city_id":{"type":"string"},
       "origin_lat":{"type":"number","minimum":-90,"maximum":90},
       "origin_lng":{"type":"number","minimum":-180,"maximum":180},
       "dest_lat":{"type":"number","minimum":-90,"maximum":90},
       "dest_lng":{"type":"number","minimum":-180,"maximum":180},
       "departs_at":{"type":"string","format":"date-time"},
       "passengers":{"type":"integer","minimum":1,"maximum":8},
       "seats_available":{"type":"integer"},
       "luggage":{"type":"boolean"},
       "constraints":{"type":"string","maxLength":280}
     }
   }'::jsonb
 where world_slug = 'rides' and slug = 'ride_request';

-- Legacy V3 rides: same body as 0243 plus origin/dest coordinates + labels from cities,
-- so synced rides are matchable by find_ride_listing_matches.
create or replace function public.listing_upsert_from_ride(p_ride public.ride_listings)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind_id uuid;
  v_geo extensions.geography;
  v_o public.cities%rowtype;
  v_d public.cities%rowtype;
begin
  select kind_id into v_kind_id
    from public.listing_kinds
   where world_slug = 'rides'
     and slug = case when p_ride.mode = 'offer' then 'ride_offer' else 'ride_request' end;

  if v_kind_id is null then
    return;
  end if;

  v_geo := public.listing_geo_from_city(p_ride.origin_city_id);
  select * into v_o from public.cities where city_id = p_ride.origin_city_id;
  select * into v_d from public.cities where city_id = p_ride.dest_city_id;

  insert into public.listings (
    owner_id, world_slug, kind_id, direction, status, visibility, anonymity_level,
    title, summary, geo, city_id, time_window, expires_at, details, origin,
    legacy_ride_id, moderation_status, published_at, created_at, updated_at
  ) values (
    p_ride.owner_id,
    'rides',
    v_kind_id,
    case when p_ride.mode = 'offer' then 'give' else 'request' end,
    case p_ride.status when 'open' then 'open' when 'cancelled' then 'cancelled' else 'closed' end,
    p_ride.visibility,
    public.visibility_to_anonymity_level(p_ride.visibility),
    p_ride.title,
    p_ride.description,
    v_geo,
    p_ride.origin_city_id,
    tstzrange(p_ride.departs_at, p_ride.departs_at + interval '6 hours', '[)'),
    p_ride.departs_at + interval '6 hours',
    jsonb_strip_nulls(jsonb_build_object(
      'seats_available', p_ride.seats_available,
      'dest_city_id', p_ride.dest_city_id,
      'origin_city_id', p_ride.origin_city_id,
      'departs_at', p_ride.departs_at,
      'origin_label', v_o.name_he,
      'dest_label', v_d.name_he,
      'origin_lat', v_o.lat,
      'origin_lng', v_o.lon,
      'dest_lat', v_d.lat,
      'dest_lng', v_d.lon
    )),
    'ride_listing',
    p_ride.ride_id,
    'published',
    coalesce(p_ride.created_at, now()),
    coalesce(p_ride.created_at, now()),
    coalesce(p_ride.updated_at, now())
  )
  on conflict (legacy_ride_id) where legacy_ride_id is not null do update set
    owner_id = excluded.owner_id,
    kind_id = excluded.kind_id,
    direction = excluded.direction,
    status = excluded.status,
    visibility = excluded.visibility,
    anonymity_level = excluded.anonymity_level,
    title = excluded.title,
    summary = excluded.summary,
    geo = excluded.geo,
    city_id = excluded.city_id,
    time_window = excluded.time_window,
    expires_at = excluded.expires_at,
    details = excluded.details,
    updated_at = excluded.updated_at;
end;
$$;

commit;
