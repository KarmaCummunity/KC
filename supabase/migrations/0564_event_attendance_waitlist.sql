-- 0564_event_attendance_waitlist | G1 step 5c (ADR-006, D31, S13 approved 2026-11-04, G18): an
-- organization event's waitlist and the attendance its organizer marks.
--
--   1. A registration may wait for a place: `post_handoffs.status` gains `waitlisted`. When an
--      event with a capacity is full, `register_for_event` waitlists instead of refusing.
--   2. When a place frees (a registrant cancels, the organizer declines or removes one), the
--      earliest waitlisted member moves up: confirmed at once, or waiting for approval under the
--      manual policy. Nobody moves up once the event has started.
--   3. After the event starts the organizer marks each confirmed registrant as attended
--      (`handed_over`) or absent (`no_show`); an absence marked by mistake can be corrected to
--      attended. Only marked attendance earns karma (S13): 10 points (`docs/spec/07` §7.6,
--      "Event attendance"), once per registration (`event_attendance` joins the once-only
--      karma events).
-- The older volunteering model's self check-in karma (TD-274) is retired with that model in
-- step 6. Additive and idempotent; the function bodies are the 0563 definitions plus the marked
-- changes.

begin;

-- ── 1. A registration may wait for a place ───────────────────────────────────────────
alter table public.post_handoffs drop constraint if exists post_handoffs_status_check;
alter table public.post_handoffs
  add constraint post_handoffs_status_check
  check (status in ('reserved', 'confirmed', 'handed_over', 'cancelled', 'no_show', 'waitlisted'));

-- ── 2. Event attendance is a once-only karma event ──────────────────────────────────
drop index if exists public.karma_ledger_once_idx;
create unique index karma_ledger_once_idx on public.karma_ledger (user_id, event_type, ref_id)
  where event_type = any (array[
    'registration', 'post_created', 'outreach', 'backfill', 'listing_fulfilled',
    'volunteer_checkin', 'giving_handoff_giver', 'giving_handoff_receiver', 'rating_given',
    'event_attendance'
  ]);

-- 0510 body; the conflict target lists the same once-only events as the index above. `create or
-- replace` keeps the function's grants (service_role only, 0198).
create or replace function public.karma_grant_once(p_user uuid, p_event text, p_ref_type text, p_ref_id text, p_delta integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_inserted integer;
begin
  if p_user is null then return; end if;
  insert into public.karma_ledger (user_id, event_type, points_delta, ref_type, ref_id)
  values (p_user, p_event, p_delta, p_ref_type, p_ref_id)
  on conflict (user_id, event_type, ref_id)
    where event_type = any (array[
      'registration', 'post_created', 'outreach', 'backfill', 'listing_fulfilled',
      'volunteer_checkin', 'giving_handoff_giver', 'giving_handoff_receiver', 'rating_given',
      'event_attendance'  -- G1 step 5c (S13)
    ])
    do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    update public.users set karma_points = greatest(0, karma_points + p_delta)
     where user_id = p_user;
  end if;
end;
$$;

-- ── 3. Registration waitlists a full event ───────────────────────────────────────────
create or replace function public.register_for_event(p_target uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_target);
  v_event public.event_post_details;
  v_listing public.listings;
  v_taken integer;
  v_status text;
  v_row public.post_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_event from public.event_post_details where post_id = v_post_id;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  -- The listing row lock serializes registrations, so capacity cannot be overbooked.
  select * into v_listing from public.listings
   where listing_id = public.listing_id_of_post(v_post_id) and status = 'open'
   for update;
  if not found or not public.is_listing_visible_to(v_listing, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_listing.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
  if v_event.starts_at <= now() then raise exception 'slot_started' using errcode = '23514'; end if;
  if v_event.registration_policy = 'verified_only'
     and not exists (select 1 from public.users u where u.user_id = v_uid and u.verified_at is not null) then
    raise exception 'verification_required' using errcode = '42501';
  end if;
  -- 0564: a member already waiting for a place is registered too.
  if exists (
    select 1 from public.post_handoffs
     where post_id = v_post_id and recipient_id = v_uid and status in ('reserved', 'confirmed', 'waitlisted')
  ) then
    raise exception 'already_booked' using errcode = '23505';
  end if;

  -- 0564: a full event waitlists instead of refusing.
  select count(*)::integer into v_taken from public.post_handoffs
   where post_id = v_post_id and status in ('reserved', 'confirmed', 'handed_over');
  v_status := case
    when v_event.capacity is not null and v_taken >= v_event.capacity then 'waitlisted'
    when v_event.registration_policy = 'manual' then 'reserved'
    else 'confirmed'
  end;

  -- 0564: reserved_at is the moment of registration (clock_timestamp, not the transaction's
  -- now()), so the waitlist promotes in registration order even within one transaction.
  insert into public.post_handoffs (
    post_id, owner_id, recipient_id, world_slug, status, seats, reserved_at,
    slot_starts_at, slot_ends_at, confirm_by, confirmed_at
  ) values (
    v_post_id, v_listing.owner_id, v_uid, 'time', v_status, 1, clock_timestamp(),
    v_event.starts_at, v_event.ends_at,
    case when v_status = 'reserved' then v_event.starts_at end,
    case when v_status = 'confirmed' then now() end
  )
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.register_for_event(uuid) from public, anon;
grant execute on function public.register_for_event(uuid) to authenticated;

-- Moves the earliest waitlisted members of an event into the places that are free, before the
-- event starts: confirmed at once, or waiting for approval under the manual policy.
create or replace function public.event_promote_waitlist(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.event_post_details;
  v_taken integer;
  v_next uuid;
begin
  select * into v_event from public.event_post_details where post_id = p_post_id;
  if not found or v_event.starts_at <= now() then return; end if;

  loop
    select count(*)::integer into v_taken from public.post_handoffs
     where post_id = p_post_id and status in ('reserved', 'confirmed', 'handed_over');
    exit when v_event.capacity is not null and v_taken >= v_event.capacity;

    select handoff_id into v_next from public.post_handoffs
     where post_id = p_post_id and status = 'waitlisted'
     order by reserved_at, handoff_id
     limit 1
     for update;
    exit when v_next is null;

    if v_event.registration_policy = 'manual' then
      update public.post_handoffs set status = 'reserved', confirm_by = v_event.starts_at
       where handoff_id = v_next;
    else
      update public.post_handoffs set status = 'confirmed', confirmed_at = now()
       where handoff_id = v_next;
    end if;
  end loop;
end;
$$;

revoke all on function public.event_promote_waitlist(uuid) from public, anon, authenticated;
grant execute on function public.event_promote_waitlist(uuid) to service_role;

-- ── 4. Declining or cancelling frees a place for the waitlist ────────────────────────
create or replace function public.decide_event_registration(p_handoff_id uuid, p_approve boolean)
returns public.post_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.post_handoffs := public.event_registration_for_update(p_handoff_id);
begin
  if v_row.owner_id <> auth.uid() then raise exception 'not_owner' using errcode = '42501'; end if;
  if v_row.status <> 'reserved' then raise exception 'invalid_transition' using errcode = '23514'; end if;

  if p_approve then
    update public.post_handoffs set status = 'confirmed', confirmed_at = now()
     where handoff_id = p_handoff_id returning * into v_row;
  else
    update public.post_handoffs set status = 'cancelled', cancel_reason = 'declined', cancelled_at = now()
     where handoff_id = p_handoff_id returning * into v_row;
    perform public.event_promote_waitlist(v_row.post_id);  -- 0564
  end if;
  return v_row;
end;
$$;

revoke all on function public.decide_event_registration(uuid, boolean) from public, anon;
grant execute on function public.decide_event_registration(uuid, boolean) to authenticated;

create or replace function public.cancel_event_registration(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.post_handoffs := public.event_registration_for_update(p_handoff_id);
begin
  -- 0564: a waitlisted member may leave the waitlist too.
  if v_row.status not in ('reserved', 'confirmed', 'waitlisted') then
    raise exception 'invalid_transition' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'cancelled',
         cancel_reason = case when auth.uid() = owner_id then 'declined' end,
         cancelled_at = now()
   where handoff_id = p_handoff_id
  returning * into v_row;
  perform public.event_promote_waitlist(v_row.post_id);  -- 0564
  return v_row;
end;
$$;

revoke all on function public.cancel_event_registration(uuid) from public, anon;
grant execute on function public.cancel_event_registration(uuid) to authenticated;

-- ── 5. The organizer marks attendance; only attendance earns karma (S13) ─────────────
create or replace function public.mark_event_attendance(p_handoff_id uuid, p_attended boolean)
returns public.post_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.post_handoffs := public.event_registration_for_update(p_handoff_id);
begin
  if v_row.owner_id <> auth.uid() then raise exception 'not_owner' using errcode = '42501'; end if;
  -- The event's current start, not the copy on the registration (an edit may have moved it).
  if (select e.starts_at from public.event_post_details e where e.post_id = v_row.post_id) > now() then
    raise exception 'event_not_started' using errcode = '23514';
  end if;
  -- A confirmed registrant is marked once; an absence can still be corrected to attended.
  if not (v_row.status = 'confirmed' or (v_row.status = 'no_show' and p_attended)) then
    raise exception 'invalid_transition' using errcode = '23514';
  end if;

  if p_attended then
    update public.post_handoffs set status = 'handed_over', handed_over_at = now(), no_show_at = null
     where handoff_id = p_handoff_id returning * into v_row;
    perform public.karma_grant_once(v_row.recipient_id, 'event_attendance', 'post_handoff',
                                    v_row.handoff_id::text, 10);
  else
    update public.post_handoffs set status = 'no_show', no_show_at = now()
     where handoff_id = p_handoff_id returning * into v_row;
  end if;
  return v_row;
end;
$$;

revoke all on function public.mark_event_attendance(uuid, boolean) from public, anon;
grant execute on function public.mark_event_attendance(uuid, boolean) to authenticated;

commit;
