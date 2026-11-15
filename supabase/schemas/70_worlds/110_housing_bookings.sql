-- Worlds · stay bookings (machine `housing_booking` on post_handoffs + handoff_booking_details)
--
-- request → the host approves or declines → the stay → the host completes it or reports a
-- guest who did not arrive (FR-HOUSING-015 … 020). Overlap protection is a locked check,
-- not an exclusion constraint: capacity is a sum of guests per night, which no constraint
-- can express. Two locks serialize the writers — the post row for the place (capacity per
-- night) and an advisory lock per guest (pending cap, no two overlapping stays) — always
-- taken guest first, post second. Errors: SQLSTATE P0001 — listing_not_available,
-- own_listing, item_already_reserved, verification_required, housing_conduct_required,
-- housing_dates_invalid, housing_dates_unavailable, housing_nights_out_of_range,
-- housing_capacity_exceeded, housing_policy_mismatch, housing_minor_unaccompanied,
-- housing_message_required, housing_pending_cap, housing_booking_overlap,
-- housing_note_too_long, housing_booking_started, housing_cancel_reason_required,
-- housing_not_in_window, handoff_not_found, invalid_status.

-- Serializes everything that depends on the set of one guest's stay bookings.
create function kc_private.housing_guest_lock(p_guest_id uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('housing_guest:' || p_guest_id, 0));
$$;
comment on function kc_private.housing_guest_lock(uuid) is
  'Transaction-scoped lock on one guest''s stay bookings.';

-- Does the guest hold an approved or completed stay that overlaps the dates (FR-HOUSING-015 AC4)?
create function kc_private.housing_guest_has_overlap(p_guest_id uuid, p_check_in date, p_check_out date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.post_handoffs h
      join public.handoff_booking_details d on d.handoff_id = h.id
     where h.recipient_id = p_guest_id and h.machine_id = 'housing_booking'
       and h.status in ('confirmed', 'handed_over')
       and d.check_in_date < p_check_out and d.check_out_date > p_check_in);
$$;
comment on function kc_private.housing_guest_has_overlap(uuid, date, date) is
  'The guest already holds an approved stay overlapping the dates.';

-- A verified guest who accepted the code of conduct asks to stay. The request waits for
-- the host and lapses 24 hours after it was made or at the end of the check-in time of
-- its first day, whichever is earlier (S52). A guest holds at most three waiting requests.
create function public.request_housing_booking(
  p_post_id uuid, p_check_in date, p_check_out date, p_adults integer, p_minors integer default 0,
  p_message text default null, p_minors_guardian_ack boolean default false)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_today constant date := (now() at time zone 'Asia/Jerusalem')::date;
  v_party constant integer := coalesce(p_adults, 0) + coalesce(p_minors, 0);
  v_post public.posts;
  v_stay public.post_housing_details;
  v_deadline timestamptz;
  v_handoff public.post_handoffs;
begin
  perform kc_private.housing_guest_lock(v_user_id);
  select p.* into v_post from public.posts p where p.id = p_post_id for update;
  select s.* into v_stay from public.post_housing_details s where s.post_id = p_post_id;
  if not found or not kc_private.post_bookable_by(v_post, v_user_id) then
    raise exception 'listing_not_available' using errcode = 'P0001';
  end if;
  perform kc_private.housing_assert_eligible(v_user_id, v_post.world_slug);

  -- Last moment to arrive on the first day; a check-in that ends after midnight belongs
  -- to the next calendar day.
  v_deadline := (p_check_in + (v_stay.check_in_until <= v_stay.check_in_from)::integer + v_stay.check_in_until)
                at time zone 'Asia/Jerusalem';
  if p_check_in is null or p_check_out is null or p_check_in < v_today or p_check_in > v_today + 180
     or now() > v_deadline then
    raise exception 'housing_dates_invalid' using errcode = 'P0001';
  end if;
  if p_check_out - p_check_in not between v_stay.min_nights and v_stay.max_nights then
    raise exception 'housing_nights_out_of_range' using errcode = 'P0001';
  end if;
  if coalesce(p_adults, 0) < 1 or coalesce(p_minors, 0) < 0 or v_party > 8 then
    raise exception 'housing_capacity_exceeded' using errcode = 'P0001';
  end if;
  if p_minors > 0 and not v_stay.children_ok then
    raise exception 'housing_policy_mismatch' using errcode = 'P0001';
  end if;
  if p_minors > 0 and not coalesce(p_minors_guardian_ack, false) then
    raise exception 'housing_minor_unaccompanied' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 1 and 500 then
    raise exception 'housing_message_required' using errcode = 'P0001';
  end if;
  if (select count(*) from public.post_handoffs h
       where h.recipient_id = v_user_id and h.machine_id = 'housing_booking' and h.status = 'reserved') >= 3 then
    raise exception 'housing_pending_cap' using errcode = 'P0001';
  end if;
  if kc_private.housing_guest_has_overlap(v_user_id, p_check_in, p_check_out) then
    raise exception 'housing_booking_overlap' using errcode = 'P0001';
  end if;
  perform kc_private.housing_assert_bookable(v_stay, p_check_in, p_check_out, v_party, null);

  -- Capacity is per night and was checked above, so no post-wide limit is passed.
  v_handoff := kc_private.handoff_open(
    p_post_id, v_user_id, 'reserved', null, v_party,
    jsonb_build_object(
      'slot_starts_at', (p_check_in + v_stay.check_in_from) at time zone 'Asia/Jerusalem',
      'slot_ends_at', (p_check_out + v_stay.check_out_by) at time zone 'Asia/Jerusalem',
      'confirm_by', least(now() + interval '24 hours', v_deadline)));
  insert into public.handoff_booking_details (
    handoff_id, check_in_date, check_out_date, adults, minors, message, minors_guardian_ack)
  values (v_handoff.id, p_check_in, p_check_out, p_adults, coalesce(p_minors, 0), btrim(p_message),
          coalesce(p_minors_guardian_ack, false));
  return v_handoff;
end;
$$;
comment on function public.request_housing_booking(uuid, date, date, integer, integer, text, boolean) is
  'The caller asks to stay at a stay offer for a date range; the host approves within 24 hours.';
grant execute on function public.request_housing_booking(uuid, date, date, integer, integer, text, boolean)
  to authenticated;

-- The host approves or declines a waiting request, with an optional note to the guest.
-- Approval re-checks both members and the nights under the locks, then withdraws the
-- guest's other waiting requests that overlap it (`superseded`, S54).
create function public.decide_housing_booking(p_handoff_id uuid, p_approve boolean, p_note text default null)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff public.post_handoffs;
  v_post public.posts;
  v_stay public.post_housing_details;
  v_booking public.handoff_booking_details;
  v_other uuid;
begin
  perform kc_private.housing_guest_lock(
    (select h.recipient_id from public.post_handoffs h where h.id = p_handoff_id));
  v_handoff := kc_private.world_handoff_lock(p_handoff_id, 'housing_booking', true);
  if v_handoff.status <> 'reserved' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if char_length(p_note) > 300 then
    raise exception 'housing_note_too_long' using errcode = 'P0001';
  end if;
  update public.handoff_booking_details d set decision_note = nullif(btrim(p_note), '')
   where d.handoff_id = p_handoff_id
  returning d.* into v_booking;
  if not coalesce(p_approve, false) then
    return kc_private.handoff_move(p_handoff_id, 'cancelled', 'owner', 'declined');
  end if;

  select p.* into v_post from public.posts p where p.id = v_handoff.post_id;
  select s.* into v_stay from public.post_housing_details s where s.post_id = v_handoff.post_id;
  if v_post.status <> 'open' then
    raise exception 'listing_not_available' using errcode = 'P0001';
  end if;
  perform kc_private.housing_assert_eligible(v_handoff.owner_id, v_post.world_slug);
  perform kc_private.housing_assert_eligible(v_handoff.recipient_id, v_post.world_slug);
  if kc_private.housing_guest_has_overlap(v_handoff.recipient_id, v_booking.check_in_date, v_booking.check_out_date) then
    raise exception 'housing_booking_overlap' using errcode = 'P0001';
  end if;
  perform kc_private.housing_assert_bookable(
    v_stay, v_booking.check_in_date, v_booking.check_out_date, v_handoff.seats, p_handoff_id);
  v_handoff := kc_private.handoff_move(p_handoff_id, 'confirmed', 'owner');

  for v_other in
    select h.id from public.post_handoffs h
      join public.handoff_booking_details d on d.handoff_id = h.id
     where h.recipient_id = v_handoff.recipient_id and h.machine_id = 'housing_booking'
       and h.status = 'reserved'
       and d.check_in_date < v_booking.check_out_date and d.check_out_date > v_booking.check_in_date
  loop
    perform kc_private.handoff_move(v_other, 'cancelled', 'system', 'superseded');
  end loop;
  return v_handoff;
end;
$$;
comment on function public.decide_housing_booking(uuid, boolean, text) is
  'The host approves or declines a stay request; an approval withdraws the guest''s overlapping requests.';
grant execute on function public.decide_housing_booking(uuid, boolean, text) to authenticated;

-- Either side cancels before the stay starts (FR-HOUSING-018). A host cancelling an
-- approved stay must say why. A late cancellation of an approved stay — a guest inside
-- 24 hours of the start, a host inside 48 — is flagged for the trust engine, never shown.
create function public.cancel_housing_booking(p_handoff_id uuid, p_note text default null)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff constant public.post_handoffs :=
    kc_private.world_handoff_lock(p_handoff_id, 'housing_booking', false, false);
  v_by_host constant boolean := v_handoff.owner_id = (select auth.uid());
  v_note constant text := nullif(btrim(p_note), '');
begin
  if v_handoff.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if char_length(v_note) > 300 then
    raise exception 'housing_note_too_long' using errcode = 'P0001';
  end if;
  -- After check-in a stay is ended by completing it, not cancelled (FR-HOUSING-018 AC4).
  if now() >= v_handoff.slot_starts_at then
    raise exception 'housing_booking_started' using errcode = 'P0001';
  end if;
  if v_by_host and v_handoff.status = 'confirmed' and v_note is null then
    raise exception 'housing_cancel_reason_required' using errcode = 'P0001';
  end if;

  update public.handoff_booking_details d
     set cancel_note = v_note,
         late_cancel = v_handoff.status = 'confirmed' and now() > v_handoff.slot_starts_at
           - case when v_by_host then interval '48 hours' else interval '24 hours' end
   where d.handoff_id = p_handoff_id;
  return kc_private.handoff_move(
    p_handoff_id, 'cancelled',
    case when v_by_host then 'owner' else 'recipient' end,
    case when not v_by_host then 'guest_cancelled'
         when v_handoff.status = 'reserved' then 'declined'
         else 'host_cancelled' end);
end;
$$;
comment on function public.cancel_housing_booking(uuid, text) is
  'Either side cancels a stay booking before it starts; late cancellations of approved stays are flagged.';
grant execute on function public.cancel_housing_booking(uuid, text) to authenticated;

-- The host closes an approved stay: completed (from check-in until seven days after the
-- end, FR-HOUSING-019 AC2) or the guest did not arrive (from three to twenty-four hours
-- after check-in, FR-HOUSING-020 AC1). A stay offer serves many bookings, so the post
-- stays open.
create function public.close_housing_booking(p_handoff_id uuid, p_outcome text)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff constant public.post_handoffs := kc_private.world_handoff_lock(p_handoff_id, 'housing_booking', true);
begin
  if v_handoff.status <> 'confirmed' or p_outcome is null or p_outcome not in ('completed', 'no_show') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if not (case p_outcome
       when 'completed' then now() between v_handoff.slot_starts_at and v_handoff.slot_ends_at + interval '7 days'
       else now() between v_handoff.slot_starts_at + interval '3 hours'
                      and v_handoff.slot_starts_at + interval '24 hours'
     end) then
    raise exception 'housing_not_in_window' using errcode = 'P0001';
  end if;
  return kc_private.handoff_move(
    p_handoff_id, case p_outcome when 'completed' then 'handed_over' else 'no_show' end, 'owner');
end;
$$;
comment on function public.close_housing_booking(uuid, text) is
  'The host marks an approved stay as completed or as a no-show, each inside its time window.';
grant execute on function public.close_housing_booking(uuid, text) to authenticated;
