-- 0743_ride_cancel_notifies_passengers | A driver may cancel a ride that has bookings, and ending a
-- recurring ride cancels its booked dates too; each passenger is told (FR-RIDE-047, FR-RIDE-046
-- AC6; PM decisions {{D:owner-cancel-notifies-registrants}}, {{D:series-end-cancels-booked}})
--
-- Until now a booked seat blocked the driver: pause and delete refused (`listing_has_active_handoff`),
-- and cancelling a recurring ride kept its booked dates as single rides. D131 already lets an
-- organizer call off an event with registrations; rides now follow the same rule:
--
-- 1. `kc_private.ride_cancel_open_bookings(post)`: before departure, cancels the ride's requested
--    and confirmed seats as `host_cancelled`. The ride push trigger tells each passenger
--    (`ride_booking_withdrawn`, step 2). After departure nothing changes: the trip ran, or it lapses
--    through the expiry sweep (0734).
-- 2. `ride_booking_notify`: a `host_cancelled` seat sends `ride_booking_withdrawn` to the passenger.
--    A single booking the driver cancels (`driver_cancelled`) keeps `ride_booking_cancelled`.
-- 3. Triggers: a ride post that leaves open / paused for paused, deleted or removed, or that is
--    hard-deleted, cancels its open seats first, whichever writer moves it.
-- 4. The post status guard (`posts_enforce_status_fsm`, 0681) and `pause_my_listing`,
--    `delete_my_listing` (0686): a ride's seats no longer block (one filter changed in each).
--    A completed trip (`handed_over`) still blocks a delete: it is the passenger's record too.
-- 5. `set_ride_series_status(.., 'cancelled')`: every upcoming date goes. A date nobody booked is
--    deleted as before; a booked date is closed (`deleted_no_recipient`), so its passengers are told
--    and keep the record of the ride they had booked. Pausing still removes only unbooked dates.

-- ── 1. Cancel a ride's open seats before departure ──────────────────────────────
create or replace function kc_private.ride_cancel_open_bookings(p_post_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- Only a ride that has not left; a departed ride's seats settle through the trip or the sweep.
  if not exists (
    select 1 from public.ride_post_details r
     where r.post_id = p_post_id and r.departs_at > now()
  ) then
    return 0;
  end if;

  -- Each update fires `post_handoffs_ride_notify`, which tells the passenger (step 2).
  update public.post_handoffs
     set status = 'cancelled', cancel_reason = 'host_cancelled', cancelled_at = now()
   where post_id = p_post_id
     and world_slug = 'rides'
     and status in ('reserved', 'confirmed');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function kc_private.ride_cancel_open_bookings(uuid) is
  'FR-RIDE-047 (0743): before departure, cancels a ride''s requested and confirmed seats (host_cancelled); the ride push trigger tells each passenger.';

revoke all on function kc_private.ride_cancel_open_bookings(uuid) from public, anon, authenticated;
grant execute on function kc_private.ride_cancel_open_bookings(uuid) to service_role;

-- ── 2. The passenger's push when the driver calls the ride off ──────────────────
create or replace function public.ride_booking_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text;
  v_kind text;
  v_to uuid;
  v_actor uuid;
begin
  if tg_op = 'INSERT' and new.status = 'reserved' then
    v_kind := 'ride_booking_requested'; v_to := new.owner_id; v_actor := new.recipient_id;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'confirmed' then
      v_kind := 'ride_booking_confirmed'; v_to := new.recipient_id; v_actor := new.owner_id;
    elsif new.status = 'cancelled' then
      case new.cancel_reason
        when 'declined' then v_kind := 'ride_booking_declined'; v_to := new.recipient_id; v_actor := new.owner_id;
        when 'expired' then v_kind := 'ride_booking_expired'; v_to := new.recipient_id; v_actor := new.owner_id;
        when 'passenger_cancelled' then v_kind := 'ride_booking_cancelled'; v_to := new.owner_id; v_actor := new.recipient_id;
        -- 0743: the driver called the whole ride off (a pause, a delete or the series ended).
        when 'host_cancelled' then v_kind := 'ride_booking_withdrawn'; v_to := new.recipient_id; v_actor := new.owner_id;
        else
          -- 0734: a seat cancelled by the system on an expired ride: the ride did not run.
          if new.cancel_reason = 'system'
             and exists (select 1 from public.posts p where p.post_id = new.post_id and p.status = 'expired') then
            v_kind := 'ride_booking_lapsed';
          else
            v_kind := 'ride_booking_cancelled';
          end if;
          v_to := new.recipient_id; v_actor := new.owner_id;
      end case;
    end if;
  end if;
  if v_kind is null then return new; end if;

  select title into v_title from public.posts where post_id = new.post_id;
  perform public.enqueue_notification(
    v_to, 'critical', v_kind,
    'notifications.' || public.ride_booking_copy_key(v_kind) || 'Title',
    'notifications.' || public.ride_booking_copy_key(v_kind) || 'Body',
    jsonb_build_object(
      'name', coalesce((select display_name from public.users where user_id = v_actor), ''),
      'rideTitle', coalesce(v_title, ''),
      'seats', new.seats),
    jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                       'params', jsonb_build_object(
                         'listingId', public.listing_id_of_post(new.post_id)::text)),
    v_kind || ':' || new.handoff_id::text,
    false
  );
  return new;
end;
$$;


-- ── 3. Every move that takes a ride off the air cancels its seats first ─────────
create or replace function kc_private.posts_ride_owner_move_cancels_bookings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A completed trip (`closed_delivered`) settles its seats through `complete_ride_listing`.
  if old.status in ('open', 'paused')
     and new.status in ('paused', 'deleted_no_recipient', 'removed_admin')
     and old.status is distinct from new.status then
    perform kc_private.ride_cancel_open_bookings(new.post_id);
  end if;
  return null;
end;
$$;

revoke all on function kc_private.posts_ride_owner_move_cancels_bookings() from public, anon, authenticated;

drop trigger if exists posts_ride_owner_move_cancels_bookings on public.posts;
create trigger posts_ride_owner_move_cancels_bookings
  after update of status on public.posts
  for each row when (new.world_slug = 'rides' or new.post_type = 'ride')
  execute function kc_private.posts_ride_owner_move_cancels_bookings();

-- A post delete is a hard delete: the seats go with it in the cascade and no status trigger runs,
-- so the passengers are told before the row goes.
create or replace function kc_private.posts_ride_delete_notifies_bookings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform kc_private.ride_cancel_open_bookings(old.post_id);
  return old;
end;
$$;

revoke all on function kc_private.posts_ride_delete_notifies_bookings() from public, anon, authenticated;

drop trigger if exists posts_ride_delete_notifies_bookings on public.posts;
create trigger posts_ride_delete_notifies_bookings
  before delete on public.posts
  for each row when (old.world_slug = 'rides' or old.post_type = 'ride')
  execute function kc_private.posts_ride_delete_notifies_bookings();

-- ── 4. The post status guard and the owner RPCs: a ride's seats do not block ───
-- 0681 body, one filter changed; the 0665 trigger calls it by name.
create or replace function public.posts_enforce_status_fsm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text := old.status;
  v_to   text := new.status;
begin
  -- Same status: not a transition; nothing to check.
  if v_from is not distinct from v_to then
    return new;
  end if;

  -- The graph: one catalog, shared with @kc/domain. Kernel codes map back to the code
  -- clients already handle (23514 posts_status_transition_invalid).
  begin
    perform public.fsm_assert_transition('post', v_from, v_to, null);
  exception
    when sqlstate 'P0001' then
      if sqlerrm in ('illegal_transition', 'unknown_state') then
        raise exception 'posts_status_transition_invalid'
          using errcode = '23514',
                detail = format('invalid status transition from %s to %s', v_from, v_to);
      end if;
      raise;
  end;

  -- Owner guards per spec 07 §7.1 and D104 (unchanged from 0665). They read other rows,
  -- so they stay beside the kernel call rather than in the graph.
  -- 1. Resuming a paused post whose expiry has passed is refused.
  if v_from = 'paused' and v_to = 'open'
     and new.expires_at is not null and new.expires_at <= now() then
    raise exception 'listing_expired'
      using errcode = '23514', detail = 'cannot resume an expired post';
  end if;

  -- 2. Pausing, or deleting a live post, while a reservation / booking is active is
  --    refused. Event registrations (`time`, 0665) and ride seats (`rides`, 0743) do not
  --    block: the after-update triggers cancel them and tell each holder.
  if (v_to = 'paused' or (v_to = 'deleted_no_recipient' and v_from in ('open', 'paused')))
     and exists (
       select 1 from public.post_handoffs h
        where h.post_id = new.post_id
          and h.world_slug not in ('time', 'rides')
          and h.status in ('reserved', 'confirmed')
     ) then
    raise exception 'listing_has_active_handoff'
      using errcode = '23514',
            detail = case when v_to = 'paused'
                          then 'cannot pause a post with an active handoff'
                          else 'cannot delete a post with an active handoff' end;
  end if;

  return new;
end;
$$;

create or replace function public.pause_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts := public.post_lock_own_listing(p_listing_id);
  v_lid uuid;
  v_status text;
begin
  if v_post.post_id is not null then
    if v_post.status <> 'open' then
      raise exception 'listing_wrong_status' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.post_handoffs h
       where h.post_id = v_post.post_id
         and h.world_slug not in ('time', 'rides')  -- 0743: event registrations and ride seats are cancelled, not blocking
         and h.status in ('reserved', 'confirmed')
    ) then
      raise exception 'listing_has_active_handoff' using errcode = '23514';
    end if;
    perform public.post_record_set_status(v_post, 'paused');
    update public.posts set availability_status = 'ongoing', updated_at = now()
     where post_id = v_post.post_id;

    v_lid := coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post.post_id));
    if v_lid is not null then
      update public.listings set availability_status = 'ongoing', updated_at = now()
       where listing_id = v_lid;
    end if;
    return;
  end if;

  select status into v_status from public.listings where listing_id = p_listing_id and owner_id = auth.uid() for update;
  if v_status <> 'open' then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(p_listing_id) then
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  update public.listings
     set status = 'cancelled', availability_status = 'ongoing', updated_at = now()
   where listing_id = p_listing_id;
end;
$$;

create or replace function public.delete_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts := public.post_lock_own_listing(p_listing_id);
  v_lid uuid;
  v_status text;
begin
  if v_post.post_id is not null then
    if v_post.status not in ('open', 'paused', 'closed_delivered') then
      raise exception 'listing_wrong_status' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.post_handoffs h
       where h.post_id = v_post.post_id
         and h.world_slug not in ('time', 'rides')  -- 0743: event registrations and ride seats are cancelled, not blocking
         and h.status in ('reserved', 'confirmed')
    ) then
      raise exception 'listing_has_active_handoff' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.post_handoffs h
       where h.post_id = v_post.post_id and h.world_slug <> 'time' and h.status = 'handed_over'
    ) then
      raise exception 'listing_has_handoff_history' using errcode = '23514';
    end if;

    v_lid := coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post.post_id));
    if v_lid is not null then
      delete from public.listing_media where listing_id = v_lid;
      delete from public.listings where listing_id = v_lid;
    end if;
    delete from public.posts where post_id = v_post.post_id;
    return;
  end if;

  select status into v_status from public.listings where listing_id = p_listing_id and owner_id = auth.uid() for update;
  if v_status not in ('open', 'cancelled', 'closed') then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(p_listing_id) then
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.post_handoffs h
     where h.post_id = public.post_id_of_listing(p_listing_id)
       and h.world_slug <> 'time'
       and h.status = 'handed_over'
  ) then
    raise exception 'listing_has_handoff_history' using errcode = '23514';
  end if;
  delete from public.listing_media where listing_id = p_listing_id;
  delete from public.listings where listing_id = p_listing_id;
end;
$$;

-- ── 5. Ending a recurring ride ends every upcoming date ─────────────────────────
-- An upcoming booked date is closed, not deleted: the status trigger (step 3) cancels its seats
-- and tells each passenger, and the passenger keeps the record of the ride they had booked.
create or replace function kc_private.ride_series_close_booked_upcoming(p_series_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post  public.posts;
  v_count int := 0;
begin
  for v_post in
    select p.* from public.ride_post_details r
      join public.posts p on p.post_id = r.post_id
     where r.series_id = p_series_id
       and r.departs_at > now()
       and p.status in ('open', 'paused')
     for update of p
  loop
    perform public.post_record_set_status(v_post, 'deleted_no_recipient');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function kc_private.ride_series_close_booked_upcoming(uuid) is
  'FR-RIDE-046 AC6 (0743): closes a cancelled series'' upcoming dates that still have bookings; the status trigger cancels and notifies their seats.';

revoke all on function kc_private.ride_series_close_booked_upcoming(uuid) from public, anon, authenticated;

-- 0666 body; the cancelled branch now ends the booked upcoming dates before detaching the rest.
create or replace function public.set_ride_series_status(p_series_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
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
  -- Pausing and cancelling both remove the upcoming dates nobody booked.
  perform public.ride_series_drop_unbooked(s.series_id);
  if p_status = 'cancelled' then
    -- 0743 ({{D:series-end-cancels-booked}}): the booked upcoming dates end too, and their
    -- passengers are told.
    perform kc_private.ride_series_close_booked_upcoming(s.series_id);
    -- 0666: what remains (departed dates) is detached from the ended series; `listings` is a view
    -- over posts since 0667, so the post is the only row to write. The dates just closed keep
    -- their marker as their history: rewriting a closed post's details would replay its status
    -- through the listing mirror.
    update public.posts p
       set details = p.details - 'ride_series', updated_at = now()
      from public.ride_post_details r
     where r.post_id = p.post_id and r.series_id = s.series_id
       and p.status <> 'deleted_no_recipient';
  end if;
end;
$$;
