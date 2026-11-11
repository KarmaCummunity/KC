-- 0426_kc_dev_demo_ride_requests | Matching v2: demo ride requests with time windows (kc-dev only).
--
-- DEV ONLY, same guard as 0400: does nothing unless the database carries the kc-dev fake seed
-- (>= 100 auth users @seed.kc.test with app_metadata.seed = true). Prod and fresh CI stacks
-- never have them, so there this migration is a no-op.
--
-- The kc-dev seed has 76 ride offers and 40 requests on random city pairs with departures spread
-- over 14 days, so almost no request shares a route and a time with an offer (8 same-route pairs,
-- none within 6 h). This adds up to 30 native ride requests derived from open seed offers, each
-- with a flexible time window, in three shapes that exercise the matcher:
--   same route   (pickup/drop-off ~1-2 km from the driver's ends, window -1 h..+2 h)  -> match
--   en route     (pickup 30% along the driver's line, same destination, window 0..+3 h) -> match
--   reverse      (driver's destination -> origin, same window)                        -> wrong_direction
-- Titles start with "[DEMO]". Ids are md5-derived from the offer, so re-running is a no-op.
-- Inserting fires the matching v2 trigger, which computes candidates inline.

do $guard$
declare
  v_seed_users int;
  v_kind       uuid;
  v_n          int := 0;
  r            public.listings;
  v_i          int := 0;
  v_owner      uuid;
  v_o1         extensions.geography;
  v_o2         extensions.geography;
  v_p1         extensions.geometry;
  v_p2         extensions.geometry;
  v_dep        timestamptz;
  v_win        tstzrange;
  v_shape      int;
  v_jit        float8;
begin
  select count(*) into v_seed_users
    from auth.users
   where email like '%@seed.kc.test'
     and coalesce(raw_app_meta_data->>'seed', '') = 'true';

  if v_seed_users < 100 then
    raise notice '0426: no kc-dev seed detected (% seed users) - skipping demo ride requests', v_seed_users;
    return;
  end if;

  select kind_id into v_kind from public.listing_kinds where world_slug = 'rides' and slug = 'ride_request';
  if v_kind is null then
    raise notice '0426: ride_request kind missing - skipping';
    return;
  end if;

  for r in
    select o.*
      from public.listings o
      join auth.users a on a.id = o.owner_id
     where o.world_slug = 'rides' and o.direction = 'give' and o.status = 'open'
       and o.moderation_status = 'published'
       and a.email like '%@seed.kc.test'
       and o.details ? 'departs_at' and o.details ? 'dest_city_id'
       and (o.details ->> 'departs_at')::timestamptz > now() + interval '6 hours'
     order by md5(o.listing_id::text)
     limit 30
  loop
    v_o1 := public.match_listing_anchor(r);
    v_o2 := public.match_listing_dest(r);
    continue when v_o1 is null or v_o2 is null;

    select u.id into v_owner
      from auth.users u
     where u.email like '%@seed.kc.test' and u.id <> r.owner_id
     order by md5(u.id::text || r.listing_id::text)
     limit 1;

    v_i := v_i + 1;
    v_shape := v_i % 3;
    v_jit := ((abs(hashtext(r.listing_id::text)) % 21) - 10) / 1000.0;  -- up to ~1 km
    v_dep := (r.details ->> 'departs_at')::timestamptz;

    if v_shape = 0 then
      v_p1 := extensions.st_translate(v_o1::extensions.geometry, v_jit, -v_jit);
      v_p2 := extensions.st_translate(v_o2::extensions.geometry, -v_jit, v_jit);
      v_win := tstzrange(v_dep - interval '1 hour', v_dep + interval '2 hours', '[)');
    elsif v_shape = 1 then
      v_p1 := extensions.st_lineinterpolatepoint(
                extensions.st_makeline(v_o1::extensions.geometry, v_o2::extensions.geometry), 0.3);
      v_p2 := extensions.st_translate(v_o2::extensions.geometry, v_jit, v_jit);
      v_win := tstzrange(v_dep, v_dep + interval '3 hours', '[)');
    else
      v_p1 := v_o2::extensions.geometry;
      v_p2 := v_o1::extensions.geometry;
      v_win := tstzrange(v_dep - interval '1 hour', v_dep + interval '2 hours', '[)');
    end if;

    insert into public.listings (
      listing_id, owner_id, world_slug, kind_id, direction, status, visibility, anonymity_level,
      title, summary, geo, city_id, time_window, expires_at, details, origin,
      moderation_status, published_at
    )
    select md5('kc-dev-demo-ride-request:' || r.listing_id::text)::uuid,
           v_owner, 'rides', v_kind, 'request', 'open', 'Public',
           public.visibility_to_anonymity_level('Public'),
           '[DEMO] ' || U&'\05DE\05D7\05E4\05E9/\05EA \05D8\05E8\05DE\05E4 \05DC' || coalesce(dc.name_he, '?'),
           case v_shape when 0 then 'same route' when 1 then 'en route' else 'reverse' end
             || ' - kc-dev demo request (0426)',
           v_p1::extensions.geography,
           case when v_shape = 2 then r.details ->> 'dest_city_id' else r.city_id end,
           v_win,
           upper(v_win) + interval '1 hour',
           jsonb_build_object(
             'origin_lat', extensions.st_y(v_p1), 'origin_lng', extensions.st_x(v_p1),
             'dest_lat', extensions.st_y(v_p2), 'dest_lng', extensions.st_x(v_p2),
             'departs_at', lower(v_win) + interval '1 hour',
             'passengers', 1
           ),
           'native', 'published', now()
      from (select 1) one
      left join public.cities dc
        on dc.city_id = case when v_shape = 2 then r.city_id else r.details ->> 'dest_city_id' end
    on conflict (listing_id) do nothing;

    if found then
      v_n := v_n + 1;
    end if;
  end loop;

  raise notice '0426: % demo ride requests inserted on kc-dev', v_n;
end
$guard$;
