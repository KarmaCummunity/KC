-- 0624_g1_ride_writers_on_posts | G1 step 6a-4b (ADR-006, D-214, issue #1671): the ride writers
-- write and lock the post — `posts` + `ride_post_details`, the record — instead of `listings`, the
-- derived copy.
--
-- 0623 moved the ride readers; these writers still created, deleted, closed or locked the listing
-- first and let the mirror sync carry the change to the post:
--   1. ride_post_set_status (new)    sets a ride's status where its record is (below)
--   2. ride_series_materialize_day (0531)  an occurrence is published as a post, like a one-off
--      ride from the create form (create_marketplace_listing, 0554): the listing is derived
--      (listing_upsert_from_post) and every listing-side rule still runs on it; the "already
--      exists" check reads ride_post_details (series_id, series_on)
--   3. create_ride_series (0531)     its first occurrence is found on the post side
--   4. ride_series_drop_unbooked (0623)  deletes the unbooked occurrences' posts
--   5. set_ride_series_status (0531) cancelling detaches the booked occurrences on their posts
--   6. ride_series_sweep (0557)      expires departed request occurrences and exposes the next
--      occurrence in the main feed on the post (`feed_hidden`)
--   7. rides_expired_listings_sweep (0514)  expires overdue ride offers on the post
--   8. book_ride_seat, confirm_ride_booking, complete_ride_trip (0622), complete_ride_listing (0623)
--      lock the ride's post (not its listing), read the departure and seats from ride_post_details,
--      and close the ride on its post
-- Each body is the latest definition copied verbatim; every changed line carries a `-- 0624:` note.
-- Names, arguments, return types, error codes and grants are unchanged; listing ids stay in the
-- returned shapes, so the app is unaffected.
--
-- Two shapes of a ride stay in the data and both keep working:
--   * post-owned: the post is the record and its listing is derived (`listings.legacy_post_id` =
--     the post): one-off rides from the create form (0554), the rides 0554 backfilled, and every
--     occurrence materialized from this file on;
--   * listing-sourced: a native listing with a mirror post (`posts.listing_id`, no
--     legacy_post_id): the occurrences materialized between 0554 and this file, and rides
--     inserted directly (tests, intake). `post_owns_listing` (0554) tells them apart.
-- Every ride has its post (0557), so the writers select, lock and check the post for both shapes.
-- A status change or a detach is written where the record is: on a post-owned ride the post
-- changes and the listing follows (listing_upsert_from_post); on a listing-sourced one the listing
-- changes and the post follows (the mirror sync), as before. Deleting an occurrence deletes its
-- post (the listing goes with it through legacy_post_id) or, for the older shape, its listing (the
-- post goes with it through posts.listing_id). The ride's status maps both ways through
-- listing_status_for_post / listing_feed_mirror_status (0554 / 0551): closed ↔ closed_delivered,
-- expired ↔ expired.
--
-- On existing data the output is the same, except:
--   * a new occurrence's listing is derived from its post: it carries the post's title (at most
--     80 characters, where the listing allowed 120; a series' title is the occurrence's) and the
--     owner's city with its point (the post's city, as a one-off ride without a city gets);
--   * a series of a kind other than the one a ride post derives to (ride_offer for an offer,
--     ride_request for a request) keeps the listing-first insert, as create_marketplace_listing does;
--   * a ride listing left `open` while not published (a moderation hold) is not open on its post:
--     it is not booked, expired, dropped or exposed by these writers (0623 made the readers agree);
--   * the sweep no longer creates a post for an occurrence that has none — every published open
--     listing has had one since 0557 — and a v1 ride listing of origin 'ride_listing' (no post, G44)
--     is no longer expired by the offer sweep (since 0623 it is in no rides reader either);
--   * until the owner management RPCs (0543 / 0554, 6a-5) lock the post too, a booking racing a
--     pause or delete of the same ride ends with one of the two refused by Postgres's deadlock
--     check (40P01) instead of waiting; both still never commit together.
-- Left for later: the listing visibility rule (`is_listing_visible_to`, 6a-5), the owner management
-- RPCs that lock the listing first (6a-5), the listing triggers and the listings index that keeps
-- one occurrence per series and day (6c). Idempotent (create or replace); no schema change.

begin;

-- ── 1. ride_post_set_status (new) ─────────────────────────────────────────────────────────────

-- Sets the status of ride p_post where its record is: on a post-owned ride the post (its listing
-- follows through listing_upsert_from_post); on a listing-sourced ride its listing, as
-- listing_status_for_post maps the status (the post follows through the mirror sync). The caller
-- holds the post's row lock.
create or replace function public.ride_post_set_status(p_post public.posts, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.post_owns_listing(p_post) then
    update public.posts set status = p_status, updated_at = now()
     where post_id = p_post.post_id and status is distinct from p_status;
  else
    update public.listings set status = public.listing_status_for_post(p_status), updated_at = now()
     where listing_id = p_post.listing_id;
  end if;
end;
$$;

comment on function public.ride_post_set_status(public.posts, text) is
  'G1 (0624): sets a ride''s status on its record — the post when it owns its listing, else the listing-sourced listing; the other side follows.';

revoke all on function public.ride_post_set_status(public.posts, text) from public, anon, authenticated;
grant execute on function public.ride_post_set_status(public.posts, text) to service_role;

-- ── 2. ride_series_materialize_day (0531) ─────────────────────────────────────────────────────

-- Inserts the occurrence of one series on one day unless it exists or already departed.
-- 0624: Returns 1 when an occurrence was created: a post, whose listing is derived; the listing
-- 0624: triggers do the rest (official places, expiry, cost cap, route alerts).
create or replace function public.ride_series_materialize_day(p_series public.ride_series, p_on date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_departs timestamptz := (p_on + p_series.depart_time) at time zone 'Asia/Jerusalem';
  v_details jsonb;
  v_direction text := case when p_series.direction = 'request' then 'request' else 'offer' end; -- 0624: the post's word
  v_hidden boolean; -- 0624
begin
  if (p_series.weekdays & (1 << extract(dow from p_on)::int)) = 0 or v_departs <= now() then
    return 0;
  end if;
  if exists (select 1 from public.ride_post_details r -- 0624: the occurrences of both shapes, on the post side
              where r.series_id = p_series.series_id   -- 0624
                and r.series_on = p_on) then           -- 0624
    return 0;
  end if;

  v_details := p_series.details
    || jsonb_build_object('departs_at', v_departs, 'ride_series', public.ride_series_marker(p_series, p_on));
  if p_series.duration_minutes is not null then
    v_details := v_details
      || jsonb_build_object('arrives_at', v_departs + make_interval(mins => p_series.duration_minutes));
  end if;

  -- 0624: the occurrence is a post, as a one-off ride from the create form (0554); the listing is
  -- derived by the posts → listings trigger and a refusal there rolls the post back too.
  if public.listing_kind_for_post('rides', v_direction) = p_series.kind_id then -- 0624
    -- 0624: listed in the main feed only when it is the soonest upcoming open occurrence (0531, 0557).
    v_hidden := not exists (select 1 from public.worlds w where w.slug = 'rides' and w.feed_mirror)
      or exists (select 1 from public.ride_post_details r
                   join public.posts o on o.post_id = r.post_id
                  where r.series_id = p_series.series_id
                    and o.status = 'open' -- open and published (listing_feed_mirror_status, 0551)
                    and r.departs_at > now()
                    and r.departs_at < v_departs);
    begin
      insert into public.posts (                                                                 -- 0624
        owner_id, type, visibility, title, description, category, city, street, street_number,  -- 0624
        location_display_level, world_slug, direction, post_type, details, expires_at, feed_hidden -- 0624
      ) values (                                                                                 -- 0624
        p_series.owner_id, case when v_direction = 'request' then 'Request' else 'Give' end, 'Public', -- 0624
        left(p_series.title, 80), nullif(trim(coalesce(p_series.summary, '')), ''), 'Other',      -- 0624
        coalesce((select u.city from public.users u where u.user_id = p_series.owner_id), 'tel-aviv'), -- 0624
        'Marketplace', '1', 'CityOnly', 'rides', v_direction, 'ride', v_details,                  -- 0624
        -- A request occurrence leaves the feed once its day has passed (an offer sets its own, 0514).
        v_departs + interval '30 minutes', v_hidden                                              -- 0624
      );
    exception when unique_violation then
      return 0; -- a concurrent run created this day first (the derived listing's index, 0531) -- 0624
    end;
    return 1;
  end if;

  -- 0624: a series of another kind keeps the listing-first insert (create_marketplace_listing, 0554).
  begin
    insert into public.listings (
      owner_id, world_slug, kind_id, direction, title, summary, details, origin, moderation_status, expires_at
    ) values (
      p_series.owner_id, 'rides', p_series.kind_id, p_series.direction, p_series.title, p_series.summary,
      v_details, 'native', 'published',
      -- A request occurrence leaves the feed once its day has passed (an offer sets its own, 0514).
      v_departs + interval '30 minutes'
    );
  exception when unique_violation then
    return 0; -- a concurrent run created this day first
  end;
  return 1;
end;
$$;

revoke all on function public.ride_series_materialize_day(public.ride_series, date) from public, anon, authenticated;

-- ── 3. create_ride_series (0531) ──────────────────────────────────────────────────────────────

-- Publishes a recurring ride and its first occurrences. Returns the series and the soonest
-- occurrence, which the app opens.
create or replace function public.create_ride_series(
  p_kind_id uuid,
  p_title text,
  p_details jsonb,
  p_direction text,
  p_depart_time time,
  p_weekdays int,
  p_summary text default null,
  p_duration_minutes int default null,
  p_ends_on date default null
)
returns table (series_id uuid, first_listing_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kind public.listing_kinds;
  v_dir text;
  v_details jsonb := coalesce(p_details, '{}'::jsonb) - 'departs_at' - 'arrives_at' - 'ride_series';
  v_series_id uuid;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if not public.is_active_member(v_uid) then
    raise exception 'member_inactive' using errcode = '42501';
  end if;

  select * into v_kind from public.listing_kinds where kind_id = p_kind_id and is_active;
  if not found or v_kind.world_slug <> 'rides' then
    raise exception 'kind_not_found' using errcode = 'P0002';
  end if;
  v_dir := coalesce(p_direction, case when v_kind.direction = 'either' then 'give' else v_kind.direction end);
  if v_dir not in ('give', 'request') then
    raise exception 'invalid_direction' using errcode = '22023';
  end if;
  if p_depart_time is null then
    raise exception 'ride_time_invalid' using errcode = '23514';
  end if;
  perform public.ride_series_check_schedule(p_weekdays, p_duration_minutes, p_ends_on);
  -- The template is checked as the occurrence it becomes (the schema requires a departure).
  if not public.validate_listing_details(p_kind_id, v_details || jsonb_build_object('departs_at', now())) then
    raise exception 'details_schema_mismatch' using errcode = '23514';
  end if;

  insert into public.ride_series (owner_id, kind_id, direction, title, summary, details,
                                  depart_time, weekdays, duration_minutes, ends_on)
  values (v_uid, p_kind_id, v_dir, p_title, p_summary, v_details,
          p_depart_time, p_weekdays, p_duration_minutes, p_ends_on)
  returning ride_series.series_id into v_series_id;

  if public.ride_series_materialize(v_series_id) = 0 then
    raise exception 'ride_series_no_occurrence' using errcode = '23514';
  end if;

  -- 0624: the soonest occurrence on the post side; read after the statement that created it.
  return query
    select v_series_id,
           public.listing_id_of_post(                      -- 0624: the listing the app opens
             (select r.post_id from public.ride_post_details r -- 0624
               where r.series_id = v_series_id                 -- 0624
               order by r.departs_at limit 1));                -- 0624
end;
$$;

revoke all on function public.create_ride_series(uuid, text, jsonb, text, time, int, text, int, date) from public, anon;
grant execute on function public.create_ride_series(uuid, text, jsonb, text, time, int, text, int, date) to authenticated;

-- ── 4. ride_series_drop_unbooked (0623) ───────────────────────────────────────────────────────

-- Removes the upcoming occurrences of a series that nobody booked. A booked occurrence is an
-- agreed ride: it stays, and the driver handles it like any single ride.
create or replace function public.ride_series_drop_unbooked(p_series_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;     -- 0624
  v_post public.posts;  -- 0624: an occurrence's post
begin
  for v_post in                                            -- 0624: the occurrences, on the post side
    select p.* from public.ride_post_details r              -- 0624
      join public.posts p on p.post_id = r.post_id          -- 0624
     where r.series_id = p_series_id                        -- 0624
       and p.status = 'open' -- 0624: open and published (listing_feed_mirror_status, 0551)
       and r.departs_at > now()                             -- 0624
       and not exists (select 1 from public.post_handoffs h
                        where h.post_id = p.post_id         -- 0624
                          and h.status <> 'cancelled')
  loop
    if public.post_owns_listing(v_post) then                -- 0624
      delete from public.posts where post_id = v_post.post_id; -- 0624: its listing goes too (legacy_post_id)
    else
      -- 0624: an occurrence materialized before 0624: its listing is the record (posts.listing_id cascades).
      delete from public.listings where listing_id = v_post.listing_id;
    end if;
    v_count := v_count + 1;                                 -- 0624
  end loop;
  return v_count;
end;
$$;

revoke all on function public.ride_series_drop_unbooked(uuid) from public, anon, authenticated;

-- ── 5. set_ride_series_status (0531) ──────────────────────────────────────────────────────────

-- active ↔ paused; either → cancelled (terminal). Pausing removes the upcoming unbooked
-- occurrences; resuming publishes them again; cancelling also detaches the booked ones, which
-- go on as single rides.
create or replace function public.set_ride_series_status(p_series_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.ride_series := public.ride_series_for_update(p_series_id);
begin
  if p_status not in ('active', 'paused', 'cancelled') then
    raise exception 'ride_series_status_invalid' using errcode = '22023';
  end if;
  if p_status = s.status then
    return;
  end if;

  update public.ride_series set status = p_status where series_id = s.series_id;

  if p_status = 'active' then
    perform public.ride_series_materialize(s.series_id);
    return;
  end if;
  perform public.ride_series_drop_unbooked(s.series_id);
  if p_status = 'cancelled' then
    -- 0624: on the post of a post-owned occurrence; its listing and ride details follow.
    update public.posts p
       set details = p.details - 'ride_series', updated_at = now()  -- 0624
      from public.ride_post_details r                                 -- 0624
     where r.post_id = p.post_id and r.series_id = s.series_id        -- 0624
       and public.post_owns_listing(p);                               -- 0624
    -- 0624: on the listing of an occurrence materialized before 0624 (listing-sourced); its post follows.
    update public.listings
       set details = details - 'ride_series', updated_at = now()
     where details -> 'ride_series' ->> 'id' = s.series_id::text
       and legacy_post_id is null; -- 0624
  end if;
end;
$$;

revoke all on function public.set_ride_series_status(uuid, text) from public, anon;
grant execute on function public.set_ride_series_status(uuid, text) to authenticated;

-- ── 6. ride_series_sweep (0557) ───────────────────────────────────────────────────────────────

create or replace function public.ride_series_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := public.ride_series_materialize(null);
  v_post public.posts; -- 0624: an occurrence's post
  v_next record;       -- 0624: the soonest occurrence of a series
begin
  -- Request occurrences whose departure passed: expired, not closed, so no karma or handoff.
  for v_post in                    -- 0624: read from their posts, locked
    select p.* from public.posts p -- 0624
     where p.world_slug = 'rides'
       and p.direction = 'request'
       and p.status = 'open' -- 0624: open and published (listing_feed_mirror_status, 0551)
       and p.details ? 'ride_series' -- 0624: the post's copy of the marker
       and p.expires_at is not null
       and p.expires_at <= now()
       for update                  -- 0624
  loop
    perform public.ride_post_set_status(v_post, 'expired'); -- 0624: on the record; the other side follows
  end loop;

  -- The soonest upcoming occurrence of every series is listed in the feed: its post is
  -- exposed; the later occurrences keep their hidden posts. 0624: read from the post side; every
  -- published open occurrence has had its post since 0557, so none is created here.
  for v_next in
    select distinct on (r.series_id) r.post_id, p.feed_hidden            -- 0624
      from public.ride_post_details r                                    -- 0624: the occurrences
      join public.posts p on p.post_id = r.post_id                       -- 0624: and their posts
      join public.worlds w on w.slug = p.world_slug and w.feed_mirror    -- 0624
     where p.world_slug = 'rides'                                        -- 0624
       and r.series_id is not null                                       -- 0624
       and p.status = 'open' -- 0624: open and published (listing_feed_mirror_status, 0551)
       and r.departs_at > now()                                          -- 0624
     order by r.series_id, r.departs_at                                  -- 0624
  loop
    if v_next.feed_hidden then -- 0624
      begin
        update public.posts set feed_hidden = false where post_id = v_next.post_id; -- 0624
      exception when others then
        raise warning 'ride_series_sweep: occurrence % not exposed: % (%)', v_next.post_id, sqlerrm, sqlstate; -- 0624
      end;
    end if;
  end loop;
  return v_count;
end;
$$;

comment on function public.ride_series_sweep() is
  'Every 10 min: materializes recurring rides, expires departed request occurrences, exposes the next occurrence''s post in the main feed (FR-RIDE-046, 0557, 0624).';

revoke all on function public.ride_series_sweep() from public, anon, authenticated;
grant execute on function public.ride_series_sweep() to service_role;

-- ── 7. rides_expired_listings_sweep (0514) ────────────────────────────────────────────────────

create or replace function public.rides_expired_listings_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;    -- 0624
  v_post public.posts; -- 0624: a ride's post
begin
  for v_post in                    -- 0624: read from the posts, locked
    select p.* from public.posts p -- 0624
     where p.world_slug = 'rides'
       and p.direction = 'offer' -- 0624: a listing's 'give'
       and p.status = 'open' -- 0624: open and published (listing_feed_mirror_status, 0551)
       and p.expires_at is not null
       and p.expires_at <= now()
       for update                  -- 0624
  loop
    perform public.ride_post_set_status(v_post, 'expired'); -- 0624: on the record; the other side follows
    v_count := v_count + 1;                                 -- 0624
  end loop;
  return v_count;
end;
$$;

comment on function public.rides_expired_listings_sweep() is
  'Every 10 min: open ride offers 30 min past their estimated end (or departure) become expired (D21); written on the ride''s record (0624).';

revoke all on function public.rides_expired_listings_sweep() from public, anon, authenticated;
grant execute on function public.rides_expired_listings_sweep() to service_role;

-- ── 8. The booking writers lock the ride's post (0622, 0623) ──────────────────────────────────

create or replace function public.book_ride_seat(
  p_listing_id uuid,
  p_seats int default 1
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_post public.posts;             -- 0624: the ride's post
  v_ride public.ride_post_details; -- 0624: its schedule and seats
  v_l public.listings;
  v_cap int;
  v_departs timestamptz;
  v_seats int := greatest(1, least(coalesce(p_seats, 1), 8));
  v_handoff_id uuid;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  -- 0624: the ride's post is the record; its row lock serialises bookings.
  select * into v_post from public.posts
   where post_id = v_post_id and world_slug = 'rides'
     and status = 'open' -- 0624: open and published (listing_feed_mirror_status, 0551)
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  -- 0624: who may see the ride is still the listing's rule (6a-5).
  select * into v_l from public.listings where listing_id = public.listing_id_of_post(v_post_id);
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if; -- 0624
  if not public.is_listing_visible_to(v_l, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_post.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if; -- 0624
  if v_post.direction <> 'offer' then raise exception 'not_ride_offer' using errcode = '23514'; end if; -- 0624
  select * into v_ride from public.ride_post_details where post_id = v_post_id; -- 0624
  v_departs := v_ride.departs_at; -- 0624
  if v_departs <= now() then
    raise exception 'ride_departed' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.post_handoffs
     where post_id = v_post_id and recipient_id = v_uid
       and status in ('reserved', 'confirmed')
  ) then
    raise exception 'already_booked' using errcode = '23505';
  end if;
  v_cap := coalesce(v_ride.seats_available, 1); -- 0624
  if public.post_handoff_seats_taken(v_post_id) + v_seats > v_cap then
    raise exception 'seats_exhausted' using errcode = 'P0001';
  end if;
  insert into public.post_handoffs (
    post_id, owner_id, recipient_id, world_slug, status, seats, confirm_by
  ) values (
    v_post_id, v_post.owner_id, v_uid, 'rides', 'reserved', v_seats, -- 0624
    least(now() + interval '12 hours', coalesce(v_departs, now() + interval '12 hours'))
  )
  returning handoff_id into v_handoff_id;
  -- The app reads the derived row (listing_id included) until the one detail screen lands.
  v_row := public.giving_handoff_row_of(v_handoff_id); -- 0622: built from the record
  return v_row;
end;
$$;

revoke all on function public.book_ride_seat(uuid, int) from public, anon;
grant execute on function public.book_ride_seat(uuid, int) to authenticated;

create or replace function public.confirm_ride_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_ride public.ride_post_details; -- 0624: the ride's seats
  v_cap int;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides';
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  -- Lock the ride first, then the booking, as the booking path does (0533).
  perform 1 from public.posts -- 0624: the ride's post
   where post_id = v_h.post_id and world_slug = 'rides' -- 0624
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_h.status <> 'reserved' then raise exception 'invalid_status' using errcode = '23514'; end if;
  select * into v_ride from public.ride_post_details where post_id = v_h.post_id; -- 0624
  v_cap := coalesce(v_ride.seats_available, 1); -- 0624
  if public.post_handoff_seats_taken(v_h.post_id, p_handoff_id) + v_h.seats > v_cap then
    raise exception 'ride_seats_exhausted' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'confirmed', confirmed_at = now()
   where handoff_id = p_handoff_id;
  v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
  return v_row;
end;
$$;

revoke all on function public.confirm_ride_booking(uuid) from public, anon;
grant execute on function public.confirm_ride_booking(uuid) to authenticated;

create or replace function public.complete_ride_trip(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_post public.posts;             -- 0624: the ride's post
  v_ride public.ride_post_details; -- 0624: its schedule and seats
  v_departs timestamptz;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid and v_h.recipient_id <> v_uid then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_h.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  select * into v_post from public.posts where post_id = v_h.post_id for update; -- 0624
  select * into v_ride from public.ride_post_details where post_id = v_h.post_id; -- 0624
  v_departs := v_ride.departs_at; -- 0624
  if v_departs is not null and v_departs > now() + interval '1 hour' then
    raise exception 'ride_not_started' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'handed_over', handed_over_at = now(),
         confirmed_at = coalesce(confirmed_at, now())
   where handoff_id = p_handoff_id;
  -- The ride closes once no booking is live and every seat has been ridden; 0624: it closes on
  -- its record and the other side follows (ride_post_set_status).
  if v_post.status = 'open' -- 0624: open and published (listing_feed_mirror_status, 0551)
     and not exists (
       select 1 from public.post_handoffs h
        where h.post_id = v_h.post_id and h.status in ('reserved', 'confirmed'))
     and (
       select coalesce(sum(h.seats), 0) from public.post_handoffs h
        where h.post_id = v_h.post_id and h.status = 'handed_over'
     ) >= coalesce(v_ride.seats_available, 1) -- 0624
  then
    perform public.ride_post_set_status(v_post, 'closed_delivered'); -- 0624
  end if;
  perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, p_handoff_id);
  v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
  return v_row;
end;
$$;

revoke all on function public.complete_ride_trip(uuid) from public, anon;
grant execute on function public.complete_ride_trip(uuid) to authenticated;

-- complete_ride_listing (0623): 0624: the derived listing id it locked and closed (`v_listing_id`)
-- is gone; the post is locked and the ride closes on its record.
create or replace function public.complete_ride_listing(p_listing_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_post public.posts;                                        -- 0623: the ride's post
  v_departs timestamptz;
  v_completed integer := 0;
  v_h public.post_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  -- 0624: the ride's post is the record; its row lock serialises the ride's writers.
  select * into v_post from public.posts                                  -- 0623
   where post_id = v_post_id and world_slug = 'rides' and direction = 'offer' -- 0623
   for update; -- 0624
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
  perform public.ride_post_set_status(v_post, 'closed_delivered'); -- 0624: on the record; the other side follows
  return v_completed;
end;
$$;

revoke all on function public.complete_ride_listing(uuid) from public, anon, authenticated;
grant execute on function public.complete_ride_listing(uuid) to authenticated;

commit;
