-- 0603_housing_booking_lifecycle | Housing H1, part 4: what happens to a stay booking after
-- it is made (spec docs/SSOT/spec/21_housing.md FR-HOUSING-017…023).
--
--   1. `cancel_housing_booking`: either side, until check-in. A guest cancelling a confirmed
--      stay within 24 h of check-in, or a host within 48 h, is marked `late_cancel` — a trust
--      signal (D24), never shown to users. A host cancelling a confirmed stay gives a reason.
--      The generic `cancel_giving_handoff` refuses housing, so no path skips these rules.
--   2. `complete_housing_booking`: the host marks the stay completed, from check-in until 7
--      days after check-out; an early departure counts the nights actually stayed. Karma goes
--      through the one handoff config (0453): housing joins it as host 30 per night (≤ 7
--      nights) and guest 10 (spec 07 §7.6), and `karma_award_handoff` gains a per-unit count
--      for the giver (nights), defaulting to 1 so every existing caller is unchanged.
--   3. `mark_housing_no_show`: the host, from 3 h to 24 h after check-in.
--   4. `list_housing_bookings` (host, per offer) and `list_my_housing_stays` (guest).
--   5. `housing_bookings_sweep` every 10 min: unanswered requests expire at `confirm_by`;
--      confirmed stays nobody completed close 7 days after check-out without karma.
--   6. The status-change trigger: one push to the other side of every booking change (0602 helper).

begin;

-- ── 0. Housing in the one handoff karma config (0453) ────────────────────────
create or replace function public.karma_handoff_points(p_world text, p_role text)
returns integer
language sql
immutable
as $$
  select case p_world
    when 'items'   then case p_role when 'giver' then 20 else 15 end
    when 'food'    then case p_role when 'giver' then 20 else 10 end
    when 'rides'   then case p_role when 'giver' then 25 else 10 end
    -- Hosting: per night for the host, once for the guest (§7.6 "host 30 / night; guest 10").
    when 'housing' then case p_role when 'giver' then 30 else 10 end
    else case p_role when 'giver' then 5 else 3 end
  end;
$$;

-- Adds the giver's unit count (a host's nights); 1 keeps every existing caller's award.
drop function if exists public.karma_award_handoff(uuid, uuid, text, uuid);
create or replace function public.karma_award_handoff(
  p_giver uuid, p_receiver uuid, p_world text, p_handoff_id uuid, p_giver_units integer default 1
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.karma_grant_once(p_giver, 'giving_handoff_giver', 'giving_handoff', p_handoff_id::text,
                                  public.karma_handoff_points(p_world, 'giver') * greatest(1, p_giver_units));
  perform public.karma_grant_once(p_receiver, 'giving_handoff_receiver', 'giving_handoff', p_handoff_id::text,
                                  public.karma_handoff_points(p_world, 'receiver'));
end;
$$;
revoke all on function public.karma_award_handoff(uuid, uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.karma_award_handoff(uuid, uuid, text, uuid, integer) to service_role;

-- ── 1. Cancellation ──────────────────────────────────────────────────────────
create or replace function public.cancel_housing_booking(p_handoff_id uuid, p_note text default null)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.giving_handoffs;
  v_is_host boolean;
  v_late boolean;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if p_note is not null and char_length(p_note) > 300 then
    raise exception 'housing_note_too_long' using errcode = '23514';
  end if;
  select * into v_row from public.giving_handoffs
   where handoff_id = p_handoff_id and world_slug = 'housing' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_uid not in (v_row.owner_id, v_row.recipient_id) then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_row.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  -- After check-in a stay is ended by completing it, not cancelled (FR-HOUSING-018 AC4).
  if now() >= v_row.slot_starts_at then
    raise exception 'housing_booking_started' using errcode = '23514';
  end if;

  v_is_host := v_uid = v_row.owner_id;
  if v_is_host and v_row.status = 'confirmed' and nullif(btrim(p_note), '') is null then
    raise exception 'housing_cancel_reason_required' using errcode = '23514';
  end if;
  v_late := v_row.status = 'confirmed' and now() > v_row.slot_starts_at
    - case when v_is_host then interval '48 hours' else interval '24 hours' end;

  update public.housing_booking_details
     set late_cancel = v_late, cancel_note = nullif(btrim(p_note), '')
   where handoff_id = p_handoff_id;
  update public.giving_handoffs
     set status = 'cancelled', cancelled_at = now(),
         cancel_reason = case when v_is_host then 'host_cancelled' else 'guest_cancelled' end
   where handoff_id = p_handoff_id
  returning * into v_row;
  return v_row;
end;
$$;

-- The generic cancel (items, food, rides, knowledge) must not bypass the housing rules.
create or replace function public.cancel_giving_handoff(p_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.giving_handoffs;
begin
  if exists (select 1 from public.giving_handoffs
              where handoff_id = p_handoff_id and world_slug = 'housing') then
    raise exception 'housing_use_booking_cancel' using errcode = '23514';
  end if;

  update public.giving_handoffs
     set status = 'cancelled', cancelled_at = now()
   where handoff_id = p_handoff_id
     and status in ('reserved', 'confirmed')
     and (owner_id = auth.uid() or recipient_id = auth.uid())
  returning * into v_row;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;

  if v_row.world_slug in ('items', 'food') then
    update public.listings
       set availability_status = 'immediate', updated_at = now()
     where listing_id = v_row.listing_id and status = 'open';
  end if;
end;
$$;

-- ── 2. Completion ────────────────────────────────────────────────────────────
create or replace function public.complete_housing_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.giving_handoffs;
  v_details public.housing_booking_details;
  v_nights int;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_row from public.giving_handoffs
   where handoff_id = p_handoff_id and world_slug = 'housing' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_row.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_row.status <> 'confirmed' then raise exception 'invalid_status' using errcode = '23514'; end if;
  if now() < v_row.slot_starts_at or now() > v_row.slot_ends_at + interval '7 days' then
    raise exception 'housing_not_in_window' using errcode = '23514';
  end if;

  -- Nights stayed: the planned nights, or fewer when the guest left early (at least one).
  select * into v_details from public.housing_booking_details where handoff_id = p_handoff_id;
  v_nights := greatest(1, least(v_details.check_out_date - v_details.check_in_date,
                                public.housing_today() - v_details.check_in_date));

  update public.giving_handoffs
     set status = 'handed_over', handed_over_at = now()
   where handoff_id = p_handoff_id
  returning * into v_row;

  -- Hosting karma counts at most 7 nights per stay (spec 07 §7.6 cap).
  perform public.karma_award_handoff(v_row.owner_id, v_row.recipient_id, 'housing', p_handoff_id,
                                     least(v_nights, 7));
  return v_row;
end;
$$;

-- ── 3. No-show ───────────────────────────────────────────────────────────────
create or replace function public.mark_housing_no_show(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_row from public.giving_handoffs
   where handoff_id = p_handoff_id and world_slug = 'housing' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_row.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_row.status <> 'confirmed' then raise exception 'invalid_status' using errcode = '23514'; end if;
  if now() < v_row.slot_starts_at + interval '3 hours'
     or now() > v_row.slot_starts_at + interval '24 hours' then
    raise exception 'housing_not_in_window' using errcode = '23514';
  end if;

  update public.giving_handoffs set status = 'no_show', no_show_at = now()
   where handoff_id = p_handoff_id
  returning * into v_row;
  return v_row;
end;
$$;

-- ── 4. Lists ─────────────────────────────────────────────────────────────────
-- Every live booking on one offer, for its host, with the guest's trust block (S16, D24 —
-- verification, completed stays and seniority; never ratings) and the check-in / check-out
-- instants the app needs to offer "completed" and "no-show" at the right time.
create or replace function public.list_housing_bookings(p_listing_id uuid)
returns table (
  handoff_id            uuid,
  recipient_id          uuid,
  guest_name            text,
  avatar_url            text,
  guest_verified        boolean,
  guest_completed_stays bigint,
  guest_member_since    timestamptz,
  check_in_date         date,
  check_out_date        date,
  slot_starts_at        timestamptz,
  slot_ends_at          timestamptz,
  adults                smallint,
  minors                smallint,
  message               text,
  status                text,
  reserved_at           timestamptz,
  confirm_by            timestamptz,
  rated_by_me           boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.listings l
                  where l.listing_id = p_listing_id and l.world_slug = 'housing'
                    and l.owner_id = auth.uid()) then
    raise exception 'owner_only' using errcode = '42501';
  end if;

  return query
    select h.handoff_id, h.recipient_id, u.display_name, u.avatar_url,
           u.verified_at is not null,
           (select count(*) from public.giving_handoffs g
             where g.recipient_id = h.recipient_id and g.world_slug = 'housing'
               and g.status = 'handed_over'),
           u.created_at,
           d.check_in_date, d.check_out_date, h.slot_starts_at, h.slot_ends_at,
           d.adults, d.minors, d.message,
           h.status, h.reserved_at, h.confirm_by,
           exists (select 1 from public.giving_handoff_ratings r
                    where r.handoff_id = h.handoff_id and r.rater_id = auth.uid())
      from public.giving_handoffs h
      join public.housing_booking_details d on d.handoff_id = h.handoff_id
      join public.users u on u.user_id = h.recipient_id
     where h.listing_id = p_listing_id
       and h.status in ('reserved', 'confirmed', 'handed_over')
     order by (h.status = 'reserved') desc, d.check_in_date, h.reserved_at;
end;
$$;

-- The caller's own stay bookings, newest first, with whether the address is open to them.
create or replace function public.list_my_housing_stays(p_limit int default 50)
returns table (
  handoff_id      uuid,
  listing_id      uuid,
  listing_title   text,
  city_id         text,
  host_id         uuid,
  host_name       text,
  check_in_date   date,
  check_out_date  date,
  slot_starts_at  timestamptz,
  slot_ends_at    timestamptz,
  adults          smallint,
  minors          smallint,
  status          text,
  cancel_reason   text,
  reserved_at     timestamptz,
  confirm_by      timestamptz,
  can_view_address boolean,
  rated_by_me     boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'auth_required' using errcode = '42501'; end if;
  return query
    select h.handoff_id, h.listing_id, l.title, l.city_id, h.owner_id, u.display_name,
           d.check_in_date, d.check_out_date, h.slot_starts_at, h.slot_ends_at, d.adults, d.minors,
           h.status, h.cancel_reason, h.reserved_at, h.confirm_by,
           public.can_view_housing_private_details(h.listing_id, auth.uid()),
           exists (select 1 from public.giving_handoff_ratings r
                    where r.handoff_id = h.handoff_id and r.rater_id = auth.uid())
      from public.giving_handoffs h
      join public.housing_booking_details d on d.handoff_id = h.handoff_id
      join public.listings l on l.listing_id = h.listing_id
      join public.users u on u.user_id = h.owner_id
     where h.recipient_id = auth.uid() and h.world_slug = 'housing'
     order by h.reserved_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

-- ── 5. Sweep ─────────────────────────────────────────────────────────────────
create or replace function public.housing_bookings_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired int;
  v_closed int;
begin
  update public.giving_handoffs
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'expired'
   where world_slug = 'housing' and status = 'reserved' and confirm_by < now();
  get diagnostics v_expired = row_count;

  -- No automatic completion and no karma for a stay nobody marked completed (FR-HOUSING-019 AC5).
  update public.giving_handoffs
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'not_completed'
   where world_slug = 'housing' and status = 'confirmed'
     and slot_ends_at + interval '7 days' < now();
  get diagnostics v_closed = row_count;

  return jsonb_build_object('expired', v_expired, 'not_completed', v_closed);
end;
$$;

comment on function public.housing_bookings_sweep() is
  'Every 10 min: unanswered housing requests expire at confirm_by; confirmed stays not completed 7 days after check-out close without karma (FR-HOUSING-017, 019). 0603.';

-- ── 6. Notifications ─────────────────────────────────────────────────────────
-- Status changes only: the request's own push is sent by request_housing_booking (0602).
create or replace function public.housing_booking_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'confirmed' then
    perform public.housing_booking_enqueue(new, 'housing_booking_confirmed', new.recipient_id, new.owner_id);
  elsif new.status = 'handed_over' then
    perform public.housing_booking_enqueue(new, 'housing_booking_completed', new.recipient_id, new.owner_id);
  elsif new.status = 'cancelled' then
    case new.cancel_reason
      when 'declined' then
        perform public.housing_booking_enqueue(new, 'housing_booking_declined', new.recipient_id, new.owner_id);
      when 'expired' then
        perform public.housing_booking_enqueue(new, 'housing_booking_expired', new.recipient_id, new.owner_id);
      when 'superseded' then
        perform public.housing_booking_enqueue(new, 'housing_booking_superseded', new.owner_id, new.recipient_id, 'social');
      when 'guest_cancelled' then
        perform public.housing_booking_enqueue(new, 'housing_booking_cancelled', new.owner_id, new.recipient_id);
      when 'host_cancelled' then
        perform public.housing_booking_enqueue(new, 'housing_booking_cancelled', new.recipient_id, new.owner_id);
      else null; -- not_completed / system: nobody to tell
    end case;
  end if;
  return new;
end;
$$;

drop trigger if exists giving_handoffs_housing_notify on public.giving_handoffs;
create trigger giving_handoffs_housing_notify
  after update of status on public.giving_handoffs
  for each row when (new.world_slug = 'housing')
  execute function public.housing_booking_notify();

-- ── Grants (0520) ────────────────────────────────────────────────────────────
revoke all on function public.cancel_housing_booking(uuid, text) from public;
revoke all on function public.cancel_giving_handoff(uuid) from public;
revoke all on function public.complete_housing_booking(uuid) from public;
revoke all on function public.mark_housing_no_show(uuid) from public;
revoke all on function public.list_housing_bookings(uuid) from public;
revoke all on function public.list_my_housing_stays(int) from public;
revoke all on function public.housing_bookings_sweep() from public, anon, authenticated;
revoke all on function public.housing_booking_notify() from public, anon, authenticated;

grant execute on function public.cancel_housing_booking(uuid, text) to authenticated;
grant execute on function public.cancel_giving_handoff(uuid) to authenticated;
grant execute on function public.complete_housing_booking(uuid) to authenticated;
grant execute on function public.mark_housing_no_show(uuid) to authenticated;
grant execute on function public.list_housing_bookings(uuid) to authenticated;
grant execute on function public.list_my_housing_stays(int) to authenticated;
grant execute on function public.housing_bookings_sweep() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'housing_bookings_sweep') then
      perform cron.unschedule('housing_bookings_sweep');
    end if;
    perform cron.schedule('housing_bookings_sweep', '*/10 * * * *',
                          $sql$ select public.housing_bookings_sweep(); $sql$);
  else
    raise notice 'pg_cron not enabled — housing_bookings_sweep not scheduled.';
  end if;
end $$;

commit;
