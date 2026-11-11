-- 0658_owner_complete_offer_with_user | FR-CLOSURE-001/003 extension, D125, D73, FR-HOUSING-015.
-- One owner action names who received an open offer: a handoff is created or finished, and a
-- single-recipient world (items, food, animals) closes with that person. Rides confirm one
-- seat (the trip completes only once it has started). Housing confirms one night when the
-- calendar allows, and completes the stay only inside its window. Close-without-recipient
-- stays available for items and animals offers that have no live handoff.
-- Product defaults for the open questions in the 2026-11-07 design: one guest per housing
-- assign (the listing stays open); a new ride assign is confirmed, not waiting on the
-- passenger; animals may still close without a named person.

begin;

-- ── 1. Audit allow-list ────────────────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.audit_events'::regclass
     and c.conname = 'audit_events_action_check';
  if v_def is null then
    raise exception 'audit_events_action_check not found';
  end if;
  if v_def like '%owner_complete_offer_with_user%' then
    return;
  end if;
  -- Keep every existing action. The printed check ends in `]))` plus one more paren.
  v_new := replace(v_def, ']))', ', ''owner_complete_offer_with_user''::text]))');
  if v_new = v_def then
    raise exception 'unexpected audit_events_action_check definition: %', v_def;
  end if;
  alter table public.audit_events drop constraint audit_events_action_check;
  execute format('alter table public.audit_events add constraint audit_events_action_check %s not valid', v_new);
  alter table public.audit_events validate constraint audit_events_action_check;
end $$;

-- ── 2. Animals take one live handoff, like items and food ──────────────────────────────────────
alter table public.giving_handoffs drop constraint if exists giving_handoffs_world_slug_check;
alter table public.giving_handoffs
  add constraint giving_handoffs_world_slug_check
  check (world_slug in ('items', 'food', 'rides', 'knowledge', 'housing', 'animals'));

drop index if exists public.post_handoffs_active_post_uidx;
create unique index post_handoffs_active_post_uidx
  on public.post_handoffs (post_id)
  where status in ('reserved', 'confirmed') and world_slug in ('items', 'food', 'animals');

-- ── 3. Item reserve / confirm also cover animal give offers (adoption, foster) ─────────────────
create or replace function public.reserve_item_giving(
  p_listing_id uuid,
  p_pickup_mode text default 'pickup',
  p_pickup_window_start timestamptz default null,
  p_pickup_window_end timestamptz default null
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_l public.listings%rowtype;
  v_handoff_id uuid;
  v_row public.giving_handoffs;
  v_mode text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;

  select l.* into v_l
    from public.listings l
   where l.listing_id = public.listing_id_of_post(v_post_id)
     and l.direction = 'give'
     and l.status = 'open'
     and public.is_listing_visible_to(l, v_uid)
     and (
       l.world_slug = 'items'
       or (
         l.world_slug = 'animals'
         and exists (
           select 1 from public.listing_kinds k
            where k.kind_id = l.kind_id
              and k.slug in ('adoption_offer', 'foster_offer')
         )
       )
     )
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_l.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
  if exists (
    select 1 from public.post_handoffs h
     where h.post_id = v_post_id
       and h.status in ('reserved', 'confirmed')
       and h.world_slug in ('items', 'food', 'animals')
  ) then
    raise exception 'item_already_reserved' using errcode = '23514';
  end if;

  v_mode := coalesce(nullif(trim(p_pickup_mode), ''), 'pickup');
  if v_mode not in ('pickup', 'delivery') then
    raise exception 'invalid_pickup_mode' using errcode = '23514';
  end if;

  begin
    insert into public.post_handoffs (
      post_id, owner_id, recipient_id, world_slug, status,
      pickup_mode, pickup_window_start, pickup_window_end, confirm_by
    ) values (
      v_post_id, v_l.owner_id, v_uid, v_l.world_slug, 'reserved',
      v_mode,
      coalesce(p_pickup_window_start, (v_l.details->>'pickup_window_start')::timestamptz),
      coalesce(p_pickup_window_end, (v_l.details->>'pickup_window_end')::timestamptz),
      now() + interval '24 hours'
    )
    returning handoff_id into v_handoff_id;
  exception when unique_violation then
    raise exception 'item_already_reserved' using errcode = '23514';
  end;

  update public.listings
     set availability_status = 'scheduled', updated_at = now()
   where listing_id = v_l.listing_id;

  v_row := public.giving_handoff_row_of(v_handoff_id);
  return v_row;
end;
$$;

revoke all on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) to authenticated;

create or replace function public.confirm_item_handoff(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.giving_handoffs;
begin
  update public.post_handoffs
     set status = 'confirmed', confirmed_at = now()
   where handoff_id = p_handoff_id
     and owner_id = auth.uid()
     and status = 'reserved'
     and world_slug in ('items', 'animals');
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

revoke all on function public.confirm_item_handoff(uuid) from public, anon;
grant execute on function public.confirm_item_handoff(uuid) to authenticated;

-- ── 4. Close the offer record the way that world stores it ─────────────────────────────────────
create or replace function public.owner_offer_set_status(
  p_post public.posts,
  p_listing public.listings,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.post_owns_listing(p_post) then
    update public.posts
       set status = p_status,
           delete_after = case when p_status = 'deleted_no_recipient' then now() + interval '7 days' else null end,
           updated_at = now()
     where post_id = p_post.post_id
       and status = 'open';
    return;
  end if;

  update public.listings
     set status = 'closed',
         availability_status = case when p_status = 'closed_delivered' then 'ongoing' else availability_status end,
         updated_at = now()
   where listing_id = p_listing.listing_id
     and status = 'open';

  if p_status = 'deleted_no_recipient' then
    update public.posts
       set status = 'deleted_no_recipient',
           delete_after = now() + interval '7 days',
           updated_at = now()
     where post_id = p_post.post_id;
  end if;
end;
$$;

revoke all on function public.owner_offer_set_status(public.posts, public.listings, text) from public, anon, authenticated;
grant execute on function public.owner_offer_set_status(public.posts, public.listings, text) to service_role;

-- ── 5. Owner assigns a member, or closes an items/animals offer with nobody named ──────────────
create or replace function public.owner_complete_offer_with_user(
  p_target uuid,
  p_recipient_id uuid default null,
  p_mode text default 'assign'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_target);
  v_post public.posts;
  v_listing public.listings;
  v_world text;
  v_kind uuid;
  v_h public.post_handoffs;
  v_ride public.ride_post_details;
  v_departs timestamptz;
  v_in date;
  v_out date;
  v_start timestamptz;
  v_end timestamptz;
  v_max int;
  v_closed boolean;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if p_mode not in ('assign', 'close_without') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  if not public.is_active_member(v_uid) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;

  select * into v_post from public.posts where post_id = v_post_id for update;
  if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;
  if v_post.owner_id <> v_uid then raise exception 'closure_not_owner' using errcode = 'P0001'; end if;
  if v_post.status <> 'open' then raise exception 'closure_wrong_status' using errcode = 'P0001'; end if;

  select * into v_listing from public.listings where listing_id = public.listing_id_of_post(v_post.post_id);
  if not found or v_listing.direction <> 'give' or v_listing.status <> 'open' then
    raise exception 'not_offer' using errcode = '23514';
  end if;

  v_world := coalesce(v_post.world_slug, v_listing.world_slug);
  v_kind := coalesce(v_post.kind_id, v_listing.kind_id);
  if v_world not in ('items', 'food', 'animals', 'rides', 'housing') then
    raise exception 'world_not_assignable' using errcode = '23514';
  end if;
  if v_world = 'animals' and not exists (
    select 1 from public.listing_kinds k
     where k.kind_id = v_kind and k.slug in ('adoption_offer', 'foster_offer')
  ) then
    raise exception 'world_not_assignable' using errcode = '23514';
  end if;
  if v_world = 'food' and coalesce(v_post.expires_at, v_listing.expires_at) <= now() then
    raise exception 'listing_expired' using errcode = '23514';
  end if;
  if v_world in ('animals', 'housing')
     and not public.has_world_permission(v_uid, v_world, 'publish') then
    raise exception 'world_permission_denied' using errcode = '42501';
  end if;

  select (p.param_value #>> '{}')::int into v_max
    from public.marketplace_rule_params p
   where p.rule_code = 'R-SEC-Handoff-Write' and p.param_key = 'max_per_hour';
  perform public.enforce_rate_limit('giving_handoffs:' || v_uid::text, coalesce(v_max, 30), 3600);

  if p_mode = 'close_without' then
    if p_recipient_id is not null or v_world not in ('items', 'animals') then
      raise exception 'close_without_not_allowed' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.post_handoffs h
       where h.post_id = v_post.post_id and h.status in ('reserved', 'confirmed')
    ) then
      raise exception 'listing_has_active_handoff' using errcode = '23514';
    end if;
    perform public.owner_offer_set_status(v_post, v_listing, 'deleted_no_recipient');
  elsif p_recipient_id is null or p_recipient_id = v_uid
     or not exists (select 1 from public.users u where u.user_id = p_recipient_id)
     or public.is_blocked(v_uid, p_recipient_id) then
    raise exception 'closure_recipient_not_in_chat' using errcode = 'P0001';
  elsif v_world = 'rides' then
    select * into v_ride from public.ride_post_details where post_id = v_post.post_id;
    v_departs := v_ride.departs_at;
    select * into v_h from public.post_handoffs
     where post_id = v_post.post_id and recipient_id = p_recipient_id
       and world_slug = 'rides' and status in ('reserved', 'confirmed')
     for update;
    if not found then
      if v_departs is not null and v_departs <= now() then
        raise exception 'ride_departed' using errcode = '23514';
      end if;
      if not public.is_listing_visible_to(v_listing, p_recipient_id) then
        raise exception 'listing_not_available' using errcode = 'P0002';
      end if;
      if public.post_handoff_seats_taken(v_post.post_id) + 1 > coalesce(v_ride.seats_available, 1) then
        raise exception 'seats_exhausted' using errcode = 'P0001';
      end if;
      insert into public.post_handoffs (
        post_id, owner_id, recipient_id, world_slug, status, seats, confirm_by, confirmed_at
      ) values (
        v_post.post_id, v_post.owner_id, p_recipient_id, 'rides', 'confirmed', 1,
        least(now() + interval '12 hours', coalesce(v_departs, now() + interval '12 hours')),
        now()
      ) returning * into v_h;
    elsif v_h.status = 'reserved' then
      update public.post_handoffs
         set status = 'confirmed', confirmed_at = now()
       where handoff_id = v_h.handoff_id
       returning * into v_h;
    end if;
    begin
      perform public.complete_ride_trip(v_h.handoff_id);
    exception
      when sqlstate '23514' then
        if sqlerrm is distinct from 'ride_not_started' then raise; end if;
    end;
  elsif v_world = 'housing' then
    perform public.housing_assert_eligible(v_uid, 'decide');
    perform public.housing_assert_eligible(p_recipient_id, 'book');
    select * into v_h from public.post_handoffs
     where post_id = v_post.post_id and recipient_id = p_recipient_id
       and world_slug = 'housing' and status in ('reserved', 'confirmed')
     for update;
    if not found then
      if not public.is_listing_visible_to(v_listing, p_recipient_id) then
        raise exception 'listing_not_available' using errcode = 'P0002';
      end if;
      v_in := current_date;
      v_out := current_date + 1;
      if public.housing_guest_has_overlap(p_recipient_id, v_in, v_out, null) then
        raise exception 'housing_booking_overlap' using errcode = '23514';
      end if;
      perform public.housing_assert_nights_bookable(v_listing, v_in, v_out, 1, null);
      v_start := public.housing_check_in_at(v_listing.details, v_in);
      v_end := public.housing_check_out_at(v_listing.details, v_out);
      insert into public.post_handoffs (
        post_id, owner_id, recipient_id, world_slug, status, seats,
        slot_starts_at, slot_ends_at, confirmed_at
      ) values (
        v_post.post_id, v_post.owner_id, p_recipient_id, 'housing', 'confirmed', 1,
        v_start, v_end, now()
      ) returning * into v_h;
      insert into public.housing_booking_details (
        handoff_id, check_in_date, check_out_date, adults, minors, message, minors_guardian_ack
      ) values (
        v_h.handoff_id, v_in, v_out, 1, 0, 'Assigned by the host.', false
      );
    elsif v_h.status = 'reserved' then
      update public.post_handoffs
         set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now())
       where handoff_id = v_h.handoff_id
       returning * into v_h;
    end if;
    begin
      perform public.complete_housing_booking(v_h.handoff_id);
    exception
      when sqlstate '23514' then
        if sqlerrm is distinct from 'housing_not_in_window' then raise; end if;
    end;
  else
    if v_world = 'animals' and not public.has_world_permission(p_recipient_id, 'animals', 'publish') then
      raise exception 'world_permission_denied' using errcode = '42501';
    end if;
    select * into v_h from public.post_handoffs
     where post_id = v_post.post_id and recipient_id = p_recipient_id
       and status in ('reserved', 'confirmed', 'handed_over')
     order by case status when 'handed_over' then 0 when 'confirmed' then 1 else 2 end
     limit 1
     for update;
    if not found then
      if not public.is_listing_visible_to(v_listing, p_recipient_id) then
        raise exception 'listing_not_available' using errcode = 'P0002';
      end if;
      update public.post_handoffs
         set status = 'cancelled', cancelled_at = now(), cancel_reason = 'system'
       where post_id = v_post.post_id
         and status in ('reserved', 'confirmed')
         and world_slug in ('items', 'food', 'animals');
      insert into public.post_handoffs (
        post_id, owner_id, recipient_id, world_slug, status, confirmed_at, handed_over_at
      ) values (
        v_post.post_id, v_post.owner_id, p_recipient_id, v_world, 'handed_over', now(), now()
      ) returning * into v_h;
    elsif v_h.status <> 'handed_over' then
      update public.post_handoffs
         set status = 'cancelled', cancelled_at = now(), cancel_reason = 'system'
       where post_id = v_post.post_id
         and status in ('reserved', 'confirmed')
         and handoff_id <> v_h.handoff_id
         and world_slug in ('items', 'food', 'animals');
      update public.post_handoffs
         set status = 'handed_over',
             handed_over_at = coalesce(handed_over_at, now()),
             confirmed_at = coalesce(confirmed_at, now())
       where handoff_id = v_h.handoff_id
       returning * into v_h;
    end if;
    if v_world = 'items' and v_post.listing_id is null then
      perform public.post_close_from_handoff(v_h);
    else
      perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, v_h.handoff_id);
      perform public.owner_offer_set_status(v_post, v_listing, 'closed_delivered');
    end if;
  end if;

  select p.status is distinct from 'open' into v_closed
    from public.posts p where p.post_id = v_post.post_id;
  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    v_uid, 'owner_complete_offer_with_user', 'post', v_post.post_id,
    jsonb_build_object(
      'recipient_id', p_recipient_id, 'world_slug', v_world, 'mode', p_mode, 'closed', v_closed
    )
  );
  return jsonb_build_object('closed', coalesce(v_closed, false));
end;
$$;

comment on function public.owner_complete_offer_with_user(uuid, uuid, text) is
  'Owner names who received an open offer (or closes an items/animals offer with nobody named). Single-recipient worlds close; a ride confirms one seat; a stay confirms one night.';

revoke all on function public.owner_complete_offer_with_user(uuid, uuid, text) from public, anon;
grant execute on function public.owner_complete_offer_with_user(uuid, uuid, text) to authenticated;

-- ── 6. My listings carries the post id the closure sheet closes ───────────────────────────────
drop function if exists public.list_my_listings(int, int, timestamptz, uuid);

create or replace function public.list_my_listings(
  p_limit int default 50,
  p_offset int default 0,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  listing_id uuid,
  world_slug text,
  kind_slug text,
  direction text,
  status text,
  title text,
  summary text,
  urgency_level smallint,
  availability_status text,
  updated_at timestamptz,
  feed_post_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.listing_id,
    case when p.post_id is null then l.world_slug else p.world_slug end,
    lk.slug,
    case when p.post_id is null then l.direction
         when p.direction = 'request' then 'request' else 'give' end,
    s.status,
    l.title,
    l.summary,
    case when p.post_id is null then l.urgency_level else p.urgency_level end,
    case when p.post_id is null then l.availability_status else p.availability_status end,
    l.updated_at,
    coalesce(
      p.post_id,
      l.legacy_post_id,
      (select mp.post_id from public.posts mp
        where mp.listing_id = l.listing_id
        order by mp.created_at
        limit 1)
    )
  from public.listings l
  left join public.posts p on p.post_id = l.legacy_post_id and l.origin = 'native'
  cross join lateral (select case when p.post_id is null or p.moderation_status <> 'published'
                                  then l.status
                                  else public.listing_status_for_post(p.status) end as status) s
  join public.listing_kinds lk on lk.kind_id = coalesce(p.kind_id, l.kind_id)
  where l.owner_id = auth.uid()
    and s.status <> 'removed_admin'
    and (
      p_cursor_id is null
      or (l.updated_at, l.listing_id) < (p_cursor_updated_at, p_cursor_id)
    )
  order by l.updated_at desc, l.listing_id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset case when p_cursor_id is null then greatest(coalesce(p_offset, 0), 0) else 0 end;
$$;

revoke all on function public.list_my_listings(int, int, timestamptz, uuid) from public;
grant execute on function public.list_my_listings(int, int, timestamptz, uuid) to authenticated;

commit;
