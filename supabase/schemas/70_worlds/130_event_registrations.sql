-- Worlds · event registrations (machine `event_registration` on post_handoffs, G18)
--
-- register → registered at once, waiting for the organizer, or on the waiting list of a
-- full event; a freed place promotes the list in order of registration; from the start
-- the organizer marks who came. Volunteering shifts use the same flow, and attendance
-- adds their length to the attendee's volunteering hours. Errors: SQLSTATE P0001 —
-- listing_not_available, own_listing, item_already_reserved, slot_started,
-- verification_required, event_not_started, event_message_invalid, post_not_found,
-- handoff_not_found, invalid_status.

-- Registers the caller for an event that has not started. Returns the registration:
-- `waitlisted` when the event is full, `reserved` when the organizer approves by hand
-- (the request lapses at the start), `confirmed` otherwise.
create function public.register_for_event(p_post_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_post public.posts;
  v_event public.post_event_details;
  v_status text;
begin
  -- The post row lock serializes registrations, so the last place is given once.
  select p.* into v_post from public.posts p where p.id = p_post_id for update;
  select e.* into v_event from public.post_event_details e where e.post_id = p_post_id;
  if not found or not kc_private.post_bookable_by(v_post, v_user_id) then
    raise exception 'listing_not_available' using errcode = 'P0001';
  end if;
  if v_event.starts_at <= now() then
    raise exception 'slot_started' using errcode = 'P0001';
  end if;
  if v_event.registration_policy = 'verified_only'
     and not exists (select 1 from public.users u where u.id = v_user_id and u.verification_level >= 2) then
    raise exception 'verification_required' using errcode = 'P0001';
  end if;

  v_status := case
    when kc_private.handoff_seats_taken(p_post_id) >= v_event.capacity then 'waitlisted'
    when v_event.registration_policy = 'manual' then 'reserved'
    else 'confirmed'
  end;
  return kc_private.handoff_open(
    p_post_id, v_user_id, v_status, v_event.capacity, 1,
    jsonb_strip_nulls(jsonb_build_object(
      'slot_starts_at', v_event.starts_at, 'slot_ends_at', v_event.ends_at,
      'confirm_by', case v_status when 'reserved' then v_event.starts_at end)));
end;
$$;
comment on function public.register_for_event(uuid) is
  'Registers the caller for an event: confirmed, waiting for approval, or on the waiting list when full.';
grant execute on function public.register_for_event(uuid) to authenticated;

-- The organizer approves or declines a registration that waits for them. A declined
-- place goes to the waiting list.
create function public.decide_event_registration(p_handoff_id uuid, p_approve boolean)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff public.post_handoffs := kc_private.world_handoff_lock(p_handoff_id, 'event_registration', true);
begin
  if v_handoff.status <> 'reserved' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if coalesce(p_approve, false) then
    return kc_private.handoff_move(p_handoff_id, 'confirmed', 'owner');
  end if;
  v_handoff := kc_private.handoff_move(p_handoff_id, 'cancelled', 'owner', 'declined');
  perform kc_private.event_promote_waitlist(v_handoff.post_id);
  return v_handoff;
end;
$$;
comment on function public.decide_event_registration(uuid, boolean) is
  'The organizer approves or declines a registration awaiting approval.';
grant execute on function public.decide_event_registration(uuid, boolean) to authenticated;

-- The member leaves an event or its waiting list, or the organizer removes a
-- registration. Before the start, the freed place goes to the waiting list.
create function public.cancel_event_registration(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff public.post_handoffs :=
    kc_private.world_handoff_lock(p_handoff_id, 'event_registration', false, false);
  v_by_owner constant boolean := v_handoff.owner_id = (select auth.uid());
begin
  if v_handoff.status not in ('waitlisted', 'reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  v_handoff := kc_private.handoff_move(
    p_handoff_id, 'cancelled',
    case when v_by_owner then 'owner' else 'recipient' end,
    case when not v_by_owner then 'recipient_cancelled'
         when v_handoff.status = 'reserved' then 'declined'
         else 'owner_cancelled' end);
  perform kc_private.event_promote_waitlist(v_handoff.post_id);
  return v_handoff;
end;
$$;
comment on function public.cancel_event_registration(uuid) is
  'Cancels an event registration (by its member or the organizer) and promotes the waiting list.';
grant execute on function public.cancel_event_registration(uuid) to authenticated;

-- From the start of the event the organizer marks a confirmed registrant as attended or
-- absent; an absence can be corrected to attended, an attendance is final. Attending a
-- volunteering shift adds the length of the event, in hours, to the attendee's
-- volunteering hours — once, since nothing leaves `handed_over`.
create function public.mark_event_attendance(p_handoff_id uuid, p_attended boolean)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff public.post_handoffs := kc_private.world_handoff_lock(p_handoff_id, 'event_registration', true);
  v_event public.post_event_details;
begin
  -- The event's own start, not the copy on the registration.
  select e.* into v_event from public.post_event_details e where e.post_id = v_handoff.post_id;
  if not found or v_event.starts_at > now() then
    raise exception 'event_not_started' using errcode = 'P0001';
  end if;
  if p_attended is null
     or not (v_handoff.status = 'confirmed' or (v_handoff.status = 'no_show' and p_attended)) then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if not p_attended then
    return kc_private.handoff_move(p_handoff_id, 'no_show', 'owner');
  end if;

  v_handoff := kc_private.handoff_move(p_handoff_id, 'handed_over', 'owner');
  if v_event.counts_volunteer_hours then
    update public.user_stats s
       set volunteer_hours_total = s.volunteer_hours_total
             + round((extract(epoch from v_event.ends_at - v_event.starts_at) / 3600)::numeric, 2)
     where s.user_id = v_handoff.recipient_id;
  end if;
  return v_handoff;
end;
$$;
comment on function public.mark_event_attendance(uuid, boolean) is
  'The organizer records attendance or absence once the event started; a shift adds volunteering hours.';
grant execute on function public.mark_event_attendance(uuid, boolean) to authenticated;

-- The organizer sends a short message to everyone registered for the event (approved,
-- awaiting approval or waiting for a place). Each member receives a notification; the
-- text travels in the event and is not stored anywhere else. Returns how many were told.
create function public.message_event_registrants(p_post_id uuid, p_body text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post constant public.posts := kc_private.post_lock_managed(p_post_id);
  v_body constant text := btrim(coalesce(p_body, ''));
  v_event_id constant uuid := gen_random_uuid();
  v_to uuid;
  v_count integer := 0;
begin
  if v_post.post_type <> 'event' then
    raise exception 'post_not_found' using errcode = 'P0001';
  end if;
  if char_length(v_body) not between 1 and 500 then
    raise exception 'event_message_invalid' using errcode = 'P0001';
  end if;
  for v_to in
    select h.recipient_id from public.post_handoffs h
     where h.post_id = p_post_id and h.status in ('waitlisted', 'reserved', 'confirmed')
  loop
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', 'event_organizer_message', 'recipient_id', v_to, 'actor_id', (select auth.uid()),
      'entity', jsonb_build_object('type', 'post', 'id', p_post_id),
      'data', jsonb_build_object(
        'body', v_body, 'dedupe_key', 'event_organizer_message:' || v_event_id || ':' || v_to)));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function public.message_event_registrants(uuid, text) is
  'The organizer notifies every registered member of an event with a short message.';
grant execute on function public.message_event_registrants(uuid, text) to authenticated;
