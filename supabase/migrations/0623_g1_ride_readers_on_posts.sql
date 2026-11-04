-- 0623_g1_ride_readers_on_posts | G1 step 6a-4a (ADR-006, D-214, issue #1671): the ride readers
-- read `post_handoffs` (seats booked) and `posts` + `ride_post_details` (the ride's schedule, route,
-- seats and series) instead of `giving_handoffs` / `listings`.
--
-- Every ride writer writes the handoff record since 0558, every published open ride listing has a
-- post from publication (0557), and both syncs keep `ride_post_details` (0552) and `posts.details`
-- current on every listing write (0551 / 0554 / 0557). This group moves the read-only paths:
--   1. list_rides_feed             (0531)  seats booked, schedule, route, seats, series
--   2. list_ride_series_occurrences (0531) the occurrences of a series, keyed on ride_post_details
--   3. ride_series_feed_waits      (0531)  the earlier open occurrence of the same series
--   4. ride_series_drop_unbooked   (0531)  only its "nobody booked" check; the delete stays (6a-4b)
--   5. ride_listing_emergency      (0517)  the ride, its title and its active window
--   6. complete_ride_listing       (0558)  owner, status and departure; the listing stays locked
--                                          and closed here until the writers move (6a-4b)
--   7. ride_route_alert_deliver    (0516)  status, departure and route ends
--   8. ops.check_rides_open_after_departure (0463)
-- Each body is the latest definition copied verbatim; every changed line carries a `-- 0623:` note.
-- Names, arguments, return types and grants are unchanged and listing ids stay in the returned
-- shapes, so the app is unaffected. The listing keeps what the post does not carry equivalently
-- yet: its id, the rides feed's title and direction, and `is_listing_visible_to` (6a-5).
--
-- Reading the post:
--   * a listing's `status = 'open' and moderation_status = 'published'` is its post's
--     `status = 'open'` (listing_feed_mirror_status, 0551; both syncs write it on every change);
--   * departure, arrival, route ends, meeting points, seats and passengers are ride_post_details'
--     typed columns (ride_post_details_upsert, 0552, from the same `details`);
--   * the series of an occurrence is `ride_post_details.series_id` (+ `series_on`): the upsert takes
--     it from the marker `details.ride_series.id` when that series exists, and ride_series rows go
--     only with their owner, whose listings go too, so the two keys agree for every live occurrence
--     (asserted in the test). The full marker (`weekdays`, `time`), which the feed returns as
--     `recurrence`, is the post's copy of `details`.
-- On existing data the output is the same, except:
--   * a ride listing that never got a post — the v1 rides of origin 'ride_listing' (G44, cleaned up
--     before step 6c) — drops out of the rides feed and the open-after-departure count; its route
--     alerts are skipped and its emergency button and completion answer `listing_not_available`
--     (since 0620 it has no participants and since 0558 no bookings anyway);
--   * a listing left `open` while not published (a moderation hold) is not open on its post: its
--     pending route alert is skipped, the driver cannot complete it and the health check does not
--     count it (the feed and the series list already excluded it);
--   * the emergency notification names the ride by its post's title, capped at 80 characters where
--     a listing's is at 120 (posts gain the listing's own columns in 6a-5).
-- Left for 6a-4b: the writers that still write listings (the series materializer and its insert
-- guard, ride_series_drop_unbooked's delete, set_ride_series_status's detach, ride_series_sweep,
-- create_ride_series' returned occurrence) and the trigger function listings_ride_route_alerts,
-- which lives on listings (6c) and reads no handoff. Read-only; no schema change. Idempotent
-- (create or replace).

begin;

-- ── 1. list_rides_feed (0531) ─────────────────────────────────────────────────────────────────

create or replace function public.list_rides_feed(p_limit int default 100)
returns table (
  listing_id     uuid,
  direction      text,
  title          text,
  departs_at     timestamptz,
  origin_label   text,
  dest_label     text,
  meeting_points int,
  seats_left     int,
  passengers     int,
  recurrence     jsonb,
  series_more    int
)
language sql
stable
security definer
set search_path = public
as $$
  with upcoming as (
    select l.listing_id, l.direction, l.title,       -- 0623: the listing keeps its id, direction and title
           p.post_id,                                -- 0623: the ride's post
           p.details -> 'ride_series' as recurrence, -- 0623: the post's copy of the series marker
           r.origin_label, r.dest_label, r.meeting_points, r.seats_available, r.passengers, -- 0623
           r.departs_at as departs,                  -- 0623: the ride's schedule
           r.series_id::text as series_id            -- 0623: the series of the occurrence
      from public.listings l
      join public.posts p on p.listing_id = l.listing_id        -- 0623
      join public.ride_post_details r on r.post_id = p.post_id  -- 0623
     where l.world_slug = 'rides'
       and p.status = 'open' -- 0623: open and published (listing_feed_mirror_status, 0551)
       and r.departs_at > now() -- 0623: a typed departure
       and public.is_listing_visible_to(l, auth.uid())
  ), horizon as (
    -- Midnight starting the day after tomorrow, Israel time.
    select (((now() at time zone 'Asia/Jerusalem')::date + 2)::timestamp) at time zone 'Asia/Jerusalem' as at
  ), keyed as (
    select u.*,
           case when u.series_id is not null and u.departs >= h.at
                then 'series:' || u.series_id else 'listing:' || u.listing_id::text end as fold_key
      from upcoming u, horizon h
  ), folded as (
    select distinct on (k.fold_key)
           k.*, (count(*) over (partition by k.fold_key) - 1)::int as later_count
      from keyed k
     order by k.fold_key, k.departs, k.listing_id
  )
  select f.listing_id,
         f.direction,
         f.title,
         f.departs,
         f.origin_label,                          -- 0623
         f.dest_label,                            -- 0623
         jsonb_array_length(f.meeting_points),    -- 0623: always an array (ride_post_details check)
         case when f.direction = 'give' then greatest(0,
           coalesce(f.seats_available, 1)         -- 0623
           - coalesce((select sum(h.seats)::int from public.post_handoffs h -- 0623: the record
                        where h.post_id = f.post_id                         -- 0623
                          and h.status in ('reserved', 'confirmed', 'handed_over')), 0))
         end,
         case when f.direction = 'request' then f.passengers end, -- 0623
         f.recurrence,                                            -- 0623
         f.later_count
    from folded f
   order by f.departs, f.listing_id
   limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

revoke all on function public.list_rides_feed(int) from public;
grant execute on function public.list_rides_feed(int) to anon, authenticated;

-- ── 2. list_ride_series_occurrences (0531) ────────────────────────────────────────────────────

create or replace function public.list_ride_series_occurrences(p_series_id uuid, p_limit int default 60)
returns table (
  listing_id uuid,
  departs_at timestamptz,
  seats_left int,
  passengers int
)
language sql
stable
security definer
set search_path = public
as $$
  select l.listing_id,
         r.departs_at, -- 0623
         case when l.direction = 'give' then greatest(0,
           coalesce(r.seats_available, 1) -- 0623
           - coalesce((select sum(h.seats)::int from public.post_handoffs h -- 0623: the record
                        where h.post_id = p.post_id                         -- 0623
                          and h.status in ('reserved', 'confirmed', 'handed_over')), 0))
         end,
         case when l.direction = 'request' then r.passengers end -- 0623
    from public.ride_post_details r                       -- 0623: the series' occurrences
    join public.posts p on p.post_id = r.post_id          -- 0623: their posts
    join public.listings l on l.listing_id = p.listing_id -- 0623: the listing keeps its id and visibility
   where r.series_id = p_series_id -- 0623
     and p.status = 'open' -- 0623: open and published (listing_feed_mirror_status, 0551)
     and r.departs_at > now() -- 0623
     and public.is_listing_visible_to(l, auth.uid())
   order by r.departs_at, l.listing_id -- 0623
   limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

revoke all on function public.list_ride_series_occurrences(uuid, int) from public;
grant execute on function public.list_ride_series_occurrences(uuid, int) to anon, authenticated;

-- ── 3. ride_series_feed_waits (0531) ──────────────────────────────────────────────────────────

-- True for an occurrence that must wait its turn in the main feed: another upcoming open
-- occurrence of its series departs earlier. p_listing is the occurrence being published (its post
-- may not exist yet); the others are read from their posts.
create or replace function public.ride_series_feed_waits(p_listing public.listings)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_listing.details ? 'ride_series'
     and exists (
       select 1 from public.ride_series s                              -- 0623: the marker's series
         join public.ride_post_details r on r.series_id = s.series_id   -- 0623: its occurrences
         join public.posts o on o.post_id = r.post_id                   -- 0623: and their posts
        where s.series_id::text = p_listing.details -> 'ride_series' ->> 'id' -- 0623
          and o.listing_id is distinct from p_listing.listing_id         -- 0623
          and o.status = 'open' -- 0623: open and published (listing_feed_mirror_status, 0551)
          and r.departs_at > now()                                       -- 0623
          and r.departs_at < (p_listing.details ->> 'departs_at')::timestamptz); -- 0623
$$;

revoke all on function public.ride_series_feed_waits(public.listings) from public, anon, authenticated;

-- ── 4. ride_series_drop_unbooked (0531): the booking check reads the record ──────────────────

-- Removes the upcoming occurrences of a series that nobody booked. A booked occurrence is an
-- agreed ride: it stays, and the driver handles it like any single ride.
create or replace function public.ride_series_drop_unbooked(p_series_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.listings l
   where l.details -> 'ride_series' ->> 'id' = p_series_id::text
     and l.status = 'open'
     and (l.details ->> 'departs_at')::timestamptz > now()
     and not exists (select 1 from public.post_handoffs h -- 0623: the record
                      where h.post_id = public.post_id_of_listing(l.listing_id) -- 0623: the occurrence's post
                        and h.status <> 'cancelled');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.ride_series_drop_unbooked(uuid) from public, anon, authenticated;

-- ── 5. ride_listing_emergency (0517) ──────────────────────────────────────────────────────────

create or replace function public.ride_listing_emergency(p_listing_id uuid, p_note text default null)
returns public.ride_listing_emergencies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post public.posts;              -- 0623: the ride's post
  v_ride public.ride_post_details;  -- 0623: and its schedule
  v_departs timestamptz;
  v_until timestamptz;
  v_row public.ride_listing_emergencies;
  v_to uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_post from public.posts                                          -- 0623
   where post_id = public.post_id_of_listing(p_listing_id) and world_slug = 'rides'; -- 0623
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_uid not in (select public.ride_listing_participants(p_listing_id)) then
    raise exception 'not_participant' using errcode = '42501';
  end if;

  -- Active window: 1 hour before departure until 2 hours after the estimated end.
  select * into v_ride from public.ride_post_details where post_id = v_post.post_id; -- 0623
  v_departs := v_ride.departs_at; -- 0623
  v_until := coalesce(v_ride.arrives_at, v_departs + interval '6 hours') -- 0623
             + interval '2 hours';
  if v_departs is null or now() < v_departs - interval '1 hour' or now() > v_until then
    raise exception 'ride_not_active' using errcode = '23514';
  end if;

  if exists (select 1 from public.ride_listing_emergencies
              where listing_id = p_listing_id and triggered_by = v_uid
                and triggered_at > now() - interval '5 minutes') then
    raise exception 'emergency_throttled' using errcode = '23514';
  end if;

  insert into public.ride_listing_emergencies (listing_id, triggered_by, note)
  values (p_listing_id, v_uid, nullif(btrim(p_note), ''))
  returning * into v_row;

  -- Everyone else on the ride and every super admin hears it at once (critical).
  for v_to in
    select p from public.ride_listing_participants(p_listing_id) p where p <> v_uid
    union
    select u.user_id from public.users u where public.has_admin_role(u.user_id, 'super_admin')
  loop
    perform public.enqueue_notification(
      v_to, 'critical', 'ride_listing_emergency',
      'notifications.rideEmergencyTitle', 'notifications.rideEmergencyBody',
      jsonb_build_object('rideTitle', coalesce(v_post.title, '')), -- 0623: the post's title
      jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                         'params', jsonb_build_object('listingId', p_listing_id::text)),
      'ride_listing_emergency:' || v_row.event_id::text || ':' || v_to::text,
      true);
  end loop;
  return v_row;
end;
$$;

revoke all on function public.ride_listing_emergency(uuid, text) from public;
grant execute on function public.ride_listing_emergency(uuid, text) to authenticated;

-- ── 6. complete_ride_listing (0558): owner, status and departure from the post ───────────────

create or replace function public.complete_ride_listing(p_listing_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_listing_id uuid := public.listing_id_of_post(v_post_id); -- 0623: the derived listing, closed below
  v_post public.posts;                                        -- 0623: the ride's post
  v_departs timestamptz;
  v_completed integer := 0;
  v_h public.post_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  -- 0623: the ride's writers still serialize on the listing row until they move (6a-4b).
  perform 1 from public.listings where listing_id = v_listing_id for update;
  select * into v_post from public.posts                                  -- 0623
   where post_id = v_post_id and world_slug = 'rides' and direction = 'offer'; -- 0623
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_post.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if; -- 0623
  -- 0623: open and published (listing_feed_mirror_status, 0551).
  if v_post.status <> 'open' then raise exception 'invalid_status' using errcode = '23514'; end if;
  select r.departs_at into v_departs from public.ride_post_details r where r.post_id = v_post_id; -- 0623
  if v_departs is not null and v_departs > now() + interval '1 hour' then
    raise exception 'ride_not_started' using errcode = '23514';
  end if;
  for v_h in
    update public.post_handoffs
       set status = 'handed_over', handed_over_at = now(), confirmed_at = coalesce(confirmed_at, now())
     where post_id = v_post_id and world_slug = 'rides' and status = 'confirmed'
     returning *
  loop
    perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, v_h.handoff_id);
    v_completed := v_completed + 1;
  end loop;
  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'system'
   where post_id = v_post_id and world_slug = 'rides' and status = 'reserved';
  update public.listings set status = 'closed', updated_at = now()
   where listing_id = v_listing_id; -- 0623
  return v_completed;
end;
$$;

revoke all on function public.complete_ride_listing(uuid) from public, anon, authenticated;
grant execute on function public.complete_ride_listing(uuid) to authenticated;

-- ── 7. ride_route_alert_deliver (0516) ────────────────────────────────────────────────────────

-- Delivers one alert under the S44 rules; returns its new status ('pending' = still waiting).
-- Called by the listings insert trigger after listings_feed_mirror_sync (triggers fire in name
-- order), so the ride's post and details already exist.
create or replace function public.ride_route_alert_deliver(p_route_id uuid, p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert public.ride_route_alerts;
  v_post public.posts;              -- 0623: the ride's post
  v_ride public.ride_post_details;  -- 0623: and its schedule and route
  v_departs timestamptz;
  v_quiet_end timestamptz;
  v_status text;
begin
  select * into v_alert from public.ride_route_alerts
   where route_id = p_route_id and listing_id = p_listing_id and status = 'pending' for update skip locked;
  if not found then return null; end if;
  select * into v_post from public.posts where post_id = public.post_id_of_listing(p_listing_id); -- 0623
  select * into v_ride from public.ride_post_details where post_id = v_post.post_id;             -- 0623
  v_departs := v_ride.departs_at; -- 0623

  -- 0623: open and published (listing_feed_mirror_status, 0551); no post is not open.
  if v_post.status is distinct from 'open' or v_departs is null or v_departs <= now() then
    v_status := 'skipped';
  elsif (select count(*) from public.ride_route_alerts a
          where a.user_id = v_alert.user_id and a.status = 'sent'
            and a.delivered_at >= date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem') >= 10 then
    v_status := 'capped';
  else
    v_quiet_end := public.ride_quiet_window_end(v_alert.user_id);
    -- Quiet hours hold an alert back unless the ride leaves before they end (urgent, S44).
    if v_quiet_end is not null and v_departs >= v_quiet_end then return 'pending'; end if;
    perform public.enqueue_notification(
      v_alert.user_id, 'critical', 'ride_route_match',
      'notifications.rideRouteMatchTitle', 'notifications.rideRouteMatchBody',
      jsonb_build_object(
        'origin', coalesce(v_ride.origin_label, ''), -- 0623
        'dest', coalesce(v_ride.dest_label, ''),     -- 0623
        'when', to_char(v_departs at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI')),
      jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                         'params', jsonb_build_object('listingId', p_listing_id::text)),
      'ride_route_match:' || v_alert.user_id::text || ':' || p_listing_id::text,
      true);
    v_status := 'sent';
  end if;

  update public.ride_route_alerts set status = v_status, delivered_at = now()
   where route_id = p_route_id and listing_id = p_listing_id;
  return v_status;
end;
$$;

revoke all on function public.ride_route_alert_deliver(uuid, uuid) from public, anon, authenticated;

-- ── 8. ops.check_rides_open_after_departure (0463) ────────────────────────────────────────────

-- Ride offers still open six hours after departure: nothing closed them.
create or replace function ops.check_rides_open_after_departure()
returns ops.health_result
language sql
stable
set search_path = ops, public, pg_temp
as $$
  select count(*)::numeric,
         format('%s rides open more than 6 h after departure', count(*))
    from public.posts p                                       -- 0623: the ride's post
    join public.ride_post_details r on r.post_id = p.post_id  -- 0623: and its schedule
   where p.world_slug = 'rides'                               -- 0623
     and p.status = 'open' -- 0623: open and published (listing_feed_mirror_status, 0551)
     and r.departs_at < now() - interval '6 hours';           -- 0623
$$;
revoke all on function ops.check_rides_open_after_departure() from public, anon, authenticated;

commit;
