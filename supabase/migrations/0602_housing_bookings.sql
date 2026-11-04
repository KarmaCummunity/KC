-- 0602_housing_bookings | Housing H1, part 3: stay bookings on the generic handoff stage
-- (spec docs/SSOT/spec/21_housing.md FR-HOUSING-015, 016; fills S-housing-booking-lifecycle
-- and S-housing-limits in docs/spec/91).
--
--   1. `giving_handoffs` accepts the housing world: many active bookings per offer (one per
--      guest), the party size in `seats`, check-in / check-out instants in `slot_*`.
--   2. `housing_booking_details`: dates, party, the guest's message and the late-cancel mark.
--   3. Night helpers: is a night open on the offer, the check-in / check-out instants, and the
--      guests already confirmed on a night (capacity).
--   4. `request_housing_booking` (guest) and `decide_housing_booking` (host). Approval locks
--      the offer, re-checks eligibility, nights and capacity, and withdraws the guest's other
--      waiting requests for overlapping nights (first confirmation wins).
--   5. `housing_booking_enqueue`: the one push per booking change (the request's own push is
--      sent by the RPC, after the details exist; status changes by the 0603 trigger).
-- Cancellation, completion, lists, sweeps and the status-change trigger follow in 0603.

begin;

-- ── 1. The handoff stage accepts housing ─────────────────────────────────────
alter table public.giving_handoffs drop constraint if exists giving_handoffs_world_slug_check;
alter table public.giving_handoffs
  add constraint giving_handoffs_world_slug_check
  check (world_slug in ('items', 'food', 'rides', 'knowledge', 'housing'));

-- One active booking per guest per offer; many guests per offer (like rides seats).
drop index if exists public.giving_handoffs_active_listing_recipient_uidx;
create unique index giving_handoffs_active_listing_recipient_uidx
  on public.giving_handoffs (listing_id, recipient_id)
  where status in ('reserved', 'confirmed')
    and world_slug in ('rides', 'knowledge', 'housing');

-- Why a housing booking ended, in housing words (rides keep theirs).
alter table public.giving_handoffs drop constraint if exists giving_handoffs_cancel_reason_check;
alter table public.giving_handoffs
  add constraint giving_handoffs_cancel_reason_check
  check (cancel_reason in (
    'declined', 'expired', 'passenger_cancelled', 'driver_cancelled', 'system',
    'superseded', 'guest_cancelled', 'host_cancelled', 'not_completed'
  ));

-- post_handoffs (0553, G1) mirrors every giving_handoffs write, so it accepts the same reasons.
alter table public.post_handoffs drop constraint if exists post_handoffs_cancel_reason_check;
alter table public.post_handoffs
  add constraint post_handoffs_cancel_reason_check
  check (cancel_reason is null or cancel_reason in (
    'declined', 'expired', 'passenger_cancelled', 'driver_cancelled', 'system',
    'superseded', 'guest_cancelled', 'host_cancelled', 'not_completed'
  ));

create index if not exists giving_handoffs_housing_recipient_status_idx
  on public.giving_handoffs (recipient_id, status)
  where world_slug = 'housing';

-- ── 2. Booking details ───────────────────────────────────────────────────────
create table if not exists public.housing_booking_details (
  handoff_id           uuid primary key references public.giving_handoffs(handoff_id) on delete cascade,
  check_in_date        date not null,
  check_out_date       date not null,
  adults               smallint not null check (adults between 1 and 8),
  minors               smallint not null default 0 check (minors between 0 and 7),
  message              text not null check (char_length(btrim(message)) between 1 and 500),
  minors_guardian_ack  boolean not null default false,
  late_cancel          boolean not null default false,
  decision_note        text check (decision_note is null or char_length(decision_note) <= 300),
  cancel_note          text check (cancel_note is null or char_length(cancel_note) <= 300),
  created_at           timestamptz not null default now(),
  constraint housing_booking_details_party check (adults + minors <= 8),
  constraint housing_booking_details_dates check (
    check_out_date > check_in_date and check_out_date - check_in_date <= 30
  )
);

comment on table public.housing_booking_details is
  'Housing side of a giving_handoffs booking: dates, party, message, late-cancel mark (FR-HOUSING-015/018). 0602.';

alter table public.housing_booking_details enable row level security;

create policy housing_booking_details_participant_read on public.housing_booking_details
  for select to authenticated
  using (exists (
    select 1 from public.giving_handoffs h
     where h.handoff_id = housing_booking_details.handoff_id
       and (h.owner_id = (select auth.uid()) or h.recipient_id = (select auth.uid()))
  ));
-- No client writes: rows are written by the booking RPCs only.

-- ── 3. Night helpers ─────────────────────────────────────────────────────────
-- Is the night that starts on p_night open on the offer (availability minus blackout dates)?
create or replace function public.housing_night_open(p_details jsonb, p_night date)
returns boolean
language sql
immutable
as $$
  select not coalesce(p_details->'blackout_dates', '[]'::jsonb) ? p_night::text
     and case p_details #>> '{availability,mode}'
       when 'window' then p_night between (p_details #>> '{availability,from}')::date
                                      and (p_details #>> '{availability,until}')::date
       when 'weekly' then
         (p_details #> '{availability,weekdays}') @> to_jsonb(extract(dow from p_night)::int)
         and (p_details #>> '{availability,from}' is null
              or p_night >= (p_details #>> '{availability,from}')::date)
         and (p_details #>> '{availability,end_date}' is null
              or p_night <= (p_details #>> '{availability,end_date}')::date)
       when 'ongoing' then true
       else false
     end;
$$;

-- Check-in starts at the offer's `check_in_from` on the check-in day (Israel time).
create or replace function public.housing_check_in_at(p_details jsonb, p_day date)
returns timestamptz
language sql
immutable
as $$
  select (p_day + (p_details->>'check_in_from')::time) at time zone 'Asia/Jerusalem';
$$;

-- The latest check-in: `check_in_until`, on the next day when the window runs past midnight.
create or replace function public.housing_check_in_deadline(p_details jsonb, p_day date)
returns timestamptz
language sql
immutable
as $$
  select (p_day
          + case when (p_details->>'check_in_until') <= (p_details->>'check_in_from') then 1 else 0 end
          + (p_details->>'check_in_until')::time) at time zone 'Asia/Jerusalem';
$$;

create or replace function public.housing_check_out_at(p_details jsonb, p_day date)
returns timestamptz
language sql
immutable
as $$
  select (p_day + (p_details->>'check_out_by')::time) at time zone 'Asia/Jerusalem';
$$;

-- Guests of confirmed or completed bookings on the offer for the night that starts on p_night.
create or replace function public.housing_guests_on_night(p_listing_id uuid, p_night date, p_exclude uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(h.seats), 0)::int
    from public.giving_handoffs h
    join public.housing_booking_details d on d.handoff_id = h.handoff_id
   where h.listing_id = p_listing_id
     and h.world_slug = 'housing'
     and h.status in ('confirmed', 'handed_over')
     and h.handoff_id is distinct from p_exclude
     and p_night >= d.check_in_date and p_night < d.check_out_date;
$$;

-- Raises unless every night of [p_in, p_out) is open and has room for p_party guests
-- (FR-HOUSING-016 AC3; an exclusive place takes one booking per night).
create or replace function public.housing_assert_nights_bookable(
  p_listing public.listings, p_in date, p_out date, p_party int, p_exclude uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_night date;
  v_taken int;
  v_capacity int := (p_listing.details->>'capacity')::int;
  v_exclusive boolean := coalesce((p_listing.details->>'exclusive')::boolean, false);
begin
  for v_night in select generate_series(p_in, p_out - 1, interval '1 day')::date loop
    if not public.housing_night_open(p_listing.details, v_night) then
      raise exception 'housing_dates_unavailable' using errcode = '23514';
    end if;
    v_taken := public.housing_guests_on_night(p_listing.listing_id, v_night, p_exclude);
    if (v_exclusive and v_taken > 0) or v_taken + p_party > v_capacity then
      raise exception 'housing_capacity_exceeded' using errcode = '23514';
    end if;
  end loop;
end;
$$;

-- Does the guest already hold a confirmed stay that shares a night with [p_in, p_out)?
create or replace function public.housing_guest_has_overlap(p_guest uuid, p_in date, p_out date, p_exclude uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.giving_handoffs h
      join public.housing_booking_details d on d.handoff_id = h.handoff_id
     where h.recipient_id = p_guest
       and h.world_slug = 'housing'
       and h.status = 'confirmed'
       and h.handoff_id is distinct from p_exclude
       and d.check_in_date < p_out and p_in < d.check_out_date
  );
$$;

-- Verified, active, conduct accepted: the eligibility of both sides (FR-HOUSING-003).
create or replace function public.housing_assert_eligible(p_user uuid, p_action text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_member(p_user) then
    raise exception 'member_inactive' using errcode = '42501';
  end if;
  if not public.has_world_permission(p_user, 'housing', p_action) then
    raise exception 'world_permission_denied' using errcode = '42501';
  end if;
  if not public.has_accepted_housing_conduct(p_user) then
    raise exception 'housing_conduct_required' using errcode = '42501';
  end if;
end;
$$;

-- One push to the other side of a booking change (FR-HOUSING-017 AC3, notifications catalog).
-- `housing_booking_requested` → copy key `housingBookingRequested` (camelCase).
create or replace function public.housing_booking_enqueue(
  p_row public.giving_handoffs, p_kind text, p_to uuid, p_actor uuid, p_category text default 'critical'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := 'housingBooking' || initcap(split_part(p_kind, '_', 3));
  v_check_in date;
begin
  select check_in_date into v_check_in from public.housing_booking_details where handoff_id = p_row.handoff_id;
  perform public.enqueue_notification(
    p_to, p_category, p_kind,
    'notifications.' || v_key || 'Title',
    'notifications.' || v_key || 'Body',
    jsonb_build_object(
      'name', coalesce((select display_name from public.users where user_id = p_actor), ''),
      'listingTitle', coalesce((select title from public.listings where listing_id = p_row.listing_id), ''),
      'guests', p_row.seats,
      'checkIn', coalesce(to_char(v_check_in, 'DD/MM'), '')),
    jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                       'params', jsonb_build_object('listingId', p_row.listing_id::text)),
    p_kind || ':' || p_row.handoff_id::text,
    false
  );
end;
$$;

-- ── 4a. Guest requests a stay ────────────────────────────────────────────────
create or replace function public.request_housing_booking(
  p_listing_id uuid,
  p_check_in date,
  p_check_out date,
  p_adults int,
  p_minors int default 0,
  p_message text default null,
  p_minors_guardian_ack boolean default false
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.listings;
  v_nights int := p_check_out - p_check_in;
  v_party int := coalesce(p_adults, 0) + coalesce(p_minors, 0);
  v_start timestamptz;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  perform public.housing_assert_eligible(v_uid, 'book');

  -- Lock the offer so concurrent requests and approvals see one capacity picture.
  select l.* into v_listing
    from public.listings l
    join public.listing_kinds k on k.kind_id = l.kind_id
   where l.listing_id = p_listing_id and l.world_slug = 'housing' and l.status = 'open'
     and k.slug = 'host_offer'
   for update of l;
  if not found or not public.is_listing_visible_to(v_listing, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_listing.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;

  -- Dates: from today (Israel) up to 180 days ahead, within the offer's night limits.
  if p_check_in is null or p_check_out is null
     or p_check_in < public.housing_today() or p_check_in > public.housing_today() + 180 then
    raise exception 'housing_dates_invalid' using errcode = '23514';
  end if;
  if v_nights < (v_listing.details->>'min_nights')::int or v_nights > (v_listing.details->>'max_nights')::int then
    raise exception 'housing_nights_out_of_range' using errcode = '23514';
  end if;
  -- A same-day request is possible only while the host's check-in window is still open.
  if now() > public.housing_check_in_deadline(v_listing.details, p_check_in) then
    raise exception 'housing_dates_invalid' using errcode = '23514';
  end if;

  -- Party and the host's policy (FR-HOUSING-015 AC2, FR-HOUSING-026).
  if coalesce(p_adults, 0) < 1 or coalesce(p_minors, 0) < 0 or v_party > 8 then
    raise exception 'housing_capacity_exceeded' using errcode = '23514';
  end if;
  if p_minors > 0 and not (v_listing.details->>'children_ok')::boolean then
    raise exception 'housing_policy_mismatch' using errcode = '23514';
  end if;
  if p_minors > 0 and not coalesce(p_minors_guardian_ack, false) then
    raise exception 'housing_minor_unaccompanied' using errcode = '23514';
  end if;
  if p_message is null or char_length(btrim(p_message)) not between 1 and 500 then
    raise exception 'housing_message_required' using errcode = '23514';
  end if;

  -- One active booking per offer, ≤ 3 waiting requests, no second stay on the same nights.
  if exists (select 1 from public.giving_handoffs
              where listing_id = p_listing_id and recipient_id = v_uid
                and status in ('reserved', 'confirmed')) then
    raise exception 'already_booked' using errcode = '23505';
  end if;
  if (select count(*) from public.giving_handoffs
       where recipient_id = v_uid and world_slug = 'housing' and status = 'reserved') >= 3 then
    raise exception 'housing_pending_cap' using errcode = '23514';
  end if;
  if public.housing_guest_has_overlap(v_uid, p_check_in, p_check_out, null) then
    raise exception 'housing_booking_overlap' using errcode = '23514';
  end if;
  perform public.housing_assert_nights_bookable(v_listing, p_check_in, p_check_out, v_party, null);

  v_start := public.housing_check_in_at(v_listing.details, p_check_in);
  insert into public.giving_handoffs (
    listing_id, owner_id, recipient_id, world_slug, status, seats,
    slot_starts_at, slot_ends_at, confirm_by
  ) values (
    p_listing_id, v_listing.owner_id, v_uid, 'housing', 'reserved', v_party,
    v_start, public.housing_check_out_at(v_listing.details, p_check_out),
    -- Unanswered requests expire after 24 h or at check-in, whichever is earlier (FR-HOUSING-017).
    least(now() + interval '24 hours', public.housing_check_in_deadline(v_listing.details, p_check_in))
  )
  returning * into v_row;

  insert into public.housing_booking_details (
    handoff_id, check_in_date, check_out_date, adults, minors, message, minors_guardian_ack
  ) values (
    v_row.handoff_id, p_check_in, p_check_out, p_adults, p_minors, btrim(p_message),
    coalesce(p_minors_guardian_ack, false)
  );

  -- Told here, after the details exist, so the host's push carries the dates.
  perform public.housing_booking_enqueue(v_row, 'housing_booking_requested', v_row.owner_id, v_uid);
  return v_row;
end;
$$;

-- ── 4b. Host approves or declines ────────────────────────────────────────────
create or replace function public.decide_housing_booking(
  p_handoff_id uuid,
  p_approve boolean,
  p_note text default null
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.giving_handoffs;
  v_listing public.listings;
  v_details public.housing_booking_details;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if p_note is not null and char_length(p_note) > 300 then
    raise exception 'housing_note_too_long' using errcode = '23514';
  end if;

  -- Locks follow listing → booking order, like the rides approval (0533).
  select * into v_row from public.giving_handoffs
   where handoff_id = p_handoff_id and world_slug = 'housing';
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  select * into v_listing from public.listings where listing_id = v_row.listing_id for update;
  select * into v_row from public.giving_handoffs where handoff_id = p_handoff_id for update;
  if v_row.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_row.status <> 'reserved' then raise exception 'invalid_status' using errcode = '23514'; end if;

  if not coalesce(p_approve, false) then
    update public.housing_booking_details set decision_note = nullif(btrim(p_note), '')
     where handoff_id = p_handoff_id;
    update public.giving_handoffs
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'declined'
     where handoff_id = p_handoff_id
    returning * into v_row;
    return v_row;
  end if;

  perform public.housing_assert_eligible(v_uid, 'decide');
  perform public.housing_assert_eligible(v_row.recipient_id, 'book');
  if v_listing.status <> 'open' then raise exception 'listing_not_available' using errcode = 'P0002'; end if;

  select * into v_details from public.housing_booking_details where handoff_id = p_handoff_id;
  if public.housing_guest_has_overlap(v_row.recipient_id, v_details.check_in_date, v_details.check_out_date, p_handoff_id) then
    raise exception 'housing_booking_overlap' using errcode = '23514';
  end if;
  perform public.housing_assert_nights_bookable(
    v_listing, v_details.check_in_date, v_details.check_out_date, v_row.seats, p_handoff_id);

  update public.housing_booking_details set decision_note = nullif(btrim(p_note), '')
   where handoff_id = p_handoff_id;
  update public.giving_handoffs
     set status = 'confirmed', confirmed_at = now()
   where handoff_id = p_handoff_id
  returning * into v_row;

  -- First confirmation wins: the guest's other waiting requests for overlapping nights end
  -- (FR-HOUSING-015 AC3); their hosts are told the guest found another place (0603).
  update public.giving_handoffs h
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded'
    from public.housing_booking_details d
   where d.handoff_id = h.handoff_id
     and h.recipient_id = v_row.recipient_id
     and h.world_slug = 'housing'
     and h.status = 'reserved'
     and h.handoff_id <> p_handoff_id
     and d.check_in_date < v_details.check_out_date and v_details.check_in_date < d.check_out_date;

  return v_row;
end;
$$;

-- ── Grants (0520) ────────────────────────────────────────────────────────────
revoke all on function public.housing_night_open(jsonb, date) from public;
revoke all on function public.housing_check_in_at(jsonb, date) from public;
revoke all on function public.housing_check_in_deadline(jsonb, date) from public;
revoke all on function public.housing_check_out_at(jsonb, date) from public;
revoke all on function public.housing_guests_on_night(uuid, date, uuid) from public;
revoke all on function public.housing_assert_nights_bookable(public.listings, date, date, int, uuid) from public;
revoke all on function public.housing_guest_has_overlap(uuid, date, date, uuid) from public;
revoke all on function public.housing_assert_eligible(uuid, text) from public;
revoke all on function public.housing_booking_enqueue(public.giving_handoffs, text, uuid, uuid, text) from public;
revoke all on function public.request_housing_booking(uuid, date, date, int, int, text, boolean) from public;
revoke all on function public.decide_housing_booking(uuid, boolean, text) from public;

grant execute on function public.housing_night_open(jsonb, date) to authenticated, service_role;
grant execute on function public.housing_check_in_at(jsonb, date) to service_role;
grant execute on function public.housing_check_in_deadline(jsonb, date) to service_role;
grant execute on function public.housing_check_out_at(jsonb, date) to service_role;
grant execute on function public.housing_guests_on_night(uuid, date, uuid) to service_role;
grant execute on function public.housing_assert_nights_bookable(public.listings, date, date, int, uuid) to service_role;
grant execute on function public.housing_guest_has_overlap(uuid, date, date, uuid) to service_role;
grant execute on function public.housing_assert_eligible(uuid, text) to service_role;
grant execute on function public.housing_booking_enqueue(public.giving_handoffs, text, uuid, uuid, text) to service_role;
grant execute on function public.request_housing_booking(uuid, date, date, int, int, text, boolean) to authenticated;
grant execute on function public.decide_housing_booking(uuid, boolean, text) to authenticated;

commit;
