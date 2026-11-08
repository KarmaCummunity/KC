-- 0666_g1_drop_sync_triggers | G1 step 6c (ADR-006, D-214, issue #1671):
-- 1. Drops the 7 sync triggers and their trigger functions between posts/listings and post_handoffs/giving_handoffs.
-- 2. Adds posts_sync_post_details trigger on public.posts to keep 1:1 post extensions (ride_post_details, event_post_details) current.
-- 3. Updates post_record_set_status, post_lock_own_listing, and owner RPCs to write directly to public.posts.
-- 4. Updates booking / reservation / claim RPCs (reserve_item_giving, claim_food_giving, book_ride_seat, book_knowledge_slot, request_housing_booking, decide_housing_booking, complete_ride_trip, cancel_giving_handoff) to query and update public.posts and post_handoffs directly.
-- 5. Updates sweeps (giving_handoff_no_show_sweep, food_expired_listings_sweep) to operate on public.posts and post_handoffs directly.
-- 6. Updates create_marketplace_listing to write directly to public.posts.

begin;

-- ── 1. Drop the 7 sync triggers ────────────────────────────────────────────────────────────────
drop trigger if exists posts_sync_listing on public.posts;
drop trigger if exists listings_feed_mirror_sync on public.listings;
drop trigger if exists listing_media_feed_mirror_sync on public.listing_media;
drop trigger if exists post_handoffs_giving_sync on public.post_handoffs;
drop trigger if exists giving_handoffs_post_handoffs_sync on public.giving_handoffs;
drop trigger if exists ride_listings_sync_listing on public.ride_listings;
drop trigger if exists listings_sync_event_post_details on public.listings;

-- Drop obsolete sync trigger functions
drop function if exists public.trg_posts_sync_listing() cascade;
drop function if exists public.listings_feed_mirror_sync() cascade;
drop function if exists public.listing_media_feed_mirror_sync() cascade;
drop function if exists public.post_handoffs_giving_sync() cascade;
drop function if exists public.giving_handoffs_post_handoffs_sync() cascade;
drop function if exists public.trg_ride_listings_sync_listing() cascade;
drop function if exists public.listings_sync_event_post_details() cascade;

-- ── 2. Keep 1:1 post extensions in sync directly from public.posts ──────────────────────────────
create or replace function public.posts_sync_post_details()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1. Ride details extension
  if new.post_type = 'ride' or new.world_slug = 'rides' then
    perform public.ride_post_details_upsert(new.post_id, new.details);
  end if;

  -- 2. Event details extension
  if public.is_event_kind(new.kind_id) then
    insert into public.event_post_details as e (
      post_id, org_id, starts_at, ends_at, capacity, registration_policy, address
    ) values (
      new.post_id, (new.details ->> 'org_id')::uuid, (new.details ->> 'starts_at')::timestamptz,
      (new.details ->> 'ends_at')::timestamptz, (new.details ->> 'capacity')::integer,
      new.details ->> 'registration_policy', nullif(trim(coalesce(new.details ->> 'address', '')), '')
    )
    on conflict (post_id) do update
      set org_id = excluded.org_id,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          capacity = excluded.capacity,
          registration_policy = excluded.registration_policy,
          address = excluded.address
    where (e.org_id, e.starts_at, e.ends_at, e.capacity, e.registration_policy, e.address)
          is distinct from
          (excluded.org_id, excluded.starts_at, excluded.ends_at, excluded.capacity,
           excluded.registration_policy, excluded.address);
  end if;

  return new;
end;
$$;

comment on function public.posts_sync_post_details() is
  'G1 step 6c (0666): keeps ride_post_details and event_post_details populated directly from public.posts without listings triggers.';

revoke all on function public.posts_sync_post_details() from public, anon, authenticated;
grant execute on function public.posts_sync_post_details() to service_role;

drop trigger if exists posts_sync_post_details on public.posts;
create trigger posts_sync_post_details
  after insert or update of details, kind_id, world_slug, post_type on public.posts
  for each row execute function public.posts_sync_post_details();

-- World rules enforcement on public.posts (mirrors listings_enforce_world_rules)
create or replace function public.posts_enforce_world_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_rides numeric;
  v_cost numeric;
  v_active_money int;
  v_min_age int := 18;
  v_birth date;
begin
  if exists (
    select 1 from public.users u
     where u.user_id = new.owner_id and u.food_posting_banned_until > now()
  ) and new.world_slug = 'food' then
    raise exception 'food_posting_banned' using errcode = '42501';
  end if;

  -- D28: food offer carries the giver's expiry. D21: food request has none.
  if new.world_slug = 'food' and (new.direction in ('give', 'offer') or new.type = 'Give') then
    new.expires_at := coalesce(new.expires_at, nullif(new.details->>'expires_at', '')::timestamptz);
    if new.expires_at is null then
      raise exception 'food_expiry_required' using errcode = '23514';
    end if;
    if new.expires_at <= now() then
      new.status := 'expired';
    end if;
  end if;

  if new.world_slug = 'items' then
    if tg_op = 'INSERT' and new.expires_at is null then
      new.expires_at := now() + interval '30 days';
    end if;
  end if;

  if new.world_slug = 'rides' then
    if to_regproc('ride_details_with_place') is not null then
      new.details := public.ride_details_with_place(coalesce(new.details, '{}'::jsonb), 'origin');
      new.details := public.ride_details_with_place(new.details, 'dest');
    end if;

    begin
      declare
        v_departs timestamptz := nullif(new.details->>'departs_at', '')::timestamptz;
        v_arrives timestamptz := nullif(new.details->>'arrives_at', '')::timestamptz;
      begin
        if (new.direction in ('give', 'offer') or new.type = 'Give') and coalesce(v_arrives, v_departs) is not null then
          if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.details is distinct from old.details) then
            new.expires_at := coalesce(v_arrives, v_departs) + interval '30 minutes';
          end if;
        end if;
      end;
    exception when others then
      null;
    end;

    v_cost := nullif(new.details->>'cost_share_ils', '')::numeric;
    if v_cost is not null then
      select (param_value #>> '{}')::numeric into v_max_rides
        from public.marketplace_rule_params
       where rule_code = case when new.direction in ('give', 'offer') or new.type = 'Give' then 'R-Rides-1' else 'R-Rides-2' end
         and param_key = 'max_cost_share_ils';
      if v_max_rides is not null and v_cost > v_max_rides then
        raise exception 'ride_cost_share_cap_exceeded' using errcode = '23514';
      end if;
    end if;
  end if;

  if new.world_slug in ('medical','environment') and new.external_body_id is null then
    raise exception 'routed_world_requires_external_body' using errcode = '23514';
  end if;

  if new.world_slug = 'knowledge' and tg_op = 'INSERT' then
    new.moderation_status := 'pending_review';
  end if;

  if new.world_slug = 'money' and new.status = 'open' then
    select count(*) into v_active_money
      from public.posts p
     where p.owner_id = new.owner_id
       and p.world_slug = 'money'
       and p.status = 'open'
       and p.post_id is distinct from new.post_id;
    if v_active_money >= 5 then
      raise exception 'money_active_campaign_cap' using errcode = '23514';
    end if;
  end if;

  if public.is_event_kind(new.kind_id) then
    if (new.details ->> 'ends_at')::timestamptz <= (new.details ->> 'starts_at')::timestamptz then
      raise exception 'event_window_invalid' using errcode = '23514';
    end if;
  end if;

  if new.world_slug = 'romantic_matchmaking' then
    v_birth := nullif(new.details->>'birth_date', '')::date;
    if v_birth is not null and age(v_birth) < (v_min_age || ' years')::interval then
      raise exception 'matchmaking_min_age' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.posts_enforce_world_rules() from public, anon, authenticated;
grant execute on function public.posts_enforce_world_rules() to service_role;

drop trigger if exists posts_before_write_world_rules on public.posts;
create trigger posts_before_write_world_rules
  before insert or update of details, expires_at, status, owner_id, external_body_id, kind_id on public.posts
  for each row execute function public.posts_enforce_world_rules();

-- ── 3. giving_handoff_row_of: fallback listing_id to post_id ───────────────────────────────────
create or replace function public.giving_handoff_row_of(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug <> 'time';
  if not found then
    return null;
  end if;
  v_row.handoff_id          := v_h.handoff_id;
  v_row.listing_id          := coalesce(public.listing_id_of_post(v_h.post_id), v_h.post_id);
  v_row.owner_id            := v_h.owner_id;
  v_row.recipient_id        := v_h.recipient_id;
  v_row.world_slug          := v_h.world_slug;
  v_row.status              := v_h.status;
  v_row.cancel_reason       := v_h.cancel_reason;
  v_row.pickup_mode         := v_h.pickup_mode;
  v_row.pickup_window_start := v_h.pickup_window_start;
  v_row.pickup_window_end   := v_h.pickup_window_end;
  v_row.slot_starts_at      := v_h.slot_starts_at;
  v_row.slot_ends_at        := v_h.slot_ends_at;
  v_row.seats               := v_h.seats;
  v_row.confirm_by          := v_h.confirm_by;
  v_row.reserved_at         := v_h.reserved_at;
  v_row.confirmed_at        := v_h.confirmed_at;
  v_row.handed_over_at      := v_h.handed_over_at;
  v_row.cancelled_at        := v_h.cancelled_at;
  v_row.no_show_at          := v_h.no_show_at;
  return v_row;
end;
$$;

revoke all on function public.giving_handoff_row_of(uuid) from public, anon, authenticated;
grant execute on function public.giving_handoff_row_of(uuid) to service_role;

-- ── 3b. is_listing_visible_to: early status/moderation checks when sync triggers are dropped ───────
create or replace function public.is_listing_visible_to(p_listing public.listings, p_viewer uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_post public.posts;
  v_ride public.ride_listings;
begin
  if p_listing.owner_id = p_viewer then
    return true;
  end if;

  if public.is_account_pending_deletion(p_listing.owner_id) then
    return false;
  end if;

  if p_listing.moderation_status <> 'published' then
    return false;
  end if;

  if p_listing.status not in ('open', 'closed') then
    return false;
  end if;

  if exists (
    select 1 from public.reporter_hides h
     where h.reporter_id = p_viewer
       and h.target_type = 'listing'
       and h.target_id   = p_listing.listing_id
  ) then
    return false;
  end if;

  if p_listing.legacy_post_id is not null then
    select * into v_post from public.posts where post_id = p_listing.legacy_post_id;
    if not found then
      return false;
    end if;
    return public.is_post_visible_to(v_post, p_viewer);
  end if;

  if p_listing.legacy_ride_id is not null then
    select * into v_ride from public.ride_listings where ride_id = p_listing.legacy_ride_id;
    if not found then
      return false;
    end if;
    if v_ride.owner_id = p_viewer then
      return true;
    end if;
    if public.is_blocked(p_viewer, v_ride.owner_id) then
      return false;
    end if;
    if v_ride.status <> 'open' then
      return false;
    end if;
    return v_ride.visibility = 'Public'
      or (v_ride.visibility = 'FollowersOnly' and public.is_following(p_viewer, v_ride.owner_id));
  end if;

  select * into v_post from public.posts where listing_id = p_listing.listing_id;
  if found then
    return public.post_listing_visible_to(v_post, p_viewer);
  end if;

  if public.is_blocked(p_viewer, p_listing.owner_id) then
    return false;
  end if;

  case p_listing.anonymity_level
    when 3 then
      return p_listing.status = 'open'
        or (p_listing.status = 'closed' and p_listing.owner_id = p_viewer);
    when 2 then
      return p_listing.status = 'open'
        and public.is_following(p_viewer, p_listing.owner_id);
    when 1 then
      return public.is_listing_operator(p_viewer);
    else
      return false;
  end case;
end;
$$;

revoke all on function public.is_listing_visible_to(public.listings, uuid) from public;
grant execute on function public.is_listing_visible_to(public.listings, uuid) to anon, authenticated, service_role;

-- ── 4. post_lock_own_listing & post_record_set_status ──────────────────────────────────────────
create or replace function public.post_lock_own_listing(p_target uuid)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id uuid := coalesce(public.handoff_target_post_id(p_target), p_target);
  v_post public.posts;
begin
  if auth.uid() is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  select * into v_post
    from public.posts
   where post_id = v_post_id
     and owner_id = auth.uid()
   for update;
  if found then
    return v_post;
  end if;
  if exists (select 1 from public.listings l where l.listing_id = p_target and l.owner_id = auth.uid()) then
    return null;
  end if;
  raise exception 'listing_not_found' using errcode = 'P0002';
end;
$$;

revoke all on function public.post_lock_own_listing(uuid) from public, anon, authenticated;
grant execute on function public.post_lock_own_listing(uuid) to service_role;

create or replace function public.post_record_set_status(p_post public.posts, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lid uuid := coalesce(p_post.listing_id, p_post.legacy_listing_id, public.listing_id_of_post(p_post.post_id));
begin
  update public.posts set status = p_status, updated_at = now()
   where post_id = p_post.post_id and status is distinct from p_status;

  if v_lid is not null then
    update public.listings set status = public.listing_status_for_post(p_status), updated_at = now()
     where listing_id = v_lid and status is distinct from public.listing_status_for_post(p_status);
  end if;
end;
$$;

revoke all on function public.post_record_set_status(public.posts, text) from public, anon, authenticated;
grant execute on function public.post_record_set_status(public.posts, text) to service_role;

-- Chat closure notifications: allow closed_delivered without an explicit recipient (e.g. fulfill_my_listing)
create or replace function public.posts_emit_closure_system_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient   uuid;
  v_chat        record;
  v_other       uuid;
  v_is_recipient_chat boolean;
  v_body        text;
  v_payload     jsonb;
begin
  if not (
    old.status = 'open'
    and new.status in ('closed_delivered', 'deleted_no_recipient')
  ) then
    return new;
  end if;

  if new.status = 'closed_delivered' then
    select recipient_user_id into v_recipient
    from public.recipients
    where post_id = new.post_id;
  else
    v_recipient := null;
  end if;

  for v_chat in
    select chat_id, participant_a, participant_b
    from public.chats
    where anchor_post_id = new.post_id
  loop
    if v_chat.participant_a <> new.owner_id and v_chat.participant_b <> new.owner_id then
      continue;
    end if;

    v_other := case
      when v_chat.participant_a = new.owner_id then v_chat.participant_b
      else v_chat.participant_a
    end;

    v_is_recipient_chat := (v_recipient is not null and v_other = v_recipient);

    if new.status = 'closed_delivered' then
      if v_is_recipient_chat then
        v_body := 'הפוסט סומן כנמסר ✓ · תודה!';
      else
        v_body := 'הפוסט נמסר למשתמש אחר';
      end if;
    else
      v_body := 'המפרסם סגר את הפוסט — הפריט לא נמסר';
    end if;

    v_payload := jsonb_build_object(
      'kind',              'post_closed',
      'post_id',           new.post_id,
      'status',            new.status,
      'recipient_user_id', case when v_is_recipient_chat then v_recipient else null end
    );

    insert into public.messages (
      chat_id, sender_id, kind, body, system_payload, status, delivered_at
    ) values (
      v_chat.chat_id, null, 'system', v_body, v_payload, 'delivered', now()
    );
  end loop;

  return new;
end;
$$;

-- ── 5. Owner lifecycle RPCs ────────────────────────────────────────────────────────────────────
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

create or replace function public.resume_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts := public.post_lock_own_listing(p_listing_id);
  v_status text;
  v_exp timestamptz;
begin
  if v_post.post_id is not null then
    if v_post.status <> 'paused' then
      raise exception 'listing_wrong_status' using errcode = '23514';
    end if;
    if v_post.expires_at is not null and v_post.expires_at <= now() then
      raise exception 'listing_expired' using errcode = '23514';
    end if;
    perform public.post_record_set_status(v_post, 'open');
    return;
  end if;

  select status, expires_at into v_status, v_exp from public.listings where listing_id = p_listing_id and owner_id = auth.uid() for update;
  if v_status <> 'cancelled' then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if v_exp is not null and v_exp <= now() then
    raise exception 'listing_expired' using errcode = '23514';
  end if;
  update public.listings set status = 'open', updated_at = now() where listing_id = p_listing_id;
end;
$$;

create or replace function public.fulfill_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts := public.post_lock_own_listing(p_listing_id);
  v_status text;
  v_lid uuid;
begin
  if v_post.post_id is not null then
    if v_post.status <> 'open' then
      raise exception 'listing_wrong_status' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.post_handoffs h
       where h.post_id = v_post.post_id and h.status in ('reserved', 'confirmed')
    ) then
      raise exception 'listing_has_active_handoff' using errcode = '23514';
    end if;
    perform public.post_record_set_status(v_post, 'closed_delivered');
    v_lid := coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post.post_id), p_listing_id);
    perform public.karma_grant_once(v_post.owner_id, 'listing_fulfilled', 'listing', v_lid::text, 4);
    return;
  end if;

  select status into v_status from public.listings where listing_id = p_listing_id and owner_id = auth.uid() for update;
  if v_status <> 'open' then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(p_listing_id) then
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  update public.listings set status = 'closed', updated_at = now() where listing_id = p_listing_id;
  perform public.karma_grant_once(auth.uid(), 'listing_fulfilled', 'listing', p_listing_id::text, 4);
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
       where h.post_id = v_post.post_id and h.status in ('reserved', 'confirmed')
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

create or replace function public.update_my_listing(
  p_listing_id uuid,
  p_title text default null,
  p_summary text default null,
  p_details jsonb default null,
  p_city_id text default null,
  p_max_radius_km numeric default null,
  p_urgency_level smallint default null,
  p_availability_status text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post public.posts;
  v_row public.listings;
  v_lid uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  v_post := public.post_lock_own_listing(p_listing_id);

  if v_post.post_id is not null then
    if v_post.status not in ('open', 'paused') then
      raise exception 'listing_not_editable' using errcode = '23514';
    end if;
    if p_details is not null
       and not public.validate_listing_details(v_post.kind_id, p_details) then
      raise exception 'details_schema_mismatch' using errcode = '23514';
    end if;
    if p_title is not null and char_length(trim(p_title)) > 80 then
      raise exception 'title_too_long' using errcode = '23514';
    end if;

    update public.posts set
      title                  = coalesce(nullif(trim(p_title), ''), title),
      description            = case when p_summary is null then description else nullif(trim(p_summary), '') end,
      details                = coalesce(p_details, details),
      city                   = coalesce(p_city_id, city),
      urgency_level          = coalesce(p_urgency_level, urgency_level),
      availability_status    = coalesce(p_availability_status, availability_status),
      max_radius_km_override = coalesce(p_max_radius_km, max_radius_km_override),
      geo                    = case when p_city_id is not null then public.listing_geo_from_city(p_city_id) else geo end,
      updated_at             = now()
    where post_id = v_post.post_id;

    v_lid := coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post.post_id));
    if v_lid is not null then
      update public.listings set
        title                  = coalesce(nullif(trim(p_title), ''), title),
        summary                = case when p_summary is null then summary else nullif(trim(p_summary), '') end,
        details                = coalesce(p_details, details),
        city_id                = coalesce(p_city_id, city_id),
        urgency_level          = coalesce(p_urgency_level, urgency_level),
        availability_status    = coalesce(p_availability_status, availability_status),
        max_radius_km_override = coalesce(p_max_radius_km, max_radius_km_override),
        geo                    = case when p_city_id is not null then public.listing_geo_from_city(p_city_id) else geo end,
        updated_at             = now()
      where listing_id = v_lid;
    end if;
    return;
  end if;

  select * into v_row from public.listings where listing_id = p_listing_id and owner_id = v_uid for update;
  if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;
  if v_row.status not in ('open', 'cancelled') then
    raise exception 'listing_not_editable' using errcode = '23514';
  end if;
  if p_details is not null
     and not public.validate_listing_details(v_row.kind_id, p_details) then
    raise exception 'details_schema_mismatch' using errcode = '23514';
  end if;

  update public.listings set
    title = coalesce(nullif(trim(p_title), ''), title),
    summary = case when p_summary is null then summary else nullif(trim(p_summary), '') end,
    details = coalesce(p_details, details),
    city_id = coalesce(p_city_id, city_id),
    max_radius_km_override = coalesce(p_max_radius_km, max_radius_km_override),
    urgency_level = coalesce(p_urgency_level, urgency_level),
    availability_status = coalesce(p_availability_status, availability_status),
    geo = case when p_city_id is not null then public.listing_geo_from_city(p_city_id) else geo end,
    updated_at = now()
  where listing_id = v_row.listing_id;
end;
$$;

-- ── 6. Writer RPCs on public.posts ─────────────────────────────────────────────────────────────
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
  v_post public.posts;
  v_handoff_id uuid;
  v_row public.giving_handoffs;
  v_mode text;
  v_lid uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;

  select p.* into v_post
    from public.posts p
   where p.post_id = v_post_id
     and p.direction = 'offer'
     and p.status = 'open'
     and (
       p.world_slug = 'items'
       or (
         p.world_slug = 'animals'
         and exists (
           select 1 from public.listing_kinds k
            where k.kind_id = p.kind_id
              and k.slug in ('adoption_offer', 'foster_offer')
         )
       )
     )
   for update;
  if not found or not public.is_post_visible_to(v_post, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_post.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
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
      v_post_id, v_post.owner_id, v_uid, v_post.world_slug, 'reserved',
      v_mode,
      coalesce(p_pickup_window_start, (v_post.details->>'pickup_window_start')::timestamptz),
      coalesce(p_pickup_window_end, (v_post.details->>'pickup_window_end')::timestamptz),
      now() + interval '24 hours'
    )
    returning handoff_id into v_handoff_id;
  exception when unique_violation then
    raise exception 'item_already_reserved' using errcode = '23514';
  end;

  update public.posts
     set availability_status = 'scheduled', updated_at = now()
   where post_id = v_post_id;

  v_lid := coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post_id));
  if v_lid is not null then
    update public.listings
       set availability_status = 'scheduled', updated_at = now()
     where listing_id = v_lid;
  end if;

  v_row := public.giving_handoff_row_of(v_handoff_id);
  return v_row;
end;
$$;

revoke all on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) to authenticated;

create or replace function public.claim_food_giving(
  p_listing_id uuid,
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
  v_post public.posts;
  v_handoff_id uuid;
  v_row public.giving_handoffs;
  v_start timestamptz;
  v_end timestamptz;
  v_lid uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_post from public.posts
   where post_id = v_post_id
     and world_slug = 'food'
     and direction = 'offer'
     and status = 'open'
     and (expires_at is null or expires_at > now())
   for update;
  if not found or not public.is_post_visible_to(v_post, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_post.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;

  v_start := coalesce(p_pickup_window_start, (v_post.details->>'pickup_window_start')::timestamptz, now());
  v_end := coalesce(
    p_pickup_window_end,
    (v_post.details->>'pickup_window_end')::timestamptz,
    coalesce(v_post.expires_at, now() + interval '4 hours')
  );

  begin
    insert into public.post_handoffs (
      post_id, owner_id, recipient_id, world_slug, status,
      pickup_mode, pickup_window_start, pickup_window_end, confirmed_at
    ) values (
      v_post_id, v_post.owner_id, v_uid, 'food', 'confirmed',
      'pickup', v_start, v_end, now()
    )
    returning handoff_id into v_handoff_id;
  exception when unique_violation then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end;

  update public.posts
     set availability_status = 'scheduled',
         urgency_level = public.food_listing_urgency_level(v_post.expires_at),
         updated_at = now()
   where post_id = v_post_id;

  v_lid := coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post_id));
  if v_lid is not null then
    update public.listings
       set availability_status = 'scheduled',
           urgency_level = public.food_listing_urgency_level(v_post.expires_at),
           updated_at = now()
     where listing_id = v_lid;
  end if;

  v_row := public.giving_handoff_row_of(v_handoff_id);
  return v_row;
end;
$$;

revoke all on function public.claim_food_giving(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.claim_food_giving(uuid, timestamptz, timestamptz) to authenticated;

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
  if not found or not public.is_post_visible_to(v_post, v_uid) then
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

create or replace function public.book_knowledge_slot(p_listing_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_post public.posts;
  v_cap int;
  v_taken int;
  v_handoff_id uuid;
  v_row public.giving_handoffs;
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_post from public.posts
   where post_id = v_post_id and world_slug = 'knowledge' and status = 'open'
   for update;
  if not found or not public.is_post_visible_to(v_post, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_post.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
  if v_post.direction <> 'offer' then raise exception 'not_offer' using errcode = '23514'; end if;
  v_start := nullif(v_post.details->>'slot_starts_at', '')::timestamptz;
  v_end := nullif(v_post.details->>'slot_ends_at', '')::timestamptz;
  if v_start is not null and v_start <= now() then
    raise exception 'slot_started' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.post_handoffs
     where post_id = v_post_id and recipient_id = v_uid
       and status in ('reserved', 'confirmed')
  ) then
    raise exception 'already_booked' using errcode = '23505';
  end if;
  v_cap := coalesce((v_post.details->>'slots_available')::int, 1);
  select count(*)::int into v_taken
    from public.post_handoffs
   where post_id = v_post_id and world_slug = 'knowledge'
     and status in ('reserved', 'confirmed', 'handed_over');
  if v_taken >= v_cap then raise exception 'slots_exhausted' using errcode = 'P0001'; end if;
  insert into public.post_handoffs (
    post_id, owner_id, recipient_id, world_slug, status,
    seats, slot_starts_at, slot_ends_at, confirm_by
  ) values (
    v_post_id, v_post.owner_id, v_uid, 'knowledge', 'reserved',
    1, v_start, v_end, now() + interval '24 hours'
  )
  returning handoff_id into v_handoff_id;
  v_row := public.giving_handoff_row_of(v_handoff_id);
  return v_row;
end;
$$;

revoke all on function public.book_knowledge_slot(uuid) from public, anon;
grant execute on function public.book_knowledge_slot(uuid) to authenticated;

create or replace function public.complete_ride_trip(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_post public.posts;
  v_ride public.ride_post_details;
  v_departs timestamptz;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid and v_h.recipient_id <> v_uid then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_h.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;

  select * into v_post from public.posts
   where post_id = v_h.post_id for update;
  select * into v_ride from public.ride_post_details
   where post_id = v_h.post_id;

  v_departs := coalesce(v_ride.departs_at, nullif(v_post.details->>'departs_at', '')::timestamptz);
  if v_departs is not null and v_departs > now() + interval '1 hour' then
    raise exception 'ride_not_started' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'handed_over', handed_over_at = now(),
         confirmed_at = coalesce(confirmed_at, now())
   where handoff_id = p_handoff_id;

  if v_post.status = 'open'
     and not exists (
       select 1 from public.post_handoffs h
        where h.post_id = v_h.post_id and h.status in ('reserved', 'confirmed'))
     and (
       select coalesce(sum(h.seats), 0) from public.post_handoffs h
        where h.post_id = v_h.post_id and h.status = 'handed_over'
     ) >= coalesce(v_ride.seats_available, (v_post.details->>'seats_available')::int, 1)
  then
    perform public.post_record_set_status(v_post, 'closed_delivered');
  end if;
  perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, p_handoff_id);
  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

revoke all on function public.complete_ride_trip(uuid) from public, anon;
grant execute on function public.complete_ride_trip(uuid) to authenticated;

create or replace function public.cancel_giving_handoff(p_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_h public.post_handoffs;
  v_lid uuid;
begin
  if exists (select 1 from public.post_handoffs
              where handoff_id = p_handoff_id and world_slug = 'housing') then
    raise exception 'housing_use_booking_cancel' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now()
   where handoff_id = p_handoff_id
     and status in ('reserved', 'confirmed')
     and (owner_id = auth.uid() or recipient_id = auth.uid())
  returning * into v_h;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;

  if v_h.world_slug in ('items', 'food') then
    update public.posts
       set availability_status = 'immediate', updated_at = now()
     where post_id = v_h.post_id and status = 'open';
    v_lid := public.listing_id_of_post(v_h.post_id);
    if v_lid is not null then
      update public.listings
         set availability_status = 'immediate', updated_at = now()
       where listing_id = v_lid and status = 'open';
    end if;
  end if;
end;
$$;

revoke all on function public.cancel_giving_handoff(uuid) from public, anon;
grant execute on function public.cancel_giving_handoff(uuid) to authenticated;

-- ── 7. Housing booking helpers & decide ────────────────────────────────────────────────────────
create or replace function public.housing_guests_on_night(p_listing_id uuid, p_night date, p_exclude uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(h.seats), 0)::int
    from public.post_handoffs h
    join public.housing_booking_details d on d.handoff_id = h.handoff_id
   where (h.post_id = p_listing_id or h.post_id = public.handoff_target_post_id(p_listing_id))
     and h.world_slug = 'housing'
     and h.status in ('confirmed', 'handed_over')
     and h.handoff_id is distinct from p_exclude
     and p_night >= d.check_in_date and p_night < d.check_out_date;
$$;

create or replace function public.housing_guest_has_overlap(p_guest uuid, p_in date, p_out date, p_exclude uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.post_handoffs h
      join public.housing_booking_details d on d.handoff_id = h.handoff_id
     where h.recipient_id = p_guest
       and h.world_slug = 'housing'
       and h.status in ('confirmed', 'handed_over')
       and h.handoff_id is distinct from p_exclude
       and d.check_in_date < p_out and d.check_out_date > p_in
  );
$$;

create or replace function public.housing_assert_nights_bookable(
  p_details jsonb, p_id uuid, p_in date, p_out date, p_party int, p_exclude uuid
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
  v_capacity int := (p_details->>'capacity')::int;
  v_exclusive boolean := coalesce((p_details->>'exclusive')::boolean, false);
begin
  for v_night in select generate_series(p_in, p_out - 1, interval '1 day')::date loop
    if not public.housing_night_open(p_details, v_night) then
      raise exception 'housing_dates_unavailable' using errcode = '23514';
    end if;
    v_taken := public.housing_guests_on_night(p_id, v_night, p_exclude);
    if (v_exclusive and v_taken > 0) or v_taken + p_party > v_capacity then
      raise exception 'housing_capacity_exceeded' using errcode = '23514';
    end if;
  end loop;
end;
$$;

create or replace function public.housing_assert_nights_bookable(
  p_listing public.listings, p_in date, p_out date, p_party int, p_exclude uuid
)
returns void
language sql
stable
security definer
set search_path = public
as $$
  select public.housing_assert_nights_bookable(p_listing.details, p_listing.listing_id, p_in, p_out, p_party, p_exclude);
$$;

create or replace function public.housing_assert_nights_bookable(
  p_post public.posts, p_in date, p_out date, p_party int, p_exclude uuid
)
returns void
language sql
stable
security definer
set search_path = public
as $$
  select public.housing_assert_nights_bookable(p_post.details, p_post.post_id, p_in, p_out, p_party, p_exclude);
$$;

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
  v_post public.posts;
  v_nights int := p_check_out - p_check_in;
  v_party int := coalesce(p_adults, 0) + coalesce(p_minors, 0);
  v_start timestamptz;
  v_handoff_id uuid;
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  perform public.housing_assert_eligible(v_uid, 'book');

  select p.* into v_post
    from public.posts p
    join public.listing_kinds k on k.kind_id = p.kind_id
   where p.post_id = v_post_id and p.world_slug = 'housing' and p.status = 'open'
     and k.slug = 'host_offer'
   for update of p;
  if not found or not public.is_post_visible_to(v_post, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_post.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;

  if p_check_in is null or p_check_out is null
     or p_check_in < public.housing_today() or p_check_in > public.housing_today() + 180 then
    raise exception 'housing_dates_invalid' using errcode = '23514';
  end if;
  if v_nights < (v_post.details->>'min_nights')::int or v_nights > (v_post.details->>'max_nights')::int then
    raise exception 'housing_nights_out_of_range' using errcode = '23514';
  end if;
  if now() > public.housing_check_in_deadline(v_post.details, p_check_in) then
    raise exception 'housing_dates_invalid' using errcode = '23514';
  end if;

  if coalesce(p_adults, 0) < 1 or coalesce(p_minors, 0) < 0 or v_party > 8 then
    raise exception 'housing_capacity_exceeded' using errcode = '23514';
  end if;
  if p_minors > 0 and not (v_post.details->>'children_ok')::boolean then
    raise exception 'housing_policy_mismatch' using errcode = '23514';
  end if;
  if p_minors > 0 and not coalesce(p_minors_guardian_ack, false) then
    raise exception 'housing_minor_unaccompanied' using errcode = '23514';
  end if;
  if p_message is null or char_length(btrim(p_message)) not between 1 and 500 then
    raise exception 'housing_message_required' using errcode = '23514';
  end if;

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
  perform public.housing_assert_nights_bookable(v_post, p_check_in, p_check_out, v_party, null);

  v_start := public.housing_check_in_at(v_post.details, p_check_in);
  insert into public.post_handoffs (
    post_id, owner_id, recipient_id, world_slug, status, seats,
    slot_starts_at, slot_ends_at, confirm_by
  ) values (
    v_post_id, v_post.owner_id, v_uid, 'housing', 'reserved', v_party,
    v_start, public.housing_check_out_at(v_post.details, p_check_out),
    least(now() + interval '24 hours', public.housing_check_in_deadline(v_post.details, p_check_in))
  )
  returning handoff_id into v_handoff_id;

  insert into public.housing_booking_details (
    handoff_id, check_in_date, check_out_date, adults, minors, message, minors_guardian_ack
  ) values (
    v_handoff_id, p_check_in, p_check_out, p_adults, p_minors, btrim(p_message),
    coalesce(p_minors_guardian_ack, false)
  );

  v_row := public.giving_handoff_row_of(v_handoff_id);
  select * into v_h from public.post_handoffs where handoff_id = v_handoff_id;
  perform public.housing_booking_enqueue(v_h, 'housing_booking_requested', v_h.owner_id, v_uid);
  return v_row;
end;
$$;

revoke all on function public.request_housing_booking(uuid, date, date, int, int, text, boolean) from public, anon;
grant execute on function public.request_housing_booking(uuid, date, date, int, int, text, boolean) to authenticated;

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
  v_h public.post_handoffs;
  v_post public.posts;
  v_details public.housing_booking_details;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if p_note is not null and char_length(p_note) > 300 then
    raise exception 'housing_note_too_long' using errcode = '23514';
  end if;

  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'housing';
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  select * into v_post from public.posts
   where post_id = v_h.post_id for update;
  if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;

  select * into v_h from public.post_handoffs where handoff_id = p_handoff_id for update;
  if v_h.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_h.status <> 'reserved' then raise exception 'invalid_status' using errcode = '23514'; end if;

  if not coalesce(p_approve, false) then
    update public.housing_booking_details set decision_note = nullif(btrim(p_note), '')
     where handoff_id = p_handoff_id;
    update public.post_handoffs
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'declined'
     where handoff_id = p_handoff_id;
    v_row := public.giving_handoff_row_of(p_handoff_id);
    return v_row;
  end if;

  perform public.housing_assert_eligible(v_uid, 'decide');
  perform public.housing_assert_eligible(v_h.recipient_id, 'book');
  if v_post.status <> 'open' then raise exception 'listing_not_available' using errcode = 'P0002'; end if;

  select * into v_details from public.housing_booking_details where handoff_id = p_handoff_id;
  if public.housing_guest_has_overlap(v_h.recipient_id, v_details.check_in_date, v_details.check_out_date, p_handoff_id) then
    raise exception 'housing_booking_overlap' using errcode = '23514';
  end if;
  perform public.housing_assert_nights_bookable(
    v_post, v_details.check_in_date, v_details.check_out_date, v_h.seats, p_handoff_id);

  update public.housing_booking_details set decision_note = nullif(btrim(p_note), '')
   where handoff_id = p_handoff_id;
  update public.post_handoffs
     set status = 'confirmed', confirmed_at = now()
   where handoff_id = p_handoff_id;

  -- First confirmation wins: the guest's other waiting requests for overlapping nights end
  -- (FR-HOUSING-015 AC3); their hosts are told the guest found another place (0603).
  update public.post_handoffs h
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded'
    from public.housing_booking_details d
   where d.handoff_id = h.handoff_id
     and h.recipient_id = v_h.recipient_id
     and h.world_slug = 'housing'
     and h.status = 'reserved'
     and h.handoff_id <> p_handoff_id
     and d.check_in_date < v_details.check_out_date and v_details.check_in_date < d.check_out_date;

  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

revoke all on function public.decide_housing_booking(uuid, boolean, text) from public, anon;
grant execute on function public.decide_housing_booking(uuid, boolean, text) to authenticated;

-- ── 8. owner_complete_offer_with_user on public.posts ──────────────────────────────────────────
create or replace function public.owner_complete_offer_with_user(
  p_target uuid,
  p_recipient_id uuid
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
  v_max int;
  v_assigned_today int;
  v_handoff_id uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if p_recipient_id is null then raise exception 'recipient_required' using errcode = '23514'; end if;
  if p_recipient_id = v_uid then raise exception 'cannot_assign_to_self' using errcode = '23514'; end if;
  if not public.is_active_member(p_recipient_id) then
    raise exception 'recipient_inactive' using errcode = '23514';
  end if;

  select * into v_post from public.posts where post_id = v_post_id for update;
  if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;
  if v_post.owner_id <> v_uid then raise exception 'closure_not_owner' using errcode = 'P0001'; end if;
  if v_post.status <> 'open' then raise exception 'closure_wrong_status' using errcode = 'P0001'; end if;
  if v_post.direction <> 'offer' then raise exception 'not_offer' using errcode = '23514'; end if;

  v_world := v_post.world_slug;
  v_kind := v_post.kind_id;
  if v_world not in ('items', 'food', 'animals', 'rides', 'housing') then
    raise exception 'world_not_assignable' using errcode = '23514';
  end if;
  if v_world = 'animals' and not exists (
    select 1 from public.listing_kinds k
     where k.kind_id = v_kind and k.slug in ('adoption_offer', 'foster_offer')
  ) then
    raise exception 'world_not_assignable' using errcode = '23514';
  end if;
  if v_world = 'food' and v_post.expires_at is not null and v_post.expires_at <= now() then
    raise exception 'listing_expired' using errcode = '23514';
  end if;
  if v_world in ('animals', 'housing')
     and not public.has_world_permission(v_uid, v_world, 'publish') then
    raise exception 'world_permission_denied' using errcode = '42501';
  end if;

  select (p.param_value #>> '{}')::int into v_max
    from public.marketplace_rule_params p
   where p.rule_code = 'R-MOD-Direct-Assignment-Cap' and p.param_key = 'max_daily_direct_assignments';
  v_max := coalesce(v_max, 5);

  select count(*)::int into v_assigned_today
    from public.post_handoffs h
   where h.owner_id = v_uid
     and h.created_at >= date_trunc('day', now())
     and h.pickup_mode = 'direct_assignment';

  if v_assigned_today >= v_max then
    raise exception 'daily_assignment_cap_exceeded' using errcode = '23514';
  end if;

  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'reassigned_by_owner'
   where post_id = v_post_id
     and status in ('reserved', 'confirmed');

  insert into public.post_handoffs (
    post_id, owner_id, recipient_id, world_slug, status,
    pickup_mode, confirmed_at, handed_over_at
  ) values (
    v_post_id, v_uid, p_recipient_id, v_world, 'handed_over',
    'direct_assignment', now(), now()
  )
  returning handoff_id into v_handoff_id;

  if v_world = 'housing' then
    insert into public.housing_booking_details (
      handoff_id, check_in_date, check_out_date, adults, minors, message, minors_guardian_ack
    ) values (
      v_handoff_id, public.housing_today(), public.housing_today() + 1, 1, 0,
      'direct assignment by host', false
    );
  end if;

  if v_world = 'items' then
    insert into public.recipients (post_id, recipient_user_id)
    values (v_post_id, p_recipient_id)
    on conflict (post_id) do update
      set recipient_user_id = excluded.recipient_user_id, marked_at = now();
  end if;

  perform public.post_record_set_status(v_post, 'closed_delivered');

  select * into v_listing from public.listings where listing_id = public.listing_id_of_post(v_post.post_id);
  if v_listing.listing_id is not null then
    update public.listings
       set status = 'closed', availability_status = 'ongoing', updated_at = now()
     where listing_id = v_listing.listing_id;
  end if;

  if v_world <> 'items' then
    perform public.karma_award_handoff(v_uid, p_recipient_id, v_world, v_handoff_id);
  end if;

  return jsonb_build_object(
    'success', true,
    'post_id', v_post_id,
    'listing_id', coalesce(v_listing.listing_id, v_post_id),
    'handoff_id', v_handoff_id,
    'recipient_id', p_recipient_id,
    'world_slug', v_world
  );
end;
$$;

revoke all on function public.owner_complete_offer_with_user(uuid, uuid) from public, anon;
grant execute on function public.owner_complete_offer_with_user(uuid, uuid) to authenticated;

-- ── 9. Sweeps operate on public.posts ───────────────────────────────────────────────────────────
create or replace function public.giving_handoff_no_show_sweep()
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
    select handoff_id, post_id
      from public.post_handoffs
     where status = 'confirmed'
       and pickup_window_end is not null
       and pickup_window_end < now() - interval '2 hours'
  loop
    update public.post_handoffs
       set status = 'no_show', no_show_at = now()
     where handoff_id = r.handoff_id;
    update public.posts
       set availability_status = 'immediate', updated_at = now()
     where post_id = r.post_id and status = 'open';
    update public.listings
       set availability_status = 'immediate', updated_at = now()
     where listing_id = public.listing_id_of_post(r.post_id) and status = 'open';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.giving_handoff_no_show_sweep() from public, anon, authenticated;
grant execute on function public.giving_handoff_no_show_sweep() to service_role;

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
    select post_id, owner_id, title from public.posts
     where world_slug = 'food'
       and status = 'open'
       and expires_at is not null
       and expires_at <= now()
  loop
    update public.post_handoffs
       set status = 'cancelled', cancelled_at = now()
     where post_id = r.post_id and status in ('reserved', 'confirmed');
    update public.giving_handoffs
       set status = 'cancelled', cancelled_at = now()
     where listing_id = public.listing_id_of_post(r.post_id) and status in ('reserved', 'confirmed');
    update public.posts
       set status = 'expired', updated_at = now()
     where post_id = r.post_id;
    update public.listings
       set status = 'expired', updated_at = now()
     where listing_id = public.listing_id_of_post(r.post_id);
    perform public.enqueue_notification(
      r.owner_id, 'critical', 'listing_expired',
      'notifications.foodExpiredTitle', 'notifications.foodExpiredBody',
      jsonb_build_object('listingTitle', coalesce(r.title, '')),
      jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                         'params', jsonb_build_object('listingId', coalesce(public.listing_id_of_post(r.post_id), r.post_id)::text)),
      'food_expired:' || coalesce(public.listing_id_of_post(r.post_id), r.post_id)::text,
      false
    );
    v_count := v_count + 1;
  end loop;

  for r in
    select listing_id, owner_id, title from public.listings
     where world_slug = 'food'
       and status = 'open'
       and expires_at is not null
       and expires_at <= now()
       and legacy_post_id is null
  loop
    update public.giving_handoffs
       set status = 'cancelled', cancelled_at = now()
     where listing_id = r.listing_id and status in ('reserved', 'confirmed');
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

-- ── 10. create_marketplace_listing writes directly to public.posts ──────────────────────────────
create or replace function public.create_marketplace_listing(
  p_kind_id uuid,
  p_title text,
  p_summary text default null,
  p_details jsonb default '{}'::jsonb,
  p_direction text default null,
  p_category_id uuid default null,
  p_city_id text default null,
  p_urgency_level smallint default 2,
  p_availability_status text default 'ongoing',
  p_lat double precision default null,
  p_lng double precision default null,
  p_max_radius_km numeric default null,
  p_media_paths text[] default null,
  p_external_body_id uuid default null,
  p_additional_world_slugs text[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_kind public.listing_kinds;
  v_dir text;
  v_post_dir text;
  v_post_id uuid;
  v_geo geography;
  v_body public.external_bodies;
  v_city text;
  v_expires timestamptz;
  v_condition text;
  v_cat text;
  v_listing_id uuid;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if not public.is_active_member(v_uid) then
    raise exception 'member_inactive' using errcode = '42501';
  end if;

  select * into v_kind from public.listing_kinds where kind_id = p_kind_id and is_active;
  if not found then
    raise exception 'kind_not_found' using errcode = 'P0002';
  end if;

  v_dir := coalesce(p_direction, case when v_kind.direction = 'either' then 'give' else v_kind.direction end);
  if v_dir not in ('give', 'request') then
    raise exception 'invalid_direction' using errcode = '22023';
  end if;
  v_post_dir := case v_dir when 'request' then 'request' else 'offer' end;

  if not public.validate_listing_details(p_kind_id, p_details) then
    raise exception 'details_schema_mismatch' using errcode = '23514';
  end if;

  if p_external_body_id is not null then
    select * into v_body from public.external_bodies where body_id = p_external_body_id;
    if not found or not v_body.is_active or not v_body.is_verified
       or v_body.world_slug <> v_kind.world_slug then
      raise exception 'external_body_invalid' using errcode = '23514';
    end if;
  end if;

  if p_lat is not null and p_lng is not null then
    v_geo := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::geography;
  elsif p_city_id is not null then
    v_geo := public.listing_geo_from_city(p_city_id);
  end if;

  if char_length(p_title) > 80 then
    raise exception 'title_too_long' using errcode = '23514';
  end if;
  v_city := coalesce(p_city_id, (select u.city from public.users u where u.user_id = v_uid), 'tel-aviv');

  v_expires := coalesce(
    nullif(p_details ->> 'expires_at', '')::timestamptz,
    nullif(p_details ->> 'departs_at', '')::timestamptz,
    case when v_kind.default_ttl_hours is not null then now() + (v_kind.default_ttl_hours || ' hours')::interval else null end
  );

  v_condition := case lower(p_details ->> 'item_condition')
    when 'new' then 'New'
    when 'like_new' then 'LikeNew'
    when 'likenew' then 'LikeNew'
    when 'good' then 'Good'
    when 'fair' then 'Fair'
    else null
  end;

  select c.legacy_post_category into v_cat
    from public.categories c
   where c.category_id = p_category_id;
  if v_cat is null or v_cat not in (
    'Furniture', 'Clothing', 'Books', 'Toys', 'BabyGear', 'Kitchen', 'Sports', 'Electronics', 'Tools', 'Other'
  ) then
    v_cat := 'Other';
  end if;

  v_listing_id := gen_random_uuid();

  insert into public.posts (
    owner_id, type, visibility, title, description, category, city, street, street_number,
    location_display_level, world_slug, direction, post_type, details, category_id, geo,
    urgency_level, external_body_id, kind_id, availability_status, max_radius_km_override,
    moderation_status, published_at, expires_at, item_condition, listing_id, listing_world_slug, legacy_listing_id
  ) values (
    v_uid, case v_dir when 'request' then 'Request' else 'Give' end, 'Public', p_title,
    nullif(trim(coalesce(p_summary, '')), ''), v_cat, v_city, 'Marketplace', '1', 'CityOnly',
    v_kind.world_slug, v_post_dir, case when v_kind.world_slug = 'rides' then 'ride' else 'standard' end,
    coalesce(p_details, '{}'::jsonb), p_category_id, v_geo, coalesce(p_urgency_level, 2), p_external_body_id,
    p_kind_id, coalesce(p_availability_status, 'ongoing'), p_max_radius_km, 'published', now(),
    v_expires, v_condition, v_listing_id, v_kind.world_slug, v_listing_id
  )
  returning post_id into v_post_id;

  if to_regclass('public.listings') is not null then
    begin
      insert into public.listings (
        listing_id, owner_id, world_slug, kind_id, category_id, direction, title, summary, details,
        city_id, geo, max_radius_km_override, urgency_level, availability_status, origin, moderation_status,
        external_body_id, legacy_post_id, expires_at
      ) values (
        v_listing_id, v_uid, v_kind.world_slug, p_kind_id, p_category_id, v_dir, p_title, p_summary, coalesce(p_details, '{}'::jsonb),
        p_city_id, v_geo, p_max_radius_km, coalesce(p_urgency_level, 2), coalesce(p_availability_status, 'ongoing'),
        'native', 'published',
        p_external_body_id, v_post_id, v_expires
      );

      if p_media_paths is not null and cardinality(p_media_paths) > 0 then
        perform public.attach_listing_media(v_listing_id, p_media_paths);
      end if;
    exception when others then
      raise;
    end;
  end if;

  return coalesce(v_listing_id, v_post_id);
end;
$$;

revoke all on function public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text, double precision, double precision, numeric, text[], uuid, text[]
) from public;

grant execute on function public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text, double precision, double precision, numeric, text[], uuid, text[]
) to authenticated;

-- ── 5. Moderation on listings mirrors to posts when sync triggers are dropped ───────────────────
create or replace function public.reports_listing_auto_remove_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  distinct_reporters int;
  v_owner_id         uuid;
  v_owner_chat       uuid;
begin
  if new.target_type <> 'listing' or new.target_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('mod_target_listing_' || new.target_id::text)::bigint);

  select count(distinct reporter_id) into distinct_reporters
    from public.reports
   where target_type = 'listing'
     and target_id   = new.target_id
     and status      = 'open'
     and created_at >= now() - interval '14 days';

  if distinct_reporters >= 3 then
    update public.listings
       set status = 'hidden_pending_review', updated_at = now()
     where listing_id = new.target_id
       and status = 'open'
    returning owner_id into v_owner_id;

    if found then
      update public.posts
         set status = 'hidden_pending_review', updated_at = now()
       where (listing_id = new.target_id or legacy_listing_id = new.target_id or post_id = new.target_id)
         and status = 'open';

      insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
      values (null, 'auto_remove_target', 'listing', new.target_id,
              jsonb_build_object('distinct_reporters', distinct_reporters));

      begin
        if v_owner_id is not null and v_owner_id <> new.reporter_id then
          v_owner_chat := public.find_or_create_support_chat(v_owner_id);
          if v_owner_chat is not null then
            perform public.inject_system_message(v_owner_chat,
              jsonb_build_object('kind', 'owner_auto_removed',
                                 'target_type', 'listing',
                                 'target_id', new.target_id,
                                 'outcome', 'hidden_pending_review'),
              null);
          end if;
        end if;
      exception when others then
        raise warning 'owner_auto_removed message failed: % (state %, listing %)',
          sqlerrm, sqlstate, new.target_id;
      end;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.admin_restore_target(p_target_type text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_actor     uuid := auth.uid();
  v_changed   boolean := false;
  v_reporters uuid[];
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  if p_target_type not in ('post','user','chat','listing') then
    raise exception 'invalid_target_type' using errcode = 'P0010';
  end if;

  if p_target_type = 'post' then
    if not exists (select 1 from public.posts where post_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'post';
    end if;
  elsif p_target_type = 'user' then
    if not exists (select 1 from public.users where user_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'user';
    end if;
  elsif p_target_type = 'chat' then
    if not exists (select 1 from public.chats where chat_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'chat';
    end if;
  elsif p_target_type = 'listing' then
    if not exists (select 1 from public.listings where listing_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'listing';
    end if;
  end if;

  if p_target_type = 'post' then
    update public.posts set status = 'open', moderation_status = 'published', updated_at = now()
     where post_id = p_target_id and (status in ('removed_admin', 'hidden_pending_review', 'paused') or moderation_status = 'held');
    v_changed := found;
  elsif p_target_type = 'user' then
    if exists (select 1 from public.users
               where user_id = p_target_id
                 and account_status not in ('suspended_admin','active')) then
      raise exception 'invalid_restore_state'
        using errcode = 'P0011', detail = 'user not in suspended_admin state';
    end if;
    update public.users set account_status = 'active'
     where user_id = p_target_id and account_status = 'suspended_admin';
    v_changed := found;
  elsif p_target_type = 'chat' then
    update public.chats set removed_at = null
     where chat_id = p_target_id and removed_at is not null;
    v_changed := found;
  elsif p_target_type = 'listing' then
    update public.listings set status = 'open', updated_at = now()
     where listing_id = p_target_id and status in ('removed_admin', 'hidden_pending_review');
    v_changed := found;
    update public.posts set status = 'open', updated_at = now()
     where (listing_id = p_target_id or legacy_listing_id = p_target_id or post_id = p_target_id)
       and status in ('removed_admin', 'hidden_pending_review');
  end if;

  if not v_changed then return; end if;

  select coalesce(array_agg(distinct reporter_id order by reporter_id), array[]::uuid[])
    into v_reporters
    from public.reports
   where target_type = p_target_type
     and target_id   = p_target_id
     and status      = 'open';

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'restore_target', p_target_type, p_target_id,
          jsonb_build_object('distinct_reporters', to_jsonb(v_reporters)));
end;
$$;

create or replace function public.admin_remove_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  update public.listings
     set status = 'removed_admin', updated_at = now()
   where listing_id = p_listing_id
     and status <> 'removed_admin';

  if not found then return; end if;

  update public.posts
     set status_before_admin_removal = case when status = 'hidden_pending_review' then 'open' else status end,
         status = 'removed_admin',
         updated_at = now()
   where (listing_id = p_listing_id or legacy_listing_id = p_listing_id or post_id = p_listing_id)
     and status <> 'removed_admin';

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'manual_remove_target', 'listing', p_listing_id, '{}'::jsonb);
end;
$$;

create or replace function public.ride_series_materialize_day(p_series public.ride_series, p_on date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_departs timestamptz := (p_on + p_series.depart_time) at time zone 'Asia/Jerusalem';
  v_details jsonb;
  v_direction text := case when p_series.direction = 'request' then 'request' else 'offer' end;
  v_hidden boolean;
  v_post_id uuid;
  v_listing_id uuid;
begin
  if (p_series.weekdays & (1 << extract(dow from p_on)::int)) = 0 or v_departs <= now() then
    return 0;
  end if;
  if exists (select 1 from public.ride_post_details r
              where r.series_id = p_series.series_id
                and r.series_on = p_on) then
    return 0;
  end if;

  v_details := p_series.details
    || jsonb_build_object('departs_at', v_departs, 'ride_series', public.ride_series_marker(p_series, p_on));
  if p_series.duration_minutes is not null then
    v_details := v_details
      || jsonb_build_object('arrives_at', v_departs + make_interval(mins => p_series.duration_minutes));
  end if;

  if public.listing_kind_for_post('rides', v_direction) = p_series.kind_id then
    v_hidden := not exists (select 1 from public.worlds w where w.slug = 'rides' and w.feed_mirror)
      or exists (select 1 from public.ride_post_details r
                   join public.posts o on o.post_id = r.post_id
                  where r.series_id = p_series.series_id
                    and o.status = 'open'
                    and r.departs_at > now()
                    and r.departs_at < v_departs);
    begin
      insert into public.posts (
        owner_id, type, visibility, title, description, category, city, street, street_number,
        location_display_level, world_slug, direction, post_type, details, expires_at, feed_hidden
      ) values (
        p_series.owner_id, case when v_direction = 'request' then 'Request' else 'Give' end, 'Public',
        left(p_series.title, 80), nullif(trim(coalesce(p_series.summary, '')), ''), 'Other',
        coalesce((select u.city from public.users u where u.user_id = p_series.owner_id), 'tel-aviv'),
        'Marketplace', '1', 'CityOnly', 'rides', v_direction, 'ride', v_details,
        v_departs + interval '30 minutes', v_hidden
      ) returning post_id into v_post_id;

      if to_regclass('public.listings') is not null then
        insert into public.listings (
          owner_id, world_slug, kind_id, direction, title, summary, details, origin, moderation_status, expires_at, legacy_post_id
        ) values (
          p_series.owner_id, 'rides', p_series.kind_id, p_series.direction, p_series.title, p_series.summary,
          v_details, 'native', 'published', v_departs + interval '30 minutes', v_post_id
        ) returning listing_id into v_listing_id;

        update public.posts
           set listing_id = v_listing_id, legacy_listing_id = v_listing_id, listing_world_slug = 'rides',
               details = (select details from public.listings where listing_id = v_listing_id),
               expires_at = (select expires_at from public.listings where listing_id = v_listing_id)
         where post_id = v_post_id;
      end if;
    exception when unique_violation then
      return 0;
    end;
    return 1;
  end if;

  begin
    insert into public.listings (
      owner_id, world_slug, kind_id, direction, title, summary, details, origin, moderation_status, expires_at
    ) values (
      p_series.owner_id, 'rides', p_series.kind_id, p_series.direction, p_series.title, p_series.summary,
      v_details, 'native', 'published',
      v_departs + interval '30 minutes'
    );
  exception when unique_violation then
    return 0;
  end;
  return 1;
end;
$$;

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
  perform public.ride_series_drop_unbooked(s.series_id);
  if p_status = 'cancelled' then
    update public.posts p
       set details = p.details - 'ride_series', updated_at = now()
      from public.ride_post_details r
     where r.post_id = p.post_id and r.series_id = s.series_id;

    if to_regclass('public.listings') is not null then
      update public.listings
         set details = details - 'ride_series', updated_at = now()
       where details -> 'ride_series' ->> 'id' = s.series_id::text;
    end if;
  end if;
end;
$$;

create or replace function public.mark_giving_handed_over(p_handoff_id uuid)
returns giving_handoffs
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  update public.post_handoffs
     set status = 'handed_over', handed_over_at = now()
   where handoff_id = p_handoff_id
     and status = 'confirmed'
     and (owner_id = auth.uid() or recipient_id = auth.uid())
  returning * into v_h;
  if not found then raise exception 'handoff_not_confirmed' using errcode = '23514'; end if;

  if v_h.world_slug = 'items'
     and exists (select 1 from public.posts p where p.post_id = v_h.post_id and p.listing_id is null) then
    -- One closing system (G34): the post closure pays giver 20 + value bonus / receiver 15 once.
    perform public.post_close_from_handoff(v_h);
  else
    if to_regclass('public.listings') is not null then
      update public.listings
         set status = 'closed', availability_status = 'ongoing', updated_at = now()
       where listing_id = public.listing_id_of_post(v_h.post_id);
    end if;
    update public.posts
       set status = 'closed_delivered', availability_status = 'ongoing', updated_at = now()
     where post_id = v_h.post_id;
    perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, p_handoff_id);
  end if;

  v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
  return v_row;
end;
$$;

create or replace function public.trg_write_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_role text;
  v_actor uuid;
  v_max int;
begin
  if v_claims = '' or pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_table_name = 'listings' and to_jsonb(new)->>'legacy_post_id' is not null then
    return new;
  end if;

  begin
    v_role := v_claims::jsonb ->> 'role';
  exception when others then
    v_role := null;
  end;
  if coalesce(v_role, 'authenticated') not in ('authenticated', 'anon') then
    return new;
  end if;

  -- 0625: a post is counted for its owner, like the listing it derives.
  if tg_table_name in ('listings', 'posts') then
    v_actor := new.owner_id;
  elsif tg_table_name in ('giving_handoffs', 'post_handoffs') then
    -- Both handoff tables share one bucket (tg_argv[1]); the derived write of either side runs
    -- at trigger depth 2 and is skipped above, so a handoff is counted once.
    v_actor := new.recipient_id;
  elsif tg_table_name = 'follow_edges' then
    v_actor := new.follower_id;
  end if;
  if v_actor is null then
    return new;
  end if;

  select (p.param_value #>> '{}')::int into v_max
    from public.marketplace_rule_params p
   where p.rule_code = tg_argv[0]
     and p.param_key = 'max_per_hour';
  if v_max is null or v_max < 1 then
    raise exception 'invalid_rate_limit_args' using errcode = '22023';
  end if;

  perform public.enforce_rate_limit(tg_argv[1] || ':' || v_actor::text, v_max, 3600);
  return new;
end;
$$;

revoke all on function public.trg_write_rate_limit() from public, anon, authenticated;

-- ── 12. House numbers RPCs on posts / post_handoffs ──────────────────────────────────────────────
create or replace function public.set_ride_house_numbers(
  p_listing_id uuid,
  p_origin text default null,
  p_dest text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_id uuid := public.handoff_target_listing_id(p_listing_id);
  v_details jsonb;
  v_end text;
  v_number text;
begin
  select p.details into v_details
    from public.posts p
   where (p.post_id = v_listing_id or p.listing_id = v_listing_id)
     and p.world_slug = 'rides' and p.owner_id = auth.uid();
  if not found and to_regclass('public.listings') is not null then
    select l.details into v_details
      from public.listings l
     where l.listing_id = v_listing_id and l.world_slug = 'rides' and l.owner_id = auth.uid();
  end if;
  if v_details is null then
    raise exception 'owner_only' using errcode = '42501';
  end if;

  foreach v_end in array array['origin', 'dest'] loop
    v_number := nullif(btrim(case v_end when 'origin' then p_origin else p_dest end), '');
    if v_number is null then
      delete from public.ride_listing_house_numbers where listing_id = v_listing_id and place_end = v_end;
    else
      if coalesce(v_details ->> (v_end || '_place_kind'), '') <> 'street' then
        raise exception 'ride_house_number_not_street' using errcode = '22023';
      end if;
      if v_number !~ '^[0-9]{1,4}[א-תA-Za-z]?$' then
        raise exception 'ride_house_number_invalid' using errcode = '22023';
      end if;
      insert into public.ride_listing_house_numbers (listing_id, place_end, house_number, updated_at)
      values (v_listing_id, v_end, v_number, now())
      on conflict (listing_id, place_end)
      do update set house_number = excluded.house_number, updated_at = now();
    end if;
  end loop;
end;
$$;

revoke all on function public.set_ride_house_numbers(uuid, text, text) from public, anon;
grant execute on function public.set_ride_house_numbers(uuid, text, text) to authenticated;

create or replace function public.get_ride_house_numbers(p_listing_id uuid)
returns table (place_end text, house_number text)
language sql
stable
security definer
set search_path = public
as $$
  with target as (select public.handoff_target_listing_id(p_listing_id) as listing_id)
  select n.place_end, n.house_number
    from public.ride_listing_house_numbers n
    join target t on t.listing_id = n.listing_id
   where auth.uid() is not null
     and (
       exists (select 1 from public.listings l where l.listing_id = t.listing_id and l.owner_id = auth.uid())
       or exists (select 1 from public.posts p where (p.post_id = t.listing_id or p.listing_id = t.listing_id) and p.owner_id = auth.uid())
       or exists (
         select 1 from public.giving_handoffs h
          where h.listing_id = t.listing_id
            and h.recipient_id = auth.uid()
            and h.status in ('confirmed', 'handed_over'))
       or exists (
         select 1 from public.post_handoffs ph
           join public.posts p on p.post_id = ph.post_id
          where (p.post_id = t.listing_id or p.listing_id = t.listing_id)
            and ph.recipient_id = auth.uid()
            and ph.status in ('confirmed', 'handed_over'))
     );
$$;

revoke all on function public.get_ride_house_numbers(uuid) from public, anon;
grant execute on function public.get_ride_house_numbers(uuid) to authenticated;

commit;
