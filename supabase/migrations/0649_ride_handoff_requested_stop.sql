-- FR-RIDE-030 extension — a passenger may request a meeting point when booking; on driver
-- approval it is appended to the ride route (meeting_points), if valid.

begin;

alter table public.post_handoffs
  add column if not exists requested_meeting_point jsonb
    check (
      requested_meeting_point is null
      or (
        jsonb_typeof(requested_meeting_point) = 'object'
        and requested_meeting_point ? 'kind'
        and requested_meeting_point ? 'id'
        and requested_meeting_point ? 'label'
      )
    );

comment on column public.post_handoffs.requested_meeting_point is
  'Optional pickup/meeting place a passenger asked for; merged into ride meeting_points on confirm_ride_booking.';

-- Append one validated meeting point to the ride post details (owner RPC path, service_role).
create or replace function public.ride_post_append_meeting_point(p_post_id uuid, p_place jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts;
  v_details jsonb;
  v_points jsonb;
  v_new_id text := p_place ->> 'id';
  v_origin text;
  v_dest text;
begin
  if p_place is null or v_new_id is null then
    return;
  end if;
  select * into v_post from public.posts where post_id = p_post_id for update;
  if not found or v_post.world_slug <> 'rides' then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  v_details := coalesce(v_post.details, '{}'::jsonb);
  v_points := case when jsonb_typeof(v_details -> 'meeting_points') = 'array' then v_details -> 'meeting_points' else '[]'::jsonb end;
  if jsonb_array_length(v_points) >= 3 then
    raise exception 'too_many_meeting_points' using errcode = '23514';
  end if;
  v_origin := coalesce(v_details ->> 'origin_place_id', v_details ->> 'origin_city_id');
  v_dest := coalesce(v_details ->> 'dest_place_id', v_details ->> 'dest_city_id');
  if v_new_id = v_origin or v_new_id = v_dest then
    raise exception 'stop_matches_endpoint' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_points) pt
     where (pt ->> 'id') = v_new_id
  ) then
    raise exception 'stop_duplicate_city' using errcode = '23514';
  end if;
  v_points := v_points || jsonb_build_array(p_place);
  v_details := jsonb_set(v_details, '{meeting_points}', v_points, true);
  update public.posts set details = v_details, updated_at = now() where post_id = p_post_id;
end;
$$;

revoke all on function public.ride_post_append_meeting_point(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ride_post_append_meeting_point(uuid, jsonb) to service_role;

-- Replace book_ride_seat (0624) with optional requested stop.
drop function if exists public.book_ride_seat(uuid, int);
create or replace function public.book_ride_seat(
  p_listing_id uuid,
  p_seats int default 1,
  p_requested_meeting_point jsonb default null
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_post public.posts;
  v_ride public.ride_post_details;
  v_l public.listings;
  v_cap int;
  v_departs timestamptz;
  v_seats int := greatest(1, least(coalesce(p_seats, 1), 8));
  v_handoff_id uuid;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_post from public.posts
   where post_id = v_post_id and world_slug = 'rides' and status = 'open'
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  select * into v_l from public.listings where listing_id = public.listing_id_of_post(v_post_id);
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if not public.is_listing_visible_to(v_l, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_post.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
  if v_post.direction <> 'offer' then raise exception 'not_ride_offer' using errcode = '23514'; end if;
  select * into v_ride from public.ride_post_details where post_id = v_post_id;
  v_departs := v_ride.departs_at;
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
  v_cap := coalesce(v_ride.seats_available, 1);
  if public.post_handoff_seats_taken(v_post_id) + v_seats > v_cap then
    raise exception 'seats_exhausted' using errcode = 'P0001';
  end if;
  insert into public.post_handoffs (
    post_id, owner_id, recipient_id, world_slug, status, seats, confirm_by, requested_meeting_point
  ) values (
    v_post_id, v_post.owner_id, v_uid, 'rides', 'reserved', v_seats,
    least(now() + interval '12 hours', coalesce(v_departs, now() + interval '12 hours')),
    p_requested_meeting_point
  )
  returning handoff_id into v_handoff_id;
  v_row := public.giving_handoff_row_of(v_handoff_id);
  return v_row;
end;
$$;

revoke all on function public.book_ride_seat(uuid, int, jsonb) from public, anon;
grant execute on function public.book_ride_seat(uuid, int, jsonb) to authenticated;

-- confirm: merge requested stop then confirm (0624).
create or replace function public.confirm_ride_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_ride public.ride_post_details;
  v_cap int;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides';
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  perform 1 from public.posts
   where post_id = v_h.post_id and world_slug = 'rides'
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_h.status <> 'reserved' then raise exception 'invalid_status' using errcode = '23514'; end if;
  select * into v_ride from public.ride_post_details where post_id = v_h.post_id;
  v_cap := coalesce(v_ride.seats_available, 1);
  if public.post_handoff_seats_taken(v_h.post_id, p_handoff_id) + v_h.seats > v_cap then
    raise exception 'ride_seats_exhausted' using errcode = '23514';
  end if;
  if v_h.requested_meeting_point is not null then
    begin
      perform public.ride_post_append_meeting_point(v_h.post_id, v_h.requested_meeting_point);
    exception
      when others then
        raise exception 'stop_request_rejected' using errcode = '23514';
    end;
  end if;
  update public.post_handoffs
     set status = 'confirmed', confirmed_at = now()
   where handoff_id = p_handoff_id;
  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

-- list_ride_bookings: surface requested stop label to the driver UI.
drop function if exists public.list_ride_bookings(uuid);
create or replace function public.list_ride_bookings(p_listing_id uuid)
returns table (
  handoff_id     uuid,
  recipient_id   uuid,
  passenger_name text,
  avatar_url     text,
  seats          int,
  status         text,
  reserved_at    timestamptz,
  confirm_by     timestamptz,
  rated_by_me    boolean,
  requested_stop_label text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
begin
  if auth.uid() is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.posts p
     where p.post_id = v_post_id and p.world_slug = 'rides' and p.owner_id = auth.uid()
  ) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  return query
    select h.handoff_id, h.recipient_id, u.display_name, u.avatar_url, h.seats, h.status,
           h.reserved_at, h.confirm_by,
           exists (select 1 from public.giving_handoff_ratings r
                    where r.handoff_id = h.handoff_id and r.rater_id = auth.uid()),
           left(h.requested_meeting_point ->> 'label', 120)
      from public.post_handoffs h
      join public.users u on u.user_id = h.recipient_id
     where h.post_id = v_post_id
       and h.status in ('reserved', 'confirmed', 'handed_over')
     order by (h.status = 'reserved') desc, h.reserved_at;
end;
$$;

revoke all on function public.list_ride_bookings(uuid) from public, anon;
grant execute on function public.list_ride_bookings(uuid) to authenticated;

commit;
