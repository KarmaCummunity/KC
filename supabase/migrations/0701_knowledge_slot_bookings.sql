-- 0701_knowledge_slot_bookings | #2034 (epic #1687, KNOW-K1-B 1/6) · FR-KNOW-004 AC2, AC3, AC5
-- (docs/spec/requirements/23_knowledge.md) · docs/spec/18_knowledge_world.md §18.4, §18.10.
--
-- Booking a seat on a knowledge slot (0700), end to end:
--   list_knowledge_slots       upcoming open slots of a post with the seats left and the caller's
--                              own booking, for the learner's slot picker
--   book_knowledge_seat        one seat on one slot; waits for the giver (reserved)
--   book_knowledge_slot        kept for builds that still book a post (expand / contract): books
--                              the soonest slot with a free seat
--   confirm_knowledge_booking  the giver approves a waiting booking
--   decline_knowledge_booking  the giver declines it (cancel_reason 'declined')
--   list_knowledge_bookings    the giver's panel: every booking of their post
--   complete_knowledge_session the session took place: karma per half hour for the giver, capped
--                              at 80 a day (S72, D32), 5 for the learner, once per booking
--   knowledge_bookings_expire_sweep  an unanswered booking expires at the earlier of 24 h and the
--                              slot start, freeing its seat (D96 pattern); every 10 minutes
--   knowledge_offers_expired_sweep   an offer whose last slot ended 30 min ago expires; hourly
--   knowledge_booking_notify   pushes for request, approval, decline, expiry, cancellation and
--                              completion, with knowledge copy (the shared giving copy speaks of
--                              pickup and handover)
-- Cancelling stays `cancel_giving_handoff` (either side, reserved or confirmed).

begin;

-- ── 1. Read: slots of a post ──────────────────────────────────────────────────────────────────
create or replace function public.list_knowledge_slots(p_post_id uuid)
returns table (
  slot_id        uuid,
  starts_at      timestamptz,
  ends_at        timestamptz,
  capacity       integer,
  seats_left     integer,
  my_handoff_id  uuid,
  my_status      text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_post public.posts;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_post from public.posts
   where post_id = public.handoff_target_post_id(p_post_id) and world_slug = 'knowledge';
  if not found or not public.is_post_visible_to(v_post, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  return query
  select s.slot_id, s.starts_at, s.ends_at, s.capacity::integer,
         greatest(s.capacity - public.knowledge_slot_seats_taken(s.slot_id), 0)::integer,
         mine.handoff_id, mine.status
    from public.knowledge_slots s
    left join lateral (
      select h.handoff_id, h.status from public.post_handoffs h
       where h.knowledge_slot_id = s.slot_id and h.recipient_id = v_uid
       order by h.reserved_at desc
       limit 1
    ) mine on true
   where s.post_id = v_post.post_id
     and s.status = 'open'
     -- Upcoming slots, plus a slot the caller booked for a week after it ends: the learner
     -- completes and rates the session after it took place.
     and (s.ends_at > now()
          or (mine.status in ('reserved', 'confirmed', 'handed_over') and s.ends_at > now() - interval '7 days'))
   order by s.starts_at;
end;
$$;

-- ── 2. Book a seat ────────────────────────────────────────────────────────────────────────────
create or replace function public.book_knowledge_seat(p_slot_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_slot public.knowledge_slots;
  v_post public.posts;
  v_handoff_id uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if not public.is_active_member(v_uid) then
    raise exception 'account_not_active' using errcode = '42501';
  end if;
  -- The slot row is the lock: two learners racing for the last seat serialize here.
  select * into v_slot from public.knowledge_slots where slot_id = p_slot_id for update;
  if not found or v_slot.status <> 'open' then
    raise exception 'slot_not_found' using errcode = 'P0002';
  end if;
  select * into v_post from public.posts where post_id = v_slot.post_id;
  if v_post.world_slug <> 'knowledge' or v_post.status <> 'open'
     or not public.is_post_visible_to(v_post, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_post.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
  if v_slot.starts_at <= now() then raise exception 'slot_started' using errcode = '23514'; end if;
  if exists (
    select 1 from public.post_handoffs h
     where h.knowledge_slot_id = p_slot_id and h.recipient_id = v_uid
       and h.status in ('reserved', 'confirmed')
  ) then
    raise exception 'already_booked' using errcode = '23505';
  end if;
  if public.knowledge_slot_seats_taken(p_slot_id) >= v_slot.capacity then
    raise exception 'slots_exhausted' using errcode = 'P0001';
  end if;

  insert into public.post_handoffs (
    post_id, owner_id, recipient_id, world_slug, status, seats,
    slot_starts_at, slot_ends_at, confirm_by, knowledge_slot_id
  ) values (
    v_post.post_id, v_post.owner_id, v_uid, 'knowledge', 'reserved', 1,
    v_slot.starts_at, v_slot.ends_at,
    -- The giver answers within 24 hours, and in any case before the session starts.
    least(now() + interval '24 hours', v_slot.starts_at), p_slot_id
  )
  returning handoff_id into v_handoff_id;
  return public.giving_handoff_row_of(v_handoff_id);
end;
$$;

-- Compatibility (expand / contract): builds released before #2034 book a post, not a slot. The
-- soonest upcoming slot that has a free seat or already holds the caller's booking is taken, so
-- booking twice still answers `already_booked` as it did with one slot per post. Remove once no
-- supported build calls it.
create or replace function public.book_knowledge_slot(p_listing_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot_id uuid;
begin
  select s.slot_id into v_slot_id
    from public.knowledge_slots s
   where s.post_id = public.handoff_target_post_id(p_listing_id)
     and s.status = 'open'
     and s.starts_at > now()
     and (public.knowledge_slot_seats_taken(s.slot_id) < s.capacity
          or exists (select 1 from public.post_handoffs h
                      where h.knowledge_slot_id = s.slot_id and h.recipient_id = auth.uid()
                        and h.status in ('reserved', 'confirmed')))
   order by s.starts_at
   limit 1;
  if v_slot_id is null then
    raise exception 'slots_exhausted' using errcode = 'P0001';
  end if;
  return public.book_knowledge_seat(v_slot_id);
end;
$$;

-- ── 3. The giver answers ──────────────────────────────────────────────────────────────────────
-- Locks a waiting knowledge booking of the caller's post, or raises.
create or replace function public.knowledge_lock_waiting_booking(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.post_handoffs;
begin
  if auth.uid() is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'knowledge' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> auth.uid() then raise exception 'not_owner' using errcode = '42501'; end if;
  if v_h.status <> 'reserved' then raise exception 'invalid_status' using errcode = '23514'; end if;
  return v_h;
end;
$$;

create or replace function public.confirm_knowledge_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.post_handoffs := public.knowledge_lock_waiting_booking(p_handoff_id);
begin
  if v_h.confirm_by is not null and v_h.confirm_by <= now() then
    raise exception 'booking_expired' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'confirmed', confirmed_at = now()
   where handoff_id = p_handoff_id;
  return public.giving_handoff_row_of(p_handoff_id);
end;
$$;

create or replace function public.decline_knowledge_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.knowledge_lock_waiting_booking(p_handoff_id);
  update public.post_handoffs
     set status = 'cancelled', cancel_reason = 'declined', cancelled_at = now()
   where handoff_id = p_handoff_id;
  return public.giving_handoff_row_of(p_handoff_id);
end;
$$;

-- The giver's panel: every booking of their post, newest slot last.
create or replace function public.list_knowledge_bookings(p_post_id uuid)
returns table (
  handoff_id     uuid,
  slot_id        uuid,
  starts_at      timestamptz,
  ends_at        timestamptz,
  status         text,
  cancel_reason  text,
  confirm_by     timestamptz,
  learner_id     uuid,
  learner_name   text,
  learner_avatar text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_post_id uuid := public.handoff_target_post_id(p_post_id);
begin
  if auth.uid() is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.posts p
                  where p.post_id = v_post_id and p.owner_id = auth.uid() and p.world_slug = 'knowledge') then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  return query
  select h.handoff_id, h.knowledge_slot_id, h.slot_starts_at, h.slot_ends_at, h.status,
         h.cancel_reason, h.confirm_by, h.recipient_id, u.display_name, u.avatar_url
    from public.post_handoffs h
    left join public.users u on u.user_id = h.recipient_id
   where h.post_id = v_post_id and h.world_slug = 'knowledge'
   order by h.slot_starts_at nulls last, h.reserved_at;
end;
$$;

-- ── 4. Completion and karma ───────────────────────────────────────────────────────────────────
-- Giver karma units of a session: one a started half hour, each worth the knowledge giver value
-- of karma_handoff_points (5, so 10 an hour), never more units than what is left of the 80-a-day
-- cap of knowledge sessions (D32), counted on the Israeli calendar day.
create or replace function public.knowledge_session_giver_units(
  p_giver uuid, p_starts_at timestamptz, p_ends_at timestamptz
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with earned_today as (
    select coalesce(sum(l.points_delta), 0)::integer as points
      from public.karma_ledger l
      join public.post_handoffs h on h.handoff_id::text = l.ref_id
     where l.user_id = p_giver
       and l.event_type = 'giving_handoff_giver'
       and h.world_slug = 'knowledge'
       and (l.created_at at time zone 'Asia/Jerusalem')::date = (now() at time zone 'Asia/Jerusalem')::date
  )
  -- A booking without times (published before slots existed) counts as one half hour. Integer
  -- division floors what is left of the cap to whole units.
  select greatest(0, least(
           greatest(1, ceil(extract(epoch from coalesce(p_ends_at - p_starts_at, interval '30 minutes'))
                            / 1800.0)::integer),
           (80 - earned_today.points) / public.karma_handoff_points('knowledge', 'giver')))
    from earned_today;
$$;

create or replace function public.complete_knowledge_session(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_units integer;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'knowledge' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_uid not in (v_h.owner_id, v_h.recipient_id) then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_h.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  if v_h.slot_starts_at is not null and v_h.slot_starts_at > now() + interval '15 minutes' then
    raise exception 'session_not_started' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'handed_over', handed_over_at = now(), confirmed_at = coalesce(confirmed_at, now())
   where handoff_id = p_handoff_id;

  -- Karma goes through the one config (0453): the giver per half hour, the learner once.
  v_units := public.knowledge_session_giver_units(v_h.owner_id, v_h.slot_starts_at, v_h.slot_ends_at);
  if v_units > 0 then
    perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, 'knowledge', p_handoff_id, v_units);
  else
    -- The giver reached today's cap; the learner still earns their share.
    perform public.karma_grant_once(v_h.recipient_id, 'giving_handoff_receiver', 'giving_handoff',
                                    p_handoff_id::text, public.karma_handoff_points('knowledge', 'receiver'));
  end if;
  return public.giving_handoff_row_of(p_handoff_id);
end;
$$;

-- ── 5. Sweeps ─────────────────────────────────────────────────────────────────────────────────
create or replace function public.knowledge_bookings_expire_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.post_handoffs
     set status = 'cancelled', cancel_reason = 'expired', cancelled_at = now()
   where world_slug = 'knowledge'
     and status = 'reserved'
     and confirm_by is not null
     and confirm_by <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.knowledge_offers_expired_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- open / paused → expired are edges of the post machine (0681); confirmed bookings stay
  -- completable after the offer expires.
  update public.posts
     set status = 'expired', updated_at = now()
   where world_slug = 'knowledge'
     and status in ('open', 'paused')
     and expires_at is not null
     and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── 6. Notifications ──────────────────────────────────────────────────────────────────────────
create or replace function public.knowledge_booking_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind  text;
  v_to    uuid[];
  v_title text;
  v_who   uuid;
  v_r     uuid;
begin
  if tg_op = 'INSERT' then
    if new.status = 'reserved' then v_kind := 'knowledge_booking_requested'; v_to := array[new.owner_id]; end if;
  elsif new.status is distinct from old.status then
    case new.status
      when 'confirmed' then v_kind := 'knowledge_booking_confirmed'; v_to := array[new.recipient_id];
      when 'cancelled' then
        v_kind := case new.cancel_reason
                    when 'declined' then 'knowledge_booking_declined'
                    when 'expired' then 'knowledge_booking_expired'
                    else 'knowledge_booking_cancelled' end;
        -- Both sides; enqueue_notification never notifies the member who acted.
        v_to := array[new.owner_id, new.recipient_id];
      when 'handed_over' then v_kind := 'knowledge_session_completed'; v_to := array[new.owner_id, new.recipient_id];
      else null;
    end case;
  end if;
  if v_kind is null then return new; end if;

  select title into v_title from public.posts where post_id = new.post_id;
  foreach v_r in array v_to loop
    v_who := case when v_r = new.owner_id then new.recipient_id else new.owner_id end;
    perform public.enqueue_notification(
      v_r, 'critical', v_kind,
      'notifications.' || public.knowledge_booking_copy_key(v_kind) || 'Title',
      'notifications.' || public.knowledge_booking_copy_key(v_kind) || 'Body',
      jsonb_build_object(
        'name', coalesce((select display_name from public.users where user_id = v_who), ''),
        'listingTitle', coalesce(v_title, ''),
        'startsAt', coalesce(to_char(new.slot_starts_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI'), '')),
      jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                         'params', jsonb_build_object('listingId', public.listing_id_of_post(new.post_id)::text)),
      v_kind || ':' || new.handoff_id::text || ':' || v_r::text,
      false
    );
  end loop;
  return new;
end;
$$;

-- 'knowledge_booking_requested' → 'knowledgeBookingRequested' (the locale key stem).
create or replace function public.knowledge_booking_copy_key(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  with camel as (select replace(initcap(replace(p_kind, '_', ' ')), ' ', '') as v)
  select lower(left(v, 1)) || substr(v, 2) from camel;
$$;

drop trigger if exists post_handoffs_knowledge_notify on public.post_handoffs;
create trigger post_handoffs_knowledge_notify
  after insert or update of status on public.post_handoffs
  for each row when (new.world_slug = 'knowledge')
  execute function public.knowledge_booking_notify();

-- ── 7. Schedules ──────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'knowledge_bookings_expire_sweep') then
      perform cron.unschedule('knowledge_bookings_expire_sweep');
    end if;
    perform cron.schedule('knowledge_bookings_expire_sweep', '*/10 * * * *',
      $sql$ select public.knowledge_bookings_expire_sweep(); $sql$);
    if exists (select 1 from cron.job where jobname = 'knowledge_offers_expired_hourly') then
      perform cron.unschedule('knowledge_offers_expired_hourly');
    end if;
    perform cron.schedule('knowledge_offers_expired_hourly', '35 * * * *',
      $sql$ select public.knowledge_offers_expired_sweep(); $sql$);
  else
    raise notice 'pg_cron not enabled — knowledge sweeps not scheduled.';
  end if;
end $$;

-- ── 8. Privileges (0520) ──────────────────────────────────────────────────────────────────────
revoke all on function public.list_knowledge_slots(uuid) from public, anon;
grant execute on function public.list_knowledge_slots(uuid) to authenticated;
revoke all on function public.book_knowledge_seat(uuid) from public, anon;
grant execute on function public.book_knowledge_seat(uuid) to authenticated;
revoke all on function public.book_knowledge_slot(uuid) from public, anon;
grant execute on function public.book_knowledge_slot(uuid) to authenticated;
revoke all on function public.confirm_knowledge_booking(uuid) from public, anon;
grant execute on function public.confirm_knowledge_booking(uuid) to authenticated;
revoke all on function public.decline_knowledge_booking(uuid) from public, anon;
grant execute on function public.decline_knowledge_booking(uuid) to authenticated;
revoke all on function public.list_knowledge_bookings(uuid) from public, anon;
grant execute on function public.list_knowledge_bookings(uuid) to authenticated;
revoke all on function public.complete_knowledge_session(uuid) from public, anon;
grant execute on function public.complete_knowledge_session(uuid) to authenticated;
-- Internal: RPCs, triggers and pg_cron only.
revoke all on function public.knowledge_lock_waiting_booking(uuid) from public, anon, authenticated;
revoke all on function public.knowledge_session_giver_units(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.knowledge_bookings_expire_sweep() from public, anon, authenticated;
revoke all on function public.knowledge_offers_expired_sweep() from public, anon, authenticated;
revoke all on function public.knowledge_booking_notify() from public, anon, authenticated;
revoke all on function public.knowledge_booking_copy_key(text) from public, anon, authenticated;
grant execute on function public.knowledge_bookings_expire_sweep() to service_role;
grant execute on function public.knowledge_offers_expired_sweep() to service_role;

commit;
