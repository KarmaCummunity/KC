-- 0621_g1_handoff_triggers_on_posts | G1 step 6a-3a (ADR-006, D-214, issue #1671): what reacts to
-- or hangs off `giving_handoffs` moves to `post_handoffs`, the handoff record.
--
-- Every handoff writer writes the record since 0555 / 0558 / 0610 and the readers read it since
-- 0565 / 0620; `giving_handoffs` is the derived copy (same `handoff_id`, `listing_id` in place of
-- `post_id`). This group moves the rest of what still sits on it:
--   1. giving_handoff_notify (0528)  item / food pushes: trigger giving_handoffs_giving_notify
--                                    becomes post_handoffs_giving_notify
--   2. ride_booking_notify   (0511)  ride booking pushes: giving_handoffs_ride_notify becomes
--                                    post_handoffs_ride_notify
--   3. housing_booking_enqueue (0602) takes the record row (the giving_handoffs signature is
--      dropped); request_housing_booking (0610) passes it the record. housing_booking_notify (0603)
--      is unchanged: its body names no column the two tables do not share. The trigger
--      giving_handoffs_housing_notify becomes post_handoffs_housing_notify
--   4. giving_handoffs_set_cancel_reason (0511): unchanged body; the trigger moves to the record
--   5. the foreign keys of giving_handoff_ratings (0380) and housing_booking_details (0602)
--      reference post_handoffs(handoff_id), on delete cascade as before
--   6. rate_giving_handoff   (0510)  reads the handoff on the record
--   7. food_expired_listings_sweep (0555) cancels on the record only; the sync derives the rest
-- Each trigger is created on post_handoffs and dropped from giving_handoffs in this transaction,
-- with the same timing, events and WHEN clause, so every change pushes exactly once. A write that
-- still lands on giving_handoffs (a direct insert or update) reaches the record through the 0553
-- sync and fires the moved triggers there. Each changed body is the latest definition copied
-- verbatim; every changed line carries a `-- 0621:` note. Payloads are unchanged: the listing id
-- stays in `params.listingId` (`listing_id_of_post`), and the 0562 outbox trigger still adds the
-- post route.
--
-- On existing data the behaviour is the same, except:
--   * time-world event registrations live on post_handoffs only (0563 / 0564). The notification
--     triggers already filter on their worlds; the cancel-reason default skips world 'time', so an
--     event cancellation keeps the reason its RPC wrote (none for the attendee's own cancel), and
--     rate_giving_handoff keeps refusing an event registration (handoff_not_found), as before.
--   * a push names the post's title, which is the listing's for post-sourced listings and capped at
--     80 characters where a listing-sourced listing's title could reach 120 (as in 0620).
--   * a handoff that never reached the record (a listing that never got a post, 0620): the food
--     sweep no longer cancels it (every food listing has a post since 0557), and a rating or
--     booking-details row of one keeps its old foreign key, the new one left NOT VALID with a
--     warning, to be resolved before step 6c drops the sync. A fresh database validates both.
-- Out of scope (6a-3b): the writer RPCs still return their derived giving_handoffs row. Left on
-- giving_handoffs on purpose: giving_handoffs_rate_limit and giving_handoffs_post_handoffs_sync
-- (step 6c). Numbered above the housing range (0600–0610) because 3 redefines functions defined
-- there. Idempotent.

begin;

-- ── 1. Item and food pushes (0528) ────────────────────────────────────────────────────────────

create or replace function public.giving_handoff_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- The member whose call changed the handoff; null for a sweep or a service-role write.
  v_actor uuid := auth.uid();
  v_kind text;
  v_recipients uuid[];
  v_title text;
  v_to uuid;
begin
  if tg_op = 'INSERT' then
    -- An item request waits for the giver; a food quick claim (0383) is confirmed at once.
    if new.status = 'reserved' then
      v_kind := 'giving_handoff_requested';
      v_recipients := array[new.owner_id];
    elsif new.status = 'confirmed' then
      v_kind := 'giving_handoff_claimed';
      v_recipients := array[new.owner_id];
    end if;
  elsif new.status is distinct from old.status then
    case new.status
      when 'confirmed' then
        v_kind := 'giving_handoff_confirmed';
        v_recipients := array[new.recipient_id];
      when 'cancelled' then
        if old.status = 'reserved' and v_actor = new.owner_id then
          v_kind := 'giving_handoff_declined';
        else
          v_kind := 'giving_handoff_cancelled';
        end if;
        -- Both sides: self-suppression drops the side that cancelled.
        v_recipients := array[new.owner_id, new.recipient_id];
      when 'handed_over' then
        v_kind := 'giving_handoff_completed';
        v_recipients := array[new.owner_id, new.recipient_id];
      else
        null;
    end case;
  end if;
  if v_kind is null then
    return new;
  end if;

  select title into v_title from public.posts where post_id = new.post_id; -- 0621: the post's title
  foreach v_to in array v_recipients loop
    perform public.enqueue_notification(
      v_to, 'critical', v_kind,
      'notifications.' || public.giving_handoff_copy_key(v_kind) || 'Title',
      'notifications.' || public.giving_handoff_copy_key(v_kind) || 'Body',
      jsonb_build_object(
        -- The other side's name: the push is about what they did or asked for.
        'name', coalesce((select display_name from public.users
                           where user_id = case when v_to = new.owner_id then new.recipient_id
                                                else new.owner_id end), ''),
        'listingTitle', coalesce(v_title, '')),
      jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                         'params', jsonb_build_object(
                           'listingId', public.listing_id_of_post(new.post_id)::text)), -- 0621: the derived listing
      -- One push per kind, handoff and recipient: both sides can get the same kind.
      v_kind || ':' || new.handoff_id::text || ':' || v_to::text,
      false
    );
  end loop;
  return new;
end;
$$;

revoke all on function public.giving_handoff_notify() from public, anon, authenticated;
grant execute on function public.giving_handoff_notify() to service_role;

-- ── 2. Ride booking pushes (0511) ─────────────────────────────────────────────────────────────

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
        else v_kind := 'ride_booking_cancelled'; v_to := new.recipient_id; v_actor := new.owner_id;
      end case;
    end if;
  end if;
  if v_kind is null then return new; end if;

  select title into v_title from public.posts where post_id = new.post_id; -- 0621: the post's title
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
                         'listingId', public.listing_id_of_post(new.post_id)::text)), -- 0621: the derived listing
    v_kind || ':' || new.handoff_id::text,
    false
  );
  return new;
end;
$$;

revoke all on function public.ride_booking_notify() from public, anon, authenticated;
grant execute on function public.ride_booking_notify() to service_role; -- (0520)

-- ── 3. Housing booking pushes (0602, 0610) ────────────────────────────────────────────────────

-- One push to the other side of a booking change (FR-HOUSING-017 AC3, notifications catalog).
-- `housing_booking_requested` → copy key `housingBookingRequested` (camelCase).
create or replace function public.housing_booking_enqueue(
  p_row public.post_handoffs, p_kind text, p_to uuid, p_actor uuid, p_category text default 'critical' -- 0621: the record
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
      'listingTitle', coalesce((select title from public.posts where post_id = p_row.post_id), ''), -- 0621
      'guests', p_row.seats,
      'checkIn', coalesce(to_char(v_check_in, 'DD/MM'), '')),
    jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                       'params', jsonb_build_object(
                         'listingId', public.listing_id_of_post(p_row.post_id)::text)), -- 0621: the derived listing
    p_kind || ':' || p_row.handoff_id::text,
    false
  );
end;
$$;

revoke all on function public.housing_booking_enqueue(public.post_handoffs, text, uuid, uuid, text) from public;
grant execute on function public.housing_booking_enqueue(public.post_handoffs, text, uuid, uuid, text) to service_role;

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
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_listing public.listings;
  v_nights int := p_check_out - p_check_in;
  v_party int := coalesce(p_adults, 0) + coalesce(p_minors, 0);
  v_start timestamptz;
  v_handoff_id uuid;
  v_h public.post_handoffs; -- 0621: the record, for the host's push
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  perform public.housing_assert_eligible(v_uid, 'book');

  -- Lock the offer so concurrent requests and approvals see one capacity picture.
  select l.* into v_listing
    from public.listings l
    join public.listing_kinds k on k.kind_id = l.kind_id
   where l.listing_id = public.listing_id_of_post(v_post_id) and l.world_slug = 'housing' and l.status = 'open'
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
  if exists (select 1 from public.post_handoffs
              where post_id = v_post_id and recipient_id = v_uid
                and status in ('reserved', 'confirmed')) then
    raise exception 'already_booked' using errcode = '23505';
  end if;
  if (select count(*) from public.post_handoffs
       where recipient_id = v_uid and world_slug = 'housing' and status = 'reserved') >= 3 then
    raise exception 'housing_pending_cap' using errcode = '23514';
  end if;
  if public.housing_guest_has_overlap(v_uid, p_check_in, p_check_out, null) then
    raise exception 'housing_booking_overlap' using errcode = '23514';
  end if;
  perform public.housing_assert_nights_bookable(v_listing, p_check_in, p_check_out, v_party, null);

  v_start := public.housing_check_in_at(v_listing.details, p_check_in);
  -- The record first: its sync derives the giving_handoffs row the details row points at.
  insert into public.post_handoffs (
    post_id, owner_id, recipient_id, world_slug, status, seats,
    slot_starts_at, slot_ends_at, confirm_by
  ) values (
    v_post_id, v_listing.owner_id, v_uid, 'housing', 'reserved', v_party,
    v_start, public.housing_check_out_at(v_listing.details, p_check_out),
    -- Unanswered requests expire after 24 h or at check-in, whichever is earlier (FR-HOUSING-017).
    least(now() + interval '24 hours', public.housing_check_in_deadline(v_listing.details, p_check_in))
  )
  returning handoff_id into v_handoff_id;

  insert into public.housing_booking_details (
    handoff_id, check_in_date, check_out_date, adults, minors, message, minors_guardian_ack
  ) values (
    v_handoff_id, p_check_in, p_check_out, p_adults, p_minors, btrim(p_message),
    coalesce(p_minors_guardian_ack, false)
  );

  select * into v_row from public.giving_handoffs where handoff_id = v_handoff_id;
  select * into v_h from public.post_handoffs where handoff_id = v_handoff_id; -- 0621
  -- Told here, after the details exist, so the host's push carries the dates.
  perform public.housing_booking_enqueue(v_h, 'housing_booking_requested', v_h.owner_id, v_uid); -- 0621: the record
  return v_row;
end;
$$;

revoke all on function public.request_housing_booking(uuid, date, date, int, int, text, boolean) from public, anon;
grant execute on function public.request_housing_booking(uuid, date, date, int, int, text, boolean) to authenticated;

-- No caller is left: request_housing_booking (above) and housing_booking_notify pass the record.
drop function if exists public.housing_booking_enqueue(public.giving_handoffs, text, uuid, uuid, text);

-- ── 4. The triggers move to the record (0511, 0528, 0603) ─────────────────────────────────────

drop trigger if exists giving_handoffs_set_cancel_reason on public.giving_handoffs;
drop trigger if exists post_handoffs_set_cancel_reason on public.post_handoffs;
create trigger post_handoffs_set_cancel_reason
  before update of status on public.post_handoffs
  -- 0621: an event registration keeps the reason its RPC wrote (giving_handoffs never held one).
  for each row when (new.world_slug <> 'time')
  execute function public.giving_handoffs_set_cancel_reason();

drop trigger if exists giving_handoffs_giving_notify on public.giving_handoffs;
drop trigger if exists post_handoffs_giving_notify on public.post_handoffs;
create trigger post_handoffs_giving_notify
  after insert or update of status on public.post_handoffs
  for each row when (new.world_slug in ('items', 'food'))
  execute function public.giving_handoff_notify();

drop trigger if exists giving_handoffs_ride_notify on public.giving_handoffs;
drop trigger if exists post_handoffs_ride_notify on public.post_handoffs;
create trigger post_handoffs_ride_notify
  after insert or update of status on public.post_handoffs
  for each row when (new.world_slug = 'rides')
  execute function public.ride_booking_notify();

drop trigger if exists giving_handoffs_housing_notify on public.giving_handoffs;
drop trigger if exists post_handoffs_housing_notify on public.post_handoffs;
create trigger post_handoffs_housing_notify
  after update of status on public.post_handoffs
  for each row when (new.world_slug = 'housing')
  execute function public.housing_booking_notify();

-- ── 5. Foreign keys into the record (0380, 0602) ──────────────────────────────────────────────
-- The new key is added NOT VALID and validated, then the old one is dropped. A row whose handoff
-- never reached the record (a listing without a post, 0620) would fail the validation: then both
-- keys stay, the new one unvalidated (still enforced for new rows), and a warning names the count.

alter table public.giving_handoff_ratings drop constraint if exists giving_handoff_ratings_post_handoff_fkey;
alter table public.giving_handoff_ratings
  add constraint giving_handoff_ratings_post_handoff_fkey
  foreign key (handoff_id) references public.post_handoffs(handoff_id) on delete cascade not valid;

alter table public.housing_booking_details drop constraint if exists housing_booking_details_post_handoff_fkey;
alter table public.housing_booking_details
  add constraint housing_booking_details_post_handoff_fkey
  foreign key (handoff_id) references public.post_handoffs(handoff_id) on delete cascade not valid;

do $$
declare
  v_orphans bigint;
begin
  select count(*) into v_orphans from public.giving_handoff_ratings r
   where not exists (select 1 from public.post_handoffs h where h.handoff_id = r.handoff_id);
  if v_orphans = 0 then
    alter table public.giving_handoff_ratings validate constraint giving_handoff_ratings_post_handoff_fkey;
    alter table public.giving_handoff_ratings drop constraint if exists giving_handoff_ratings_handoff_id_fkey;
  else
    raise warning 'giving_handoff_ratings: % rating(s) of handoffs without a post_handoffs row; the giving_handoffs key stays until they are resolved', v_orphans;
  end if;

  select count(*) into v_orphans from public.housing_booking_details d
   where not exists (select 1 from public.post_handoffs h where h.handoff_id = d.handoff_id);
  if v_orphans = 0 then
    alter table public.housing_booking_details validate constraint housing_booking_details_post_handoff_fkey;
    alter table public.housing_booking_details drop constraint if exists housing_booking_details_handoff_id_fkey;
  else
    raise warning 'housing_booking_details: % booking(s) without a post_handoffs row; the giving_handoffs key stays until they are resolved', v_orphans;
  end if;
end $$;

-- ── 6. rate_giving_handoff (0510) ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rate_giving_handoff(p_handoff_id uuid, p_rating smallint, p_comment text DEFAULT NULL::text)
 RETURNS giving_handoff_ratings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_h public.post_handoffs%rowtype; -- 0621: the record
  v_rater uuid := auth.uid();
  v_ratee uuid;
  v_row public.giving_handoff_ratings;
begin
  if v_rater is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if p_rating < 1 or p_rating > 5 then raise exception 'invalid_rating' using errcode = '23514'; end if;

  select * into v_h from public.post_handoffs                      -- 0621: the record
   where handoff_id = p_handoff_id and status = 'handed_over'
     and world_slug <> 'time'; -- 0621: event attendance is not a giving handoff (0563 / 0564)
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;

  if v_rater = v_h.owner_id then v_ratee := v_h.recipient_id;
  elsif v_rater = v_h.recipient_id then v_ratee := v_h.owner_id;
  else raise exception 'not_participant' using errcode = '42501';
  end if;

  insert into public.giving_handoff_ratings (handoff_id, rater_id, ratee_id, rating, comment)
  values (p_handoff_id, v_rater, v_ratee, p_rating, nullif(trim(p_comment), ''))
  on conflict (handoff_id, rater_id) do update
    set rating = excluded.rating, comment = excluded.comment
  returning * into v_row;

  -- KC#1306: spec 07 §7.6 "Rating given — 2", once per handoff and rater (editing the rating
  -- or its note does not award again).
  perform public.karma_grant_once(v_rater, 'rating_given', 'giving_handoff_rating', p_handoff_id::text, 2);

  return v_row;
end;
$function$;

revoke all on function public.rate_giving_handoff(uuid, smallint, text) from public;
grant execute on function public.rate_giving_handoff(uuid, smallint, text) to authenticated;

-- ── 7. food_expired_listings_sweep (0555) ─────────────────────────────────────────────────────

create or replace function public.food_expired_listings_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select listing_id, owner_id, title from public.listings
     where world_slug = 'food'
       and status = 'open'
       and expires_at is not null
       and expires_at <= now()
  loop
    -- 0621: the record only; post_handoffs_giving_sync derives the giving_handoffs row.
    update public.post_handoffs
       set status = 'cancelled', cancelled_at = now()
     where post_id = public.post_id_of_listing(r.listing_id) and status in ('reserved', 'confirmed');
    update public.listings
       set status = 'expired', updated_at = now()
     where listing_id = r.listing_id;
    perform public.enqueue_notification(
      r.owner_id, 'critical', 'listing_expired',
      'notifications.foodExpiredTitle', 'notifications.foodExpiredBody',
      jsonb_build_object('listingTitle', coalesce(r.title, '')),
      jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                         'params', jsonb_build_object('listingId', r.listing_id::text)),
      'food_expired:' || r.listing_id::text,
      false
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.food_expired_listings_sweep() from public, anon, authenticated;
grant execute on function public.food_expired_listings_sweep() to service_role;

commit;
