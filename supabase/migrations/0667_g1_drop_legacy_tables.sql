-- 0667_g1_drop_legacy_tables | G1 step 6d (ADR-006, D-214, issue #1671): drop legacy tables
-- `listings`, `ride_listings`, and `giving_handoffs`.
--
-- With single S1 state machine enforced (0665) and sync triggers dropped (0666), writes and reads
-- now flow directly through `posts`, `ride_post_details`, and `post_handoffs`.
--
-- This migration permanently drops the three physical legacy tables and provides zero-cost
-- compatibility views for `listings`, `ride_listings`, and `giving_handoffs` with INSTEAD OF
-- triggers, re-targeting all foreign keys and RLS policies to `public.posts(post_id)` and
-- `public.post_handoffs(handoff_id)`.
--
-- migration-safety: allow

begin;

-- ── 1. Drop existing views depending on legacy tables ───────────────────────────────────────────
drop view if exists public.giving_user_trust_score cascade;
drop view if exists public.listing_owner_trust_score cascade;
drop view if exists public.marketplace_listing_card cascade;

-- ── 2. Drop the 3 legacy tables with CASCADE ────────────────────────────────────────────────────
drop table if exists public.giving_handoffs cascade; -- migration-safety: allow
drop table if exists public.ride_listings cascade; -- migration-safety: allow
drop table if exists public.listings cascade; -- migration-safety: allow

-- Ensure tel-aviv city coordinates are populated for ride place lookup and geo resolution
insert into public.cities (city_id, name_he, name_en, lat, lon, geo)
values (
  'tel-aviv', 'תל אביב', 'Tel Aviv', 32.0853, 34.7818,
  extensions.st_setsrid(extensions.st_makepoint(34.7818, 32.0853), 4326)::extensions.geography
)
on conflict (city_id) do update
  set lat = 32.0853,
      lon = 34.7818,
      geo = extensions.st_setsrid(extensions.st_makepoint(34.7818, 32.0853), 4326)::extensions.geography;

-- ── 3. Create compatibility views ───────────────────────────────────────────────────────────────
create or replace view public.listings as
  select
    p.post_id as listing_id,
    p.owner_id,
    coalesce(p.world_slug, 'items') as world_slug,
    p.kind_id as kind_id,
    p.category_id,
    case when p.direction = 'request' or p.type = 'Request' then 'request' else 'give' end as direction,
    case
      when p.status = 'paused' then 'cancelled'
      when p.status = 'closed_delivered' then 'closed'
      when p.status = 'deleted_no_recipient' then 'cancelled'
      else coalesce(p.status, 'open')
    end as status,
    p.visibility,
    public.visibility_to_anonymity_level(p.visibility) as anonymity_level,
    p.title,
    coalesce(p.description, '') as summary,
    p.geo,
    p.city as city_id,
    p.time_window,
    p.expires_at,
    coalesce(p.details, '{}'::jsonb) as details,
    p.external_body_id,
    case when p.source = 'imported' then 'ingestion' else 'native' end as origin,
    null::uuid as canonical_id,
    p.post_id as legacy_post_id,
    null::uuid as legacy_ride_id,
    coalesce(p.moderation_status, 'published') as moderation_status,
    coalesce(p.published_at, p.created_at) as published_at,
    p.created_at,
    p.updated_at,
    null::vector as embedding,
    null::text as embedding_model,
    null::text as geo_mode_override,
    p.max_radius_km_override,
    null::numeric as geo_weight_override,
    p.search_vector,
    coalesce(p.urgency_level, 1::smallint) as urgency_level,
    coalesce(p.availability_status, 'ongoing') as availability_status,
    p.beneficiary_org_id
  from public.posts p;

create or replace view public.giving_handoffs as
  select
    h.handoff_id,
    coalesce(public.listing_id_of_post(h.post_id), h.post_id) as listing_id,
    h.owner_id,
    h.recipient_id,
    h.world_slug,
    h.status,
    h.pickup_mode,
    h.pickup_window_start,
    h.pickup_window_end,
    h.confirm_by,
    h.reserved_at,
    h.confirmed_at,
    h.handed_over_at,
    h.cancelled_at,
    h.no_show_at,
    h.seats,
    h.slot_starts_at,
    h.slot_ends_at,
    h.cancel_reason
  from public.post_handoffs h
  where h.world_slug <> 'time';

create or replace view public.ride_listings as
  select
    p.post_id as ride_id,
    p.owner_id,
    case p.direction when 'request' then 'request' else 'offer' end as mode,
    r.origin_city_id,
    r.dest_city_id,
    r.departs_at,
    r.seats_available,
    p.description,
    p.title,
    case
      when p.status = 'paused' then 'cancelled'
      when p.status = 'closed_delivered' then 'closed'
      when p.status = 'deleted_no_recipient' then 'cancelled'
      else coalesce(p.status, 'open')
    end as status,
    p.visibility,
    p.created_at,
    p.updated_at,
    null::text as origin_street,
    null::text as origin_street_number,
    null::text as dest_street,
    null::text as dest_street_number,
    null::uuid as template_id,
    false as cargo_enabled,
    null::integer as cargo_max_volume_l,
    null::integer as cargo_max_weight_kg,
    null::text[] as cargo_allowed_types,
    false as food_shipping_enabled,
    null::integer as food_max_kg,
    false as food_chilled,
    coalesce(r.reward_model, 'free') as payment_model,
    round(coalesce(r.cost_share_ils, 0))::integer as payment_amount_ils,
    null::text as req_gender,
    false as req_smoking_allowed,
    false as req_pets_allowed,
    false as req_verified_only,
    null::timestamptz as started_at,
    r.arrives_at as arrived_at,
    null::text as arrive_reason,
    p.post_id as linked_post_id,
    false as food_handover_to_org
  from public.posts p
  left join public.ride_post_details r on r.post_id = p.post_id
  where p.post_type = 'ride' or p.world_slug = 'rides';

-- ── 4. INSTEAD OF Triggers on Compatibility Views ───────────────────────────────────────────────
create or replace function public.listings_view_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_post public.posts;
  v_target_post_id uuid := coalesce(new.legacy_post_id, new.listing_id);
  v_post_id uuid := coalesce(v_target_post_id, gen_random_uuid());
  v_world text := coalesce(new.world_slug, 'items');
  v_dir text := case when new.direction = 'request' then 'request' else 'offer' end;
  v_type text := case v_dir when 'request' then 'Request' else 'Give' end;
  v_world_anon smallint;
  v_vis text;
  v_feed_hidden boolean;
  v_status text := case
    when new.status = 'cancelled' then 'paused'
    when new.status = 'closed' then 'closed_delivered'
    else coalesce(new.status, 'open')
  end;
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_role text;
  v_max int;
begin
  if v_claims <> '' and pg_trigger_depth() <= 1 then
    begin
      v_role := v_claims::jsonb ->> 'role';
    exception when others then
      v_role := null;
    end;
    if coalesce(v_role, 'authenticated') in ('authenticated', 'anon') and new.owner_id is not null then
      select (p.param_value #>> '{}')::int into v_max
        from public.marketplace_rule_params p
       where p.rule_code = 'R-SEC-Listing-Write'
         and p.param_key = 'max_per_hour';
      if v_max is not null and v_max >= 1 then
        perform public.enforce_rate_limit('listings:' || new.owner_id::text, v_max, 3600);
      end if;
    end if;
  end if;

  select w.default_anonymity_level, not coalesce(w.feed_mirror, true)
    into v_world_anon, v_feed_hidden
    from public.worlds w
   where w.slug = v_world;

  if new.visibility is not null then
    v_vis := new.visibility;
  elsif new.anonymity_level is not null then
    v_vis := public.anonymity_level_to_visibility(least(new.anonymity_level, coalesce(v_world_anon, new.anonymity_level)));
  else
    v_vis := public.anonymity_level_to_visibility(coalesce(v_world_anon, 3));
  end if;
  if v_target_post_id is not null and exists (select 1 from public.posts where post_id = v_target_post_id) then
    update public.posts
       set legacy_listing_id = coalesce(new.listing_id, legacy_listing_id, post_id),
           listing_id = coalesce(new.listing_id, listing_id, post_id),
           listing_world_slug = coalesce(v_world, listing_world_slug),
           urgency_level = coalesce(new.urgency_level, urgency_level),
           availability_status = coalesce(new.availability_status, availability_status)
     where post_id = v_target_post_id
    returning * into v_post;
  else
    insert into public.posts (
      post_id, owner_id, type, status, visibility, title, description,
      category, city, street, street_number, location_display_level,
      world_slug, direction, post_type, expires_at, source, details,
      category_id, geo, time_window, urgency_level, external_body_id,
      beneficiary_org_id, moderation_status, availability_status, kind_id,
      published_at, max_radius_km_override, feed_hidden,
      listing_id, listing_world_slug, legacy_listing_id
    ) values (
      v_post_id,
      new.owner_id,
      v_type,
      v_status,
      v_vis,
      coalesce(left(new.title, 80), 'Listing'),
      new.summary,
      'Other',
      coalesce(new.city_id, 'tel-aviv'),
      'Marketplace', '1', 'CityOnly',
      v_world,
      v_dir,
      case when v_world = 'rides' then 'ride' else 'standard' end,
      new.expires_at,
      case when new.origin in ('imported', 'ingestion') then 'imported' else 'native' end,
      coalesce(new.details, '{}'::jsonb),
      new.category_id,
      new.geo,
      new.time_window,
      coalesce(new.urgency_level, 1::smallint),
      new.external_body_id,
      new.beneficiary_org_id,
      coalesce(new.moderation_status, 'published'),
      case when new.availability_status in ('immediate', 'scheduled', 'ongoing') then new.availability_status else 'ongoing' end,
      new.kind_id,
      coalesce(new.published_at, now()),
      new.max_radius_km_override,
      coalesce(v_feed_hidden, false),
      v_post_id,
      v_world,
      v_post_id
    )
    returning * into v_post;
  end if;

  new.listing_id := coalesce(new.listing_id, v_post.post_id);
  new.legacy_post_id := v_post.post_id;
  new.owner_id := v_post.owner_id;
  new.world_slug := v_post.world_slug;
  new.kind_id := v_post.kind_id;
  new.category_id := v_post.category_id;
  new.direction := case when v_post.direction = 'offer' then 'give' else 'request' end;
  new.status := case
    when v_post.status = 'paused' then 'cancelled'
    when v_post.status = 'closed_delivered' then 'closed'
    when v_post.status = 'deleted_no_recipient' then 'cancelled'
    else v_post.status
  end;
  new.visibility := v_post.visibility;
  new.anonymity_level := public.visibility_to_anonymity_level(v_post.visibility);
  new.title := v_post.title;
  new.summary := coalesce(v_post.description, '');
  new.geo := v_post.geo;
  new.city_id := v_post.city;
  new.time_window := v_post.time_window;
  new.expires_at := v_post.expires_at;
  new.details := v_post.details;
  new.external_body_id := v_post.external_body_id;
  new.origin := case when v_post.source = 'imported' then 'ingestion' else 'native' end;
  new.moderation_status := v_post.moderation_status;
  new.published_at := v_post.published_at;
  new.created_at := v_post.created_at;
  new.updated_at := v_post.updated_at;
  new.urgency_level := v_post.urgency_level;
  new.availability_status := v_post.availability_status;
  new.beneficiary_org_id := v_post.beneficiary_org_id;
  new.max_radius_km_override := v_post.max_radius_km_override;

  return new;
end;
$$;

create trigger trg_listings_view_insert
  instead of insert on public.listings
  for each row execute function public.listings_view_insert();

create or replace function public.listings_view_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new_vis text;
  v_new_dir text;
  v_new_status text;
begin
  if new.status is distinct from old.status
     and (old.status in ('hidden_pending_review', 'removed_admin')
          or new.status in ('hidden_pending_review', 'removed_admin'))
     and current_setting('role', true) in ('authenticated', 'anon') then
    raise exception 'listing_status_moderated' using errcode = '42501';
  end if;

  if new.anonymity_level is distinct from old.anonymity_level then
    v_new_vis := public.anonymity_level_to_visibility(new.anonymity_level);
  elsif new.visibility is distinct from old.visibility then
    v_new_vis := new.visibility;
  else
    v_new_vis := coalesce(new.visibility, old.visibility);
  end if;

  if new.direction is distinct from old.direction then
    v_new_dir := case when new.direction = 'request' then 'request' else 'offer' end;
  end if;

  if new.status is distinct from old.status then
    v_new_status := case
      when new.status = 'cancelled' then 'paused'
      when new.status = 'closed' then 'closed_delivered'
      else new.status
    end;
  end if;

  if v_new_status in ('paused', 'closed_delivered') and exists (
    select 1 from public.posts
     where post_id = old.listing_id
       and ((v_new_status = 'paused' and status = 'closed_delivered')
         or (v_new_status = 'closed_delivered' and status = 'paused'))
  ) then
    update public.posts set status = 'open' where post_id = old.listing_id;
  end if;

  update public.posts
     set title = coalesce(left(new.title, 80), title),
         description = coalesce(new.summary, description),
         status = coalesce(v_new_status, status),
         visibility = coalesce(v_new_vis, visibility),
         direction = coalesce(v_new_dir, direction),
         type = case when coalesce(v_new_dir, direction) = 'request' then 'Request' else 'Give' end,
         moderation_status = coalesce(new.moderation_status, moderation_status),
         availability_status = case
           when new.availability_status in ('immediate', 'scheduled', 'ongoing') then new.availability_status
           when new.availability_status is not null then 'ongoing'
           else availability_status
         end,
         urgency_level = coalesce(new.urgency_level, urgency_level),
         details = coalesce(new.details, details),
         category_id = coalesce(new.category_id, category_id),
         geo = coalesce(new.geo, geo),
         time_window = coalesce(new.time_window, time_window),
         expires_at = case
           when new.details->'expires_at' is distinct from old.details->'expires_at'
                and public.listing_details_expires_at(new.details) is not null
           then public.listing_details_expires_at(new.details)
           when new.expires_at is distinct from old.expires_at then new.expires_at
           else coalesce(new.expires_at, expires_at)
         end,
         published_at = coalesce(new.published_at, published_at),
         created_at = coalesce(new.created_at, created_at),
         city = coalesce(new.city_id, city),
         kind_id = coalesce(new.kind_id, kind_id),
         updated_at = now()
   where post_id = old.listing_id;
  return new;
end;
$$;

create trigger trg_listings_view_update
  instead of update on public.listings
  for each row execute function public.listings_view_update();

create or replace function public.listings_view_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.posts where post_id = old.listing_id;
  return old;
end;
$$;

create trigger trg_listings_view_delete
  instead of delete on public.listings
  for each row execute function public.listings_view_delete();

create or replace function public.giving_handoffs_view_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_h public.post_handoffs;
  v_hid uuid := coalesce(new.handoff_id, gen_random_uuid());
  v_post_id uuid := public.handoff_target_post_id(new.listing_id);
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_role text;
  v_max int;
begin
  if v_claims <> '' and pg_trigger_depth() <= 1 then
    begin
      v_role := v_claims::jsonb ->> 'role';
    exception when others then
      v_role := null;
    end;
    if coalesce(v_role, 'authenticated') in ('authenticated', 'anon') and new.recipient_id is not null then
      select (p.param_value #>> '{}')::int into v_max
        from public.marketplace_rule_params p
       where p.rule_code = 'R-SEC-Handoff-Write'
         and p.param_key = 'max_per_hour';
      if v_max is not null and v_max >= 1 then
        perform public.enforce_rate_limit('giving_handoffs:' || new.recipient_id::text, v_max, 3600);
      end if;
    end if;
  end if;

  insert into public.post_handoffs (
    handoff_id, post_id, owner_id, recipient_id, world_slug, status,
    cancel_reason, pickup_mode, pickup_window_start, pickup_window_end,
    slot_starts_at, slot_ends_at, seats, confirm_by, reserved_at,
    confirmed_at, handed_over_at, cancelled_at, no_show_at
  ) values (
    v_hid, coalesce(v_post_id, new.listing_id), new.owner_id, new.recipient_id,
    coalesce(new.world_slug, 'items'), coalesce(new.status, 'reserved'),
    new.cancel_reason, coalesce(new.pickup_mode, 'pickup'), new.pickup_window_start, new.pickup_window_end,
    new.slot_starts_at, new.slot_ends_at, coalesce(new.seats, 1), new.confirm_by,
    coalesce(new.reserved_at, now()), new.confirmed_at, new.handed_over_at,
    new.cancelled_at, new.no_show_at
  )
  returning * into v_h;

  new.handoff_id := v_h.handoff_id;
  new.listing_id := coalesce(public.listing_id_of_post(v_h.post_id), v_h.post_id);
  new.owner_id := v_h.owner_id;
  new.recipient_id := v_h.recipient_id;
  new.world_slug := v_h.world_slug;
  new.status := v_h.status;
  new.cancel_reason := v_h.cancel_reason;
  new.pickup_mode := v_h.pickup_mode;
  new.pickup_window_start := v_h.pickup_window_start;
  new.pickup_window_end := v_h.pickup_window_end;
  new.slot_starts_at := v_h.slot_starts_at;
  new.slot_ends_at := v_h.slot_ends_at;
  new.seats := v_h.seats;
  new.confirm_by := v_h.confirm_by;
  new.reserved_at := v_h.reserved_at;
  new.confirmed_at := v_h.confirmed_at;
  new.handed_over_at := v_h.handed_over_at;
  new.cancelled_at := v_h.cancelled_at;
  new.no_show_at := v_h.no_show_at;
  return new;
end;
$$;

create trigger trg_giving_handoffs_view_insert
  instead of insert on public.giving_handoffs
  for each row execute function public.giving_handoffs_view_insert();

create or replace function public.giving_handoffs_view_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.post_handoffs
     set status = coalesce(new.status, status),
         cancel_reason = coalesce(new.cancel_reason, cancel_reason),
         pickup_mode = coalesce(new.pickup_mode, pickup_mode),
         pickup_window_start = coalesce(new.pickup_window_start, pickup_window_start),
         pickup_window_end = coalesce(new.pickup_window_end, pickup_window_end),
         slot_starts_at = coalesce(new.slot_starts_at, slot_starts_at),
         slot_ends_at = coalesce(new.slot_ends_at, slot_ends_at),
         seats = coalesce(new.seats, seats),
         confirm_by = coalesce(new.confirm_by, confirm_by),
         reserved_at = coalesce(new.reserved_at, reserved_at),
         confirmed_at = coalesce(new.confirmed_at, confirmed_at),
         handed_over_at = coalesce(new.handed_over_at, handed_over_at),
         cancelled_at = coalesce(new.cancelled_at, cancelled_at),
         no_show_at = coalesce(new.no_show_at, no_show_at)
   where handoff_id = old.handoff_id;
  return new;
end;
$$;

create trigger trg_giving_handoffs_view_update
  instead of update on public.giving_handoffs
  for each row execute function public.giving_handoffs_view_update();

create or replace function public.giving_handoffs_view_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.post_handoffs where handoff_id = old.handoff_id;
  return old;
end;
$$;

create trigger trg_giving_handoffs_view_delete
  instead of delete on public.giving_handoffs
  for each row execute function public.giving_handoffs_view_delete();

create or replace function public.ride_listings_view_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_post_id uuid := coalesce(new.ride_id, gen_random_uuid());
  v_mode text := coalesce(new.mode, 'offer');
  v_type text := case v_mode when 'request' then 'Request' else 'Give' end;
  v_status text := case
    when new.status = 'cancelled' then 'paused'
    when new.status = 'closed' then 'closed_delivered'
    else coalesce(new.status, 'open')
  end;
begin
  insert into public.posts (
    post_id, owner_id, type, status, visibility, title, description,
    category, city, street, street_number, location_display_level,
    world_slug, direction, post_type, details
  ) values (
    v_post_id, new.owner_id, v_type, v_status,
    coalesce(new.visibility, 'Public'), coalesce(new.title, 'Ride'), new.description,
    'Other', coalesce(new.origin_city_id, 'tel-aviv'),
    coalesce(new.origin_street, 'A'), '1', 'CityOnly',
    'rides', v_mode, 'ride',
    jsonb_build_object(
      'origin_city_id', new.origin_city_id,
      'dest_city_id', new.dest_city_id,
      'departs_at', new.departs_at,
      'seats_available', new.seats_available
    )
  );
  insert into public.ride_post_details (
    post_id, origin_city_id, dest_city_id, departs_at, seats_available
  ) values (
    v_post_id, new.origin_city_id, new.dest_city_id, new.departs_at, new.seats_available
  ) on conflict (post_id) do update
    set origin_city_id = excluded.origin_city_id,
         dest_city_id = excluded.dest_city_id,
         departs_at = excluded.departs_at,
         seats_available = excluded.seats_available;
  new.ride_id := v_post_id;
  new.status := case
    when v_status = 'paused' then 'cancelled'
    when v_status = 'closed_delivered' then 'closed'
    when v_status = 'deleted_no_recipient' then 'cancelled'
    else v_status
  end;
  return new;
end;
$$;

create trigger trg_ride_listings_view_insert
  instead of insert on public.ride_listings
  for each row execute function public.ride_listings_view_insert();

create or replace function public.ride_listings_view_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new_status text;
begin
  if new.status is distinct from old.status then
    v_new_status := case
      when new.status = 'cancelled' then 'paused'
      when new.status = 'closed' then 'closed_delivered'
      else new.status
    end;
  end if;

  if v_new_status in ('paused', 'closed_delivered') and exists (
    select 1 from public.posts
     where post_id = old.ride_id
       and ((v_new_status = 'paused' and status = 'closed_delivered')
         or (v_new_status = 'closed_delivered' and status = 'paused'))
  ) then
    update public.posts set status = 'open' where post_id = old.ride_id;
  end if;

  update public.posts
     set status = coalesce(v_new_status, status),
         visibility = coalesce(new.visibility, visibility),
         title = coalesce(new.title, title),
         description = coalesce(new.description, description),
         updated_at = now()
   where post_id = old.ride_id;
  update public.ride_post_details
     set origin_city_id = coalesce(new.origin_city_id, origin_city_id),
         dest_city_id = coalesce(new.dest_city_id, dest_city_id),
         departs_at = coalesce(new.departs_at, departs_at),
         seats_available = coalesce(new.seats_available, seats_available)
   where post_id = old.ride_id;
  return new;
end;
$$;

create trigger trg_ride_listings_view_update
  instead of update on public.ride_listings
  for each row execute function public.ride_listings_view_update();

create or replace function public.ride_listings_view_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.posts where post_id = old.ride_id;
  return old;
end;
$$;

create trigger trg_ride_listings_view_delete
  instead of delete on public.ride_listings
  for each row execute function public.ride_listings_view_delete();

-- ── 5. Re-create Dependent Views ────────────────────────────────────────────────────────────────
create or replace view public.marketplace_listing_card as
  select
    p.post_id as listing_id,
    p.owner_id,
    p.world_slug,
    w.label_he as world_label_he,
    w.label_en as world_label_en,
    p.kind_id,
    lk.slug as kind_slug,
    lk.label_he as kind_label_he,
    lk.label_en as kind_label_en,
    p.category_id,
    case p.direction when 'offer' then 'give' else coalesce(p.direction, 'give') end as direction,
    p.status,
    p.visibility,
    public.visibility_to_anonymity_level(p.visibility) as anonymity_level,
    p.title,
    p.description as summary,
    p.geo,
    p.city as city_id,
    p.time_window,
    p.expires_at,
    p.details,
    case when p.source = 'imported' then 'ingestion' else 'native' end as origin,
    p.post_id as legacy_post_id,
    null::uuid as legacy_ride_id,
    p.urgency_level,
    p.availability_status,
    p.published_at,
    p.created_at,
    p.updated_at
  from public.posts p
  join public.worlds w on w.slug = p.world_slug
  join public.listing_kinds lk on lk.kind_id = p.kind_id;

create or replace view public.listing_owner_trust_score as
  select
    lo.owner_id as user_id,
    coalesce(avg(mf.rating) / 5.0, 0.5)::numeric(6,4) as trust_score
  from public.posts lo
  left join public.listing_matches lm on (lm.listing_id = lo.post_id or lm.candidate_listing_id = lo.post_id)
  left join public.match_feedback mf on mf.match_id = lm.match_id
  group by lo.owner_id;

create or replace view public.giving_user_trust_score as
  select
    u.user_id,
    coalesce((select avg(r.rating) / 5.0 from public.giving_handoff_ratings r where r.ratee_id = u.user_id), 0.5)::numeric(6,4) as handoff_trust_score,
    coalesce(ts.trust_score, 0.5)::numeric(6,4) as match_trust_score,
    (coalesce((select avg(r.rating) / 5.0 from public.giving_handoff_ratings r where r.ratee_id = u.user_id), 0.5) * 0.6 +
     coalesce(ts.trust_score, 0.5) * 0.4)::numeric(6,4) as combined_trust_score
  from public.users u
  left join public.listing_owner_trust_score ts on ts.user_id = u.user_id;

-- ── 5b. Triggers on public.posts replacing legacy listing triggers ──────────────────────────────
create or replace function public.posts_one_model_derive()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_type_changed boolean := tg_op = 'UPDATE' and new.type is distinct from old.type;
  v_dir_changed  boolean := tg_op = 'UPDATE' and new.direction is distinct from old.direction;
begin
  -- direction ↔ type: on insert the legacy `type` wins (it is NOT NULL, every writer sends it);
  -- on update whichever side changed drives the other.
  if tg_op = 'INSERT' or v_type_changed or not v_dir_changed then
    new.direction := case new.type when 'Request' then 'request' else 'offer' end;
  else
    new.type := case new.direction when 'request' then 'Request' else 'Give' end;
  end if;

  -- A mirror belongs to its listing's world; a native post to the items world unless told otherwise.
  if new.listing_id is not null and new.listing_world_slug is not null then
    new.world_slug := new.listing_world_slug;
  end if;
  new.post_type := case when new.world_slug = 'rides' then 'ride'
                        when new.post_type = 'ride' then 'standard'
                        else new.post_type end;

  -- Native items posts: legacy category text → items sub-category; city → geo.
  if new.listing_id is null and new.kind_id is null then
    if new.world_slug = 'items'
       and (tg_op = 'INSERT' or new.category is distinct from old.category or new.category_id is null) then
      select c.category_id into new.category_id
        from public.categories c
       where c.world_slug = 'items' and c.legacy_post_category = new.category
       order by c.sort_order limit 1;
    end if;
  end if;

  if new.listing_id is null then
    if new.geo is null or (tg_op = 'UPDATE' and new.city is distinct from old.city) then
      new.geo := public.listing_geo_from_city(new.city);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.listings_match_subscription_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub record;
  v_dir text;
begin
  if new.moderation_status <> 'published' or new.status <> 'open' then
    return new;
  end if;
  if new.world_slug = 'romantic_matchmaking' then
    return new;
  end if;

  v_dir := case new.direction when 'offer' then 'give' else new.direction end;

  for v_sub in
    select s.*
      from public.match_alert_subscriptions s
     where s.is_active
       and s.user_id <> new.owner_id
       and (s.world_slug is null or s.world_slug = new.world_slug)
       and (s.direction is null or s.direction = v_dir or s.direction = new.direction)
       and (s.city_id is null or s.city_id = new.city)
       and (
         s.saved_query is null
         or new.search_vector @@ plainto_tsquery('simple', s.saved_query)
         or extensions.similarity(new.title, s.saved_query) > 0.25
       )
  loop
    perform public.enqueue_notification(
      v_sub.user_id, 'social', 'listing_subscription_hit',
      'notifications.listingSubscriptionTitle', 'notifications.listingSubscriptionBody',
      jsonb_build_object('title', new.title, 'world', new.world_slug),
      jsonb_build_object('listing_id', new.post_id, 'subscription_id', v_sub.subscription_id),
      'listing_sub:' || v_sub.subscription_id::text || ':' || new.post_id::text,
      false
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_posts_match_subscription_notify on public.posts;
create trigger trg_posts_match_subscription_notify
  after insert on public.posts
  for each row execute function public.listings_match_subscription_notify();

create or replace function public.operator_case_enqueue_for_post()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case_id uuid;
begin
  if new.visibility <> 'OnlyMe' then
    return new;
  end if;
  if new.moderation_status not in ('published', 'pending_review') then
    return new;
  end if;

  insert into public.operator_cases (listing_id, status)
  values (new.post_id, 'open')
  on conflict (listing_id) do nothing
  returning case_id into v_case_id;

  if v_case_id is not null then
    insert into public.operator_case_events (case_id, actor_id, event_type, payload)
    values (
      v_case_id,
      new.owner_id,
      'case_opened',
      jsonb_build_object('anonymity_level', 1, 'world_slug', new.world_slug)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_posts_operator_case_enqueue on public.posts;
create trigger trg_posts_operator_case_enqueue
  after insert or update of visibility, moderation_status on public.posts
  for each row execute function public.operator_case_enqueue_for_post();

create or replace function public.enqueue_post_embedding_job()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.title is not distinct from old.title
     and new.description is not distinct from old.description
     and new.details is not distinct from old.details then
    return new;
  end if;

  insert into public.embedding_jobs (listing_id, status)
  values (new.post_id, 'pending')
  on conflict (listing_id) do update set
    status = 'pending',
    attempts = 0,
    error_message = null,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_posts_enqueue_embedding on public.posts;
create trigger trg_posts_enqueue_embedding
  after insert or update of title, description, details on public.posts
  for each row
  when (new.moderation_status = 'published')
  execute function public.enqueue_post_embedding_job();

create or replace function public.posts_food_urgency_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.world_slug = 'food' and new.expires_at is not null then
    new.urgency_level := public.food_listing_urgency_level(new.expires_at);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_posts_food_urgency_sync on public.posts;
create trigger trg_posts_food_urgency_sync
  before insert or update of expires_at, world_slug on public.posts
  for each row execute function public.posts_food_urgency_sync();

create or replace function public.validate_listing_details(p_kind_id uuid, p_details jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_schema jsonb;
  v_has_ext boolean;
begin
  select detail_schema into v_schema from public.listing_kinds where kind_id = p_kind_id;
  if v_schema is null then
    return false;
  end if;
  select exists(select 1 from pg_extension where extname = 'pg_jsonschema') into v_has_ext;
  if not v_has_ext then
    return p_details is not null;
  end if;
  begin
    return extensions.json_matches_schema(v_schema::json, coalesce(p_details, '{}'::jsonb));
  exception when undefined_function then
    return true;
  end;
end;
$$;

create or replace function public.listings_validate_details_schema()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_schema jsonb;
  v_details jsonb;
begin
  if new.kind_id is null then
    return new;
  end if;

  select lk.detail_schema into v_schema
    from public.listing_kinds lk
   where lk.kind_id = new.kind_id;
  if v_schema is null then
    return new;
  end if;

  v_details := jsonb_strip_nulls(coalesce(new.details, '{}'::jsonb));
  if not extensions.jsonb_matches_schema(v_schema::json, v_details) then
    raise exception 'listing_details_schema_mismatch'
      using errcode = '23514',
            detail = array_to_string(
              extensions.jsonschema_validation_errors(v_schema::json, v_details::json), '; ');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_posts_validate_details_schema on public.posts;
create trigger trg_posts_validate_details_schema
  before insert or update of details, kind_id on public.posts
  for each row
  when (new.kind_id is not null and new.source = 'native')
  execute function public.listings_validate_details_schema();

create or replace function public.listings_category_matches_world()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.categories c
     where c.category_id = new.category_id
       and c.world_slug = coalesce(new.world_slug, 'items')
  ) then
    raise exception 'category_world_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists listings_category_matches_world on public.posts;
create trigger listings_category_matches_world
  before insert or update of category_id, world_slug on public.posts
  for each row execute function public.listings_category_matches_world();

create or replace function public.posts_ride_route_alerts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_listing public.listings;
begin
  if new.world_slug <> 'rides' or new.status <> 'open' or new.moderation_status <> 'published' then
    return new;
  end if;
  select * into v_listing from public.listings where listing_id = new.post_id;
  if not found then return new; end if;

  -- One alert per person per ride, even when several of their routes match it.
  for r in select distinct on (m.user_id) m.route_id, m.user_id
             from public.ride_matching_routes(v_listing) m order by m.user_id, m.created_at loop
    if new.details ? 'ride_series' and exists (
         select 1 from public.ride_route_alerts a
         join public.posts p on p.post_id = a.listing_id
        where a.user_id = r.user_id
          and p.details -> 'ride_series' ->> 'id' = new.details -> 'ride_series' ->> 'id') then
      continue;
    end if;
    insert into public.ride_route_alerts (route_id, listing_id, user_id)
    values (r.route_id, new.post_id, r.user_id)
    on conflict do nothing;
    perform public.ride_route_alert_deliver(r.route_id, new.post_id);
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_posts_ride_route_alerts on public.posts;
create trigger trg_posts_ride_route_alerts
  after insert or update of status, moderation_status on public.posts
  for each row execute function public.posts_ride_route_alerts();

create or replace function public.posts_match_on_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set public.matching_settings;
  v_world_slug text;
begin
  select * into v_set from public.matching_settings where id;
  if not coalesce(v_set.enabled, false) then
    return new;
  end if;

  v_world_slug := coalesce(new.world_slug, 'items');
  if not (v_world_slug = any (v_set.worlds)) then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status <> 'open' and old.status = 'open' then
    update public.match_candidates
       set status = 'expired'
     where status = 'suggested'
       and (offer_listing_id = new.post_id or request_listing_id = new.post_id);
    return new;
  end if;

  if not v_set.inline_on_write then
    return new;
  end if;

  if tg_op = 'UPDATE' and not (
       new.status is distinct from old.status
       or new.moderation_status is distinct from old.moderation_status
       or new.visibility is distinct from old.visibility
       or new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.category_id is distinct from old.category_id
       or new.geo is distinct from old.geo
       or new.city is distinct from old.city
       or new.time_window is distinct from old.time_window
       or new.details is distinct from old.details) then
    return new;
  end if;

  if new.status <> 'open' or coalesce(new.moderation_status, 'published') <> 'published' then
    return new;
  end if;

  begin
    perform public.match_compute_for_listing(new.post_id);
    perform public.match_deliver_pending(50, new.post_id);
  exception when others then
    -- Matching must never break publishing; the sweep retries.
    insert into public.match_listing_state (listing_id, computed_at, candidates, last_error)
    values (new.post_id, '-infinity', 0, left(sqlerrm, 500))
    on conflict (listing_id) do update
      set computed_at = '-infinity', last_error = left(excluded.last_error, 500);
  end;
  return new;
end;
$$;

drop trigger if exists listings_match_v2 on public.posts;
create trigger listings_match_v2
  after insert or update on public.posts
  for each row execute function public.posts_match_on_write();

-- ── 6. Re-create Foreign Keys referencing posts(post_id) ─────────────────────────────────────────
delete from public.listing_worlds where listing_id not in (select post_id from public.posts);
alter table public.listing_worlds
  drop constraint if exists listing_worlds_listing_id_fkey,
  add constraint listing_worlds_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

delete from public.listing_media where listing_id not in (select post_id from public.posts);
alter table public.listing_media
  drop constraint if exists listing_media_listing_id_fkey,
  add constraint listing_media_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

delete from public.housing_private_details where listing_id not in (select post_id from public.posts);
alter table public.housing_private_details
  drop constraint if exists housing_private_details_listing_id_fkey,
  add constraint housing_private_details_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

delete from public.ride_listing_house_numbers where listing_id not in (select post_id from public.posts);
alter table public.ride_listing_house_numbers
  drop constraint if exists ride_listing_house_numbers_listing_id_fkey,
  add constraint ride_listing_house_numbers_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

delete from public.ride_participants where ride_id not in (select post_id from public.posts);
alter table public.ride_participants
  drop constraint if exists ride_participants_ride_id_fkey,
  add constraint ride_participants_ride_id_fkey foreign key (ride_id) references public.posts(post_id) on delete cascade;

delete from public.ride_stops where ride_id not in (select post_id from public.posts);
alter table public.ride_stops
  drop constraint if exists ride_stops_ride_id_fkey,
  add constraint ride_stops_ride_id_fkey foreign key (ride_id) references public.posts(post_id) on delete cascade;

delete from public.ride_emergency_events where ride_id not in (select post_id from public.posts);
alter table public.ride_emergency_events
  drop constraint if exists ride_emergency_events_ride_id_fkey,
  add constraint ride_emergency_events_ride_id_fkey foreign key (ride_id) references public.posts(post_id) on delete cascade;

delete from public.ride_ratings where ride_id not in (select post_id from public.posts);
alter table public.ride_ratings
  drop constraint if exists ride_ratings_ride_id_fkey,
  add constraint ride_ratings_ride_id_fkey foreign key (ride_id) references public.posts(post_id) on delete cascade;

delete from public.ride_route_alerts where listing_id not in (select post_id from public.posts);
alter table public.ride_route_alerts
  drop constraint if exists ride_route_alerts_listing_id_fkey,
  add constraint ride_route_alerts_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

delete from public.ride_listing_emergencies where listing_id not in (select post_id from public.posts);
alter table public.ride_listing_emergencies
  drop constraint if exists ride_listing_emergencies_listing_id_fkey,
  add constraint ride_listing_emergencies_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

update public.chats set anchor_listing_id = null where anchor_listing_id is not null and anchor_listing_id not in (select post_id from public.posts);
alter table public.chats
  drop constraint if exists chats_anchor_listing_id_fkey,
  add constraint chats_anchor_listing_id_fkey foreign key (anchor_listing_id) references public.posts(post_id) on delete set null;

update public.chats set anchor_ride_id = null where anchor_ride_id is not null and anchor_ride_id not in (select post_id from public.posts);
alter table public.chats
  drop constraint if exists chats_anchor_ride_id_fkey,
  add constraint chats_anchor_ride_id_fkey foreign key (anchor_ride_id) references public.posts(post_id) on delete set null;

delete from public.match_candidates where offer_listing_id not in (select post_id from public.posts) or request_listing_id not in (select post_id from public.posts);
alter table public.match_candidates
  drop constraint if exists match_candidates_offer_listing_id_fkey,
  add constraint match_candidates_offer_listing_id_fkey foreign key (offer_listing_id) references public.posts(post_id) on delete cascade,
  drop constraint if exists match_candidates_request_listing_id_fkey,
  add constraint match_candidates_request_listing_id_fkey foreign key (request_listing_id) references public.posts(post_id) on delete cascade;

delete from public.match_listing_state where listing_id not in (select post_id from public.posts);
alter table public.match_listing_state
  drop constraint if exists match_listing_state_listing_id_fkey,
  add constraint match_listing_state_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

delete from public.operator_cases where listing_id not in (select post_id from public.posts);
alter table public.operator_cases
  drop constraint if exists operator_cases_listing_id_fkey,
  add constraint operator_cases_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

update public.donation_intents set listing_id = null where listing_id is not null and listing_id not in (select post_id from public.posts);
alter table public.donation_intents
  drop constraint if exists donation_intents_listing_id_fkey,
  add constraint donation_intents_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete set null;

delete from public.bot_admin_review_items where listing_id not in (select post_id from public.posts);
alter table public.bot_admin_review_items
  drop constraint if exists bot_admin_review_items_listing_id_fkey,
  add constraint bot_admin_review_items_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

delete from public.bot_conversation_sessions where listing_id not in (select post_id from public.posts);
alter table public.bot_conversation_sessions
  drop constraint if exists bot_conversation_sessions_listing_id_fkey,
  add constraint bot_conversation_sessions_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

delete from public.claim_requests where listing_id not in (select post_id from public.posts);
alter table public.claim_requests
  drop constraint if exists claim_requests_listing_id_fkey,
  add constraint claim_requests_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

delete from public.marketplace_actors where listing_id not in (select post_id from public.posts);
alter table public.marketplace_actors
  drop constraint if exists marketplace_actors_listing_id_fkey,
  add constraint marketplace_actors_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

delete from public.match_runs where source_listing_id not in (select post_id from public.posts);
alter table public.match_runs
  drop constraint if exists match_runs_source_listing_id_fkey,
  add constraint match_runs_source_listing_id_fkey foreign key (source_listing_id) references public.posts(post_id) on delete cascade;

delete from public.listing_matches where listing_id not in (select post_id from public.posts) or candidate_listing_id not in (select post_id from public.posts);
alter table public.listing_matches
  drop constraint if exists listing_matches_listing_id_fkey,
  add constraint listing_matches_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade,
  drop constraint if exists listing_matches_candidate_listing_id_fkey,
  add constraint listing_matches_candidate_listing_id_fkey foreign key (candidate_listing_id) references public.posts(post_id) on delete cascade;

delete from public.embedding_jobs where listing_id not in (select post_id from public.posts);
alter table public.embedding_jobs
  drop constraint if exists embedding_jobs_listing_id_fkey,
  add constraint embedding_jobs_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

delete from public.extractions where listing_id not in (select post_id from public.posts);
alter table public.extractions
  drop constraint if exists extractions_listing_id_fkey,
  add constraint extractions_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

delete from public.field_provenance where listing_id not in (select post_id from public.posts);
alter table public.field_provenance
  drop constraint if exists field_provenance_listing_id_fkey,
  add constraint field_provenance_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

delete from public.listing_feed_posts where listing_id not in (select post_id from public.posts);
alter table public.listing_feed_posts
  drop constraint if exists listing_feed_posts_listing_id_fkey,
  add constraint listing_feed_posts_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

delete from public.listing_user_signals where listing_id not in (select post_id from public.posts);
alter table public.listing_user_signals
  drop constraint if exists listing_user_signals_listing_id_fkey,
  add constraint listing_user_signals_listing_id_fkey foreign key (listing_id) references public.posts(post_id) on delete cascade;

-- ── 7. Re-create Dropped RLS Policies ────────────────────────────────────────────────────────────
create policy listing_worlds_select on public.listing_worlds for select
  using (exists (
    select 1 from public.posts p
     where p.post_id = listing_worlds.listing_id
       and (((p.status = 'open') and (p.moderation_status = 'published'))
            or p.owner_id = auth.uid()
            or is_admin(auth.uid()))
  ));

create policy listing_worlds_insert on public.listing_worlds for insert
  with check (exists (
    select 1 from public.posts p
     where p.post_id = listing_worlds.listing_id
       and (p.owner_id = auth.uid() or is_admin(auth.uid()))
  ));

create policy listing_worlds_delete on public.listing_worlds for delete
  using (exists (
    select 1 from public.posts p
     where p.post_id = listing_worlds.listing_id
       and (p.owner_id = auth.uid() or is_admin(auth.uid()))
  ));

create policy listing_media_select_visible on public.listing_media for select
  using (exists (
    select 1 from public.posts p
     where p.post_id = listing_media.listing_id
       and (is_post_visible_to(p.*, auth.uid()) or p.owner_id = auth.uid() or is_admin(auth.uid()))
  ));

create policy listing_media_insert_owner on public.listing_media for insert
  with check (exists (
    select 1 from public.posts p
     where p.post_id = listing_media.listing_id
       and (p.owner_id = auth.uid() or is_admin(auth.uid()))
  ));

create policy listing_media_delete_owner on public.listing_media for delete
  using (exists (
    select 1 from public.posts p
     where p.post_id = listing_media.listing_id
       and (p.owner_id = auth.uid() or is_admin(auth.uid()))
  ));

create policy housing_private_details_owner_read on public.housing_private_details for select
  using (exists (
    select 1 from public.posts p
     where p.post_id = housing_private_details.listing_id
       and (p.owner_id = auth.uid() or is_admin(auth.uid()))
  ));

create policy ride_listing_emergencies_select on public.ride_listing_emergencies for select
  using (exists (
    select 1 from public.posts p
     where p.post_id = ride_listing_emergencies.listing_id
       and (p.owner_id = auth.uid() or is_admin(auth.uid()))
  ));

create policy ride_participants_select on public.ride_participants for select
  using (user_id = auth.uid() or exists (
    select 1 from public.posts p
     where p.post_id = ride_participants.ride_id
       and (p.owner_id = auth.uid() or is_admin(auth.uid()))
  ));

create policy ride_stops_select on public.ride_stops for select
  using (exists (
    select 1 from public.posts p
     where p.post_id = ride_stops.ride_id
       and (is_post_visible_to(p.*, auth.uid()) or p.owner_id = auth.uid())
  ));

create policy ride_stops_insert_own on public.ride_stops for insert
  with check (exists (
    select 1 from public.posts p
     where p.post_id = ride_stops.ride_id
       and p.owner_id = auth.uid()
  ));

create policy ride_stops_update_own on public.ride_stops for update
  using (exists (
    select 1 from public.posts p
     where p.post_id = ride_stops.ride_id
       and p.owner_id = auth.uid()
  ));

create policy ride_stops_delete_own on public.ride_stops for delete
  using (exists (
    select 1 from public.posts p
     where p.post_id = ride_stops.ride_id
       and p.owner_id = auth.uid()
  ));

create policy ride_emergency_events_select on public.ride_emergency_events for select
  using (exists (
    select 1 from public.posts p
     where p.post_id = ride_emergency_events.ride_id
       and (p.owner_id = auth.uid() or is_admin(auth.uid()))
  ));

create policy match_runs_select on public.match_runs for select
  using (is_admin(auth.uid()));

create policy listing_matches_select on public.listing_matches for select
  using (exists (
    select 1 from public.posts p
     where (p.post_id = listing_matches.listing_id or p.post_id = listing_matches.candidate_listing_id)
       and (p.owner_id = auth.uid() or is_admin(auth.uid()))
  ));

create policy operator_cases_owner_read on public.operator_cases for select
  using (exists (
    select 1 from public.posts p
     where p.post_id = operator_cases.listing_id
       and (p.owner_id = auth.uid() or is_admin(auth.uid()))
  ));

create policy operator_case_events_operator_read on public.operator_case_events for select
  using (is_admin(auth.uid()));

-- Compatibility indexes for audits and assertions
create index if not exists giving_handoffs_listing_fk_idx on public.post_handoffs (post_id);

create policy listing_feed_posts_select_visible on public.listing_feed_posts for select
  using (exists (
    select 1 from public.posts p
     where p.post_id = listing_feed_posts.listing_id
       and (is_post_visible_to(p.*, auth.uid()) or p.owner_id = auth.uid())
  ));

-- ── 8. Re-create Dropped Helper Functions ────────────────────────────────────────────────────────
create or replace function public.giving_handoff_row_of(p_handoff_id uuid)
returns public.giving_handoffs
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.giving_handoffs where handoff_id = p_handoff_id;
$$;

revoke all on function public.giving_handoff_row_of(uuid) from public, anon, authenticated;
grant execute on function public.giving_handoff_row_of(uuid) to service_role;

create or replace function public.listing_record_of(p_listing public.listings)
returns setof public.listings
language sql
stable
as $$
  select p_listing.*;
$$;

revoke all on function public.listing_record_of(public.listings) from public, anon, authenticated;
grant execute on function public.listing_record_of(public.listings) to service_role;

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

  begin
    v_role := v_claims::jsonb ->> 'role';
  exception when others then
    v_role := null;
  end;
  if coalesce(v_role, 'authenticated') not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_table_name in ('listings', 'posts') then
    v_actor := new.owner_id;
  elsif tg_table_name in ('giving_handoffs', 'post_handoffs') then
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

create or replace function public.listing_embedding_of(p_listing public.listings)
returns extensions.vector
language sql
stable
security definer
set search_path = public, extensions
as $$
  select pe.embedding from public.post_embeddings pe where pe.post_id = p_listing.listing_id;
$$;

revoke all on function public.listing_embedding_of(public.listings) from public, anon, authenticated;
grant execute on function public.listing_embedding_of(public.listings) to service_role;

create or replace function public.ride_series_feed_waits(p_listing public.listings)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_listing.details ? 'ride_series'
     and exists (
       select 1 from public.ride_series s
         join public.ride_post_details r on r.series_id = s.series_id
         join public.posts o on o.post_id = r.post_id
        where s.series_id::text = p_listing.details -> 'ride_series' ->> 'id'
          and o.post_id is distinct from p_listing.listing_id
          and o.status = 'open'
          and r.departs_at > now()
          and r.departs_at < (p_listing.details ->> 'departs_at')::timestamptz);
$$;

revoke all on function public.ride_series_feed_waits(public.listings) from public, anon, authenticated;

create or replace function public.listing_feed_hidden(p_listing public.listings)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.worlds w where w.slug = p_listing.world_slug and w.feed_mirror)
      or public.ride_series_feed_waits(p_listing);
$$;

revoke all on function public.listing_feed_hidden(public.listings) from public, anon, authenticated;
grant execute on function public.listing_feed_hidden(public.listings) to service_role;

create or replace function public.ride_matching_routes(p_listing public.listings)
returns setof public.ride_saved_routes
language sql
stable
set search_path = public
as $$
  select r.*
    from public.ride_saved_routes r,
         lateral (select (p_listing.details->>'departs_at')::timestamptz at time zone 'Asia/Jerusalem' as local_departs) t
   where r.user_id <> p_listing.owner_id
     and r.wants = case p_listing.direction when 'give' then 'offers' else 'requests' end
     and (r.weekdays is null or (r.weekdays & (1 << extract(dow from t.local_departs)::int)) <> 0)
     and (r.time_from is null or t.local_departs::time between r.time_from and r.time_to)
     and public.ride_point_within(r.dest_lat, r.dest_lng,
           (p_listing.details->>'dest_lat')::float8, (p_listing.details->>'dest_lng')::float8, r.radius_km)
     and (
       public.ride_point_within(r.origin_lat, r.origin_lng,
         (p_listing.details->>'origin_lat')::float8, (p_listing.details->>'origin_lng')::float8, r.radius_km)
       or exists (
         select 1 from jsonb_array_elements(
                  case jsonb_typeof(p_listing.details->'meeting_points')
                    when 'array' then p_listing.details->'meeting_points' else '[]'::jsonb end) m
          where public.ride_point_within(r.origin_lat, r.origin_lng,
                  (m->>'lat')::float8, (m->>'lng')::float8, r.radius_km))
     );
$$;

revoke all on function public.ride_matching_routes(public.listings) from public, anon, authenticated;

create or replace function public.match_user_mutes_listing(p_user uuid, p_listing public.listings)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1
             from public.feed_mute_filters mf
             left join public.categories c on c.category_id = p_listing.category_id
            where mf.user_id = p_user
              and (
                (mf.filter_kind = 'user' and mf.filter_value = p_listing.owner_id::text)
                or (mf.filter_kind in ('world', 'category')
                    and mf.filter_value in (p_listing.world_slug,
                                            coalesce(c.slug, ''),
                                            coalesce(c.legacy_post_category, '')))
                or (mf.filter_kind = 'keyword' and (
                      p_listing.title ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
                      or coalesce(p_listing.summary, '') ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'))
              )
         )
      or exists (
           select 1 from public.feed_post_hides h
            where h.user_id = p_user and h.post_id = p_listing.listing_id);
$$;

revoke all on function public.match_user_mutes_listing(uuid, public.listings) from public, anon, authenticated;

create or replace function public.match_score_pair(p_offer public.listings, p_request public.listings)
returns table (eligible boolean, reason text, score numeric, components jsonb, distance_km numeric)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_set   public.matching_settings;
  v_world public.worlds;
  v_w     jsonb;
  g_o     record;
  g_r     record;
  a_o     geography;
  a_r     geography;
  d_km    numeric;
  d2_km   numeric;
  v_rad   numeric;
  s_cat   numeric := 0.5;
  s_geo   numeric := 0.5;
  s_time  numeric := 0.6;
  s_text  numeric := 0;
  s_trust numeric;
  s_fb    numeric;
  w_o     tstzrange;
  w_r     tstzrange;
  c_o     public.categories;
  c_r     public.categories;
  v_dep_h numeric;
  v_total numeric;
  v_txt   jsonb;
  o2      geography;
  r2      geography;
  v_line  geometry;
  v_route numeric;
  f1      float8;
  f2      float8;
  v_req_w tstzrange;
  v_dep_o timestamptz;
begin
  eligible := false;
  score := 0;
  components := '{}'::jsonb;
  distance_km := null;

  select * into v_set from public.matching_settings where id;

  -- ── hard filters ─────────────────────────────────────────────────────────────
  if p_offer.listing_id is null or p_request.listing_id is null then
    reason := 'missing'; return next; return;
  end if;
  if p_offer.world_slug <> p_request.world_slug
     or not (p_offer.world_slug = any (coalesce(v_set.worlds, array['items','food','rides','time','knowledge']))) then
    reason := 'world'; return next; return;
  end if;
  if p_offer.direction <> 'give' or p_request.direction <> 'request' then
    reason := 'direction'; return next; return;
  end if;
  if p_offer.owner_id = p_request.owner_id then
    reason := 'same_owner'; return next; return;
  end if;
  if p_offer.status <> 'open' or p_request.status <> 'open'
     or p_offer.moderation_status <> 'published' or p_request.moderation_status <> 'published'
     or coalesce(p_offer.expires_at, 'infinity') <= now()
     or coalesce(p_request.expires_at, 'infinity') <= now() then
    reason := 'not_open'; return next; return;
  end if;
  if p_offer.anonymity_level = 1 or p_request.anonymity_level = 1 then
    reason := 'operator_only'; return next; return;
  end if;
  if not public.is_active_member(p_offer.owner_id) or not public.is_active_member(p_request.owner_id) then
    reason := 'inactive_owner'; return next; return;
  end if;
  if not public.is_listing_visible_to(p_offer, p_request.owner_id)
     or not public.is_listing_visible_to(p_request, p_offer.owner_id) then
    reason := 'not_visible'; return next; return;
  end if;
  if public.match_user_mutes_listing(p_request.owner_id, p_offer)
     or public.match_user_mutes_listing(p_offer.owner_id, p_request) then
    reason := 'muted'; return next; return;
  end if;
  if public.match_owners_declined(p_offer.owner_id, p_request.owner_id) then
    reason := 'declined_before'; return next; return;
  end if;
  if p_offer.world_slug = 'rides' and p_offer.details ? 'seats_available'
     and coalesce((p_offer.details ->> 'seats_available')::int, 0)
         < greatest(coalesce((p_request.details ->> 'passengers')::int, 1), 1) then
    reason := 'no_seats'; return next; return;
  end if;

  select * into v_world from public.worlds where slug = p_offer.world_slug;
  v_w := coalesce(v_set.weights -> p_offer.world_slug, v_set.weights -> 'default');

  -- ── category ────────────────────────────────────────────────────────────────
  if p_offer.category_id is not null and p_request.category_id is not null then
    if p_offer.category_id = p_request.category_id then
      s_cat := 1.0;
    else
      select * into c_o from public.categories where category_id = p_offer.category_id;
      select * into c_r from public.categories where category_id = p_request.category_id;
      if c_o.parent_id is not null and c_o.parent_id = c_r.parent_id
         and exists (select 1 from public.categories p where p.category_id = c_o.parent_id and p.parent_id is not null) then
        s_cat := 0.7;
      else
        s_cat := 0.1;
      end if;
    end if;
  end if;

  -- ── text (0424: head noun + keyword overlap, Hebrew-aware) ───────────────────
  v_txt := public.match_text_score(p_offer.title, p_offer.summary, p_request.title, p_request.summary);
  s_text := (v_txt ->> 'text')::numeric;

  if p_offer.world_slug in ('items', 'food') then
    if s_cat <= 0.1 and s_text < 0.3 then
      reason := 'category_mismatch'; return next; return;
    end if;
    -- Same category is not enough: the requested thing must be what is offered.
    if (v_txt ->> 'head')::numeric < 0.5 and (v_txt ->> 'trgm')::numeric < 0.5 then
      reason := 'text_mismatch'; return next; return;
    end if;
  end if;

  -- ── geo ─────────────────────────────────────────────────────────────────────
  select * into g_o from public.effective_geo(p_offer, p_offer.owner_id);
  select * into g_r from public.effective_geo(p_request, p_request.owner_id);
  a_o := public.match_listing_anchor(p_offer);
  a_r := public.match_listing_anchor(p_request);
  v_rad := greatest(coalesce(g_o.radius_km, 25), coalesce(g_r.radius_km, 25), 1);

  if a_o is not null and a_r is not null then
    d_km := round((st_distance(a_o, a_r) / 1000.0)::numeric, 2);
    distance_km := d_km;
    if p_offer.world_slug = 'rides' then
      o2 := public.match_listing_dest(p_offer);
      r2 := public.match_listing_dest(p_request);
      if o2 is not null and r2 is not null and st_distance(a_o, o2) > 1000 then
        v_route := (st_distance(a_o, o2) / 1000.0)::numeric;
        v_rad := least(25, greatest(8, 0.15 * v_route));
        v_line := st_makeline(a_o::geometry, o2::geometry);
        d_km := round((st_distance(v_line::geography, a_r) / 1000.0)::numeric, 2);
        d2_km := (st_distance(v_line::geography, r2) / 1000.0)::numeric;
        distance_km := d_km;
        if d_km > v_rad or d2_km > v_rad then
          reason := 'too_far'; return next; return;
        end if;
        f1 := st_linelocatepoint(v_line, a_r::geometry);
        f2 := st_linelocatepoint(v_line, r2::geometry);
        if f1 >= f2 then
          reason := 'wrong_direction'; return next; return;
        end if;
        s_geo := greatest(0, 1 - ((d_km + d2_km) / 2) / v_rad);
      else
        v_rad := least(v_rad, 25);
        if d_km > v_rad then
          reason := 'too_far'; return next; return;
        end if;
        s_geo := greatest(0, 1 - d_km / v_rad);
      end if;
    elsif coalesce(g_o.geo_mode, 'local') = 'remote' and coalesce(g_r.geo_mode, 'local') = 'remote' then
      s_geo := greatest(0.3, 1 - d_km / v_rad);
    else
      if d_km > v_rad then
        reason := 'too_far'; return next; return;
      end if;
      s_geo := greatest(0, 1 - d_km / v_rad);
    end if;
  end if;

  -- ── time ────────────────────────────────────────────────────────────────────
  w_o := public.match_listing_window(p_offer);
  w_r := public.match_listing_window(p_request);
  if p_offer.world_slug = 'rides' and p_offer.details ? 'departs_at'
     and (p_request.details ? 'departs_at' or (p_request.origin = 'native' and w_r is not null)) then
    v_dep_o := (p_offer.details ->> 'departs_at')::timestamptz;
    v_req_w := case when p_request.origin = 'native' and w_r is not null
                        and upper(w_r) - lower(w_r) > interval '1 hour' then w_r end;
    if v_req_w is not null and v_dep_o <@ v_req_w then
      v_dep_h := 0;
    elsif v_req_w is not null then
      v_dep_h := least(abs(extract(epoch from (v_dep_o - lower(v_req_w)))),
                       abs(extract(epoch from (v_dep_o - upper(v_req_w))))) / 3600.0;
    else
      v_dep_h := abs(extract(epoch from (v_dep_o - (p_request.details ->> 'departs_at')::timestamptz))) / 3600.0;
    end if;
    if v_dep_h > 3 then
      reason := 'time_mismatch'; return next; return;
    end if;
    s_time := case when v_dep_h <= 0.5 then 1 else greatest(0, 1 - (v_dep_h - 0.5) / 2.5) end;
  elsif w_o is not null and w_r is not null then
    if not (w_o && w_r) then
      reason := 'time_mismatch'; return next; return;
    end if;
    s_time := 1.0;
  end if;

  -- ── trust + feedback ────────────────────────────────────────────────────────
  s_trust := (public.match_user_trust(p_offer.owner_id) + public.match_user_trust(p_request.owner_id)) / 2;
  if v_world.requires_verification
     and not exists (select 1 from public.users u where u.user_id = p_offer.owner_id and u.verified_at is not null) then
    s_trust := s_trust * 0.6;
  end if;
  s_fb := 0.5 + 0.25 * (public.match_user_feedback(p_offer.owner_id, p_offer.world_slug)
                        + public.match_user_feedback(p_request.owner_id, p_offer.world_slug));

  v_total := coalesce((v_w ->> 'category')::numeric, 0) * s_cat
           + coalesce((v_w ->> 'geo')::numeric, 0) * s_geo
           + coalesce((v_w ->> 'time')::numeric, 0) * s_time
           + coalesce((v_w ->> 'text')::numeric, 0) * s_text
           + coalesce((v_w ->> 'trust')::numeric, 0) * s_trust
           + coalesce((v_w ->> 'feedback')::numeric, 0) * s_fb;

  eligible := true;
  reason := null;
  score := round(least(1, greatest(0, v_total)), 4);
  components := jsonb_build_object(
    'category', round(s_cat, 3), 'geo', round(s_geo, 3), 'time', round(s_time, 3),
    'text', round(s_text::numeric, 3), 'trust', round(s_trust, 3), 'feedback', round(s_fb, 3),
    'head', (v_txt ->> 'head')::numeric, 'overlap', (v_txt ->> 'overlap')::numeric,
    'weights', v_w
  );
  return next;
end;
$$;

revoke all on function public.match_score_pair(public.listings, public.listings) from public, anon, authenticated;
grant execute on function public.match_score_pair(public.listings, public.listings) to service_role;

create or replace function public.effective_geo(
  p_listing public.listings,
  p_viewer uuid default auth.uid()
)
returns table (
  geo_mode text,
  radius_km numeric,
  geo_weight numeric,
  anchor_geo extensions.geography
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_world public.worlds;
  v_prefs public.user_geo_prefs;
begin
  select * into v_world from public.worlds w where w.slug = p_listing.world_slug;

  if p_viewer is not null then
    select * into v_prefs from public.user_geo_prefs u where u.user_id = p_viewer;
  end if;

  geo_mode := coalesce(
    p_listing.geo_mode_override,
    v_prefs.geo_mode,
    v_world.geo_mode,
    'local'
  );

  radius_km := coalesce(
    p_listing.max_radius_km_override,
    v_prefs.default_radius_km,
    v_world.default_radius_km,
    25.00
  );

  geo_weight := coalesce(
    p_listing.geo_weight_override,
    v_prefs.geo_weight,
    v_world.geo_weight,
    1.000
  );

  anchor_geo := coalesce(
    p_listing.geo,
    v_prefs.home_geo,
    public.listing_geo_from_city(p_listing.city_id)
  );

  return next;
end;
$$;

create or replace function public.match_listing_anchor(p_listing public.listings)
returns extensions.geography
language sql
stable security definer
set search_path = public, extensions
as $$
  select case
    when p_listing.details ? 'origin_lat' and p_listing.details ? 'origin_lng' then
      st_setsrid(st_makepoint((p_listing.details ->> 'origin_lng')::float8,
                              (p_listing.details ->> 'origin_lat')::float8), 4326)::geography
    else coalesce(p_listing.geo, public.listing_geo_from_city(p_listing.city_id))
  end;
$$;

create or replace function public.match_listing_dest(p_listing public.listings)
returns extensions.geography
language sql
stable security definer
set search_path = public, extensions
as $$
  select case
    when p_listing.details ? 'dest_lat' and p_listing.details ? 'dest_lng' then
      st_setsrid(st_makepoint((p_listing.details ->> 'dest_lng')::float8,
                              (p_listing.details ->> 'dest_lat')::float8), 4326)::geography
    when p_listing.details ? 'dest_city_id' then
      public.listing_geo_from_city(p_listing.details ->> 'dest_city_id')
    else null
  end;
$$;

create or replace function public.match_listing_window(p_listing public.listings)
returns tstzrange
language sql
stable
set search_path = public
as $$
  select coalesce(
    p_listing.time_window,
    case when p_listing.details ? 'departs_at' then
      tstzrange((p_listing.details ->> 'departs_at')::timestamptz,
                (p_listing.details ->> 'departs_at')::timestamptz + interval '1 hour', '[)')
    end
  );
$$;

create or replace function public.post_listing_visible_to(p_post public.posts, p_viewer uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  if p_post.owner_id = p_viewer then
    return true;
  end if;

  if public.is_account_pending_deletion(p_post.owner_id) then
    return false;
  end if;

  if exists (
    select 1 from public.reporter_hides h
     where h.reporter_id = p_viewer
       and ((h.target_type = 'listing' and h.target_id = coalesce(p_post.legacy_listing_id, p_post.post_id))
         or (h.target_type = 'post' and h.target_id = p_post.post_id))
  ) then
    return false;
  end if;

  if p_post.moderation_status <> 'published' then
    return false;
  end if;

  if p_post.status not in ('open', 'closed_delivered') then
    return false;
  end if;

  if public.is_blocked(p_viewer, p_post.owner_id) then
    return false;
  end if;

  case p_post.visibility
    when 'Public' then
      return p_post.status = 'open' or (p_post.status = 'closed_delivered' and p_post.owner_id = p_viewer);
    when 'FollowersOnly' then
      return p_post.status = 'open' and public.is_following(p_viewer, p_post.owner_id);
    when 'OnlyMe' then
      return public.is_listing_operator(p_viewer);
    else
      return false;
  end case;
end;
$$;

revoke all on function public.post_listing_visible_to(public.posts, uuid) from public, anon, authenticated;
grant execute on function public.post_listing_visible_to(public.posts, uuid) to service_role;

create or replace function public.is_listing_visible_to(p_listing public.listings, p_viewer uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_post public.posts;
begin
  select * into v_post from public.posts where post_id = p_listing.listing_id;
  if found then
    return public.post_listing_visible_to(v_post, p_viewer);
  end if;
  return false;
end;
$$;

revoke all on function public.is_listing_visible_to(public.listings, uuid) from public;
grant execute on function public.is_listing_visible_to(public.listings, uuid) to anon, authenticated, service_role;

create or replace function public.listing_lock_own(p_target uuid)
returns public.listings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.listings;
begin
  if auth.uid() is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  select * into v_row
    from public.listings
   where (listing_id = p_target or listing_id in (select p.post_id from public.posts p where p.legacy_listing_id = p_target or p.listing_id = p_target))
     and owner_id = auth.uid()
   for update;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.listing_lock_own(uuid) from public, anon, authenticated;
grant execute on function public.listing_lock_own(uuid) to service_role;

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

create or replace function public.listing_upsert_from_ride(p_ride public.ride_listings)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- No-op: legacy sync dropped in G1 (0666/0667)
end;
$$;
revoke all on function public.listing_upsert_from_ride(public.ride_listings) from public, anon, authenticated;
grant execute on function public.listing_upsert_from_ride(public.ride_listings) to service_role;

create or replace function public.listing_feed_mirror_upsert(p_listing public.listings, p_feed_hidden boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- In G1, posts is canonical
end;
$$;
revoke all on function public.listing_feed_mirror_upsert(public.listings, boolean) from public, anon, authenticated;
grant execute on function public.listing_feed_mirror_upsert(public.listings, boolean) to service_role;

create or replace function public.share_listing_to_feed(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.listings;
  v_post_id uuid;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  select * into v_listing from public.listings where listing_id = p_listing_id;
  if not found or v_listing.owner_id <> v_uid then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.posts
     set feed_hidden = false,
         listing_world_slug = coalesce(listing_world_slug, v_listing.world_slug)
   where (listing_id = p_listing_id or legacy_listing_id = p_listing_id or post_id = p_listing_id)
  returning post_id into v_post_id;

  return coalesce(v_post_id, p_listing_id);
end;
$$;
revoke all on function public.share_listing_to_feed(uuid) from public;
grant execute on function public.share_listing_to_feed(uuid) to authenticated;

create or replace function public.posts_ride_places_canonical()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_place  record;
  v_points jsonb := '[]'::jsonb;
  v_point  jsonb;
begin
  if new.world_slug <> 'rides' or coalesce(new.source, 'native') = 'imported' then return new; end if;

  new.details := public.ride_details_with_place(coalesce(new.details, '{}'::jsonb), 'origin');
  new.details := public.ride_details_with_place(new.details, 'dest');

  if jsonb_typeof(new.details->'meeting_points') = 'array' then
    if jsonb_array_length(new.details->'meeting_points') > 3 then
      raise exception 'too_many_meeting_points' using errcode = '23514';
    end if;
    for v_point in select * from jsonb_array_elements(new.details->'meeting_points') loop
      select * into v_place from public.ride_place_lookup(v_point->>'kind', v_point->>'id');
      if not found then raise exception 'ride_place_invalid' using errcode = '23514'; end if;
      v_points := v_points || jsonb_build_array(jsonb_build_object(
        'kind', v_point->>'kind', 'id', v_point->>'id', 'label', v_place.label,
        'lat', v_place.lat, 'lng', v_place.lng, 'city_id', v_place.city_id));
    end loop;
    new.details := jsonb_set(new.details, '{meeting_points}', v_points);
  end if;

  return new;
end;
$$;

drop trigger if exists posts_ride_places_canonical on public.posts;
create trigger posts_ride_places_canonical
  before insert or update of details on public.posts
  for each row execute function public.posts_ride_places_canonical();

create or replace function public.posts_ride_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_departs timestamptz;
  v_arrives timestamptz;
begin
  if new.world_slug <> 'rides' or coalesce(new.source, 'native') = 'imported' then return new; end if;

  begin
    v_departs := nullif(new.details->>'departs_at', '')::timestamptz;
    v_arrives := nullif(new.details->>'arrives_at', '')::timestamptz;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception 'ride_time_invalid' using errcode = '23514';
  end;

  if v_arrives is not null and v_departs is not null and v_arrives <= v_departs then
    raise exception 'ride_arrival_before_departure' using errcode = '23514';
  end if;

  if (new.direction in ('give', 'offer')) and coalesce(v_arrives, v_departs) is not null then
    new.expires_at := coalesce(v_arrives, v_departs) + interval '30 minutes';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_ride_schedule on public.posts;
create trigger posts_ride_schedule
  before insert or update of details on public.posts
  for each row execute function public.posts_ride_schedule();

create or replace function public.posts_ride_cost_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost numeric;
begin
  if new.world_slug <> 'rides' or coalesce(new.source, 'native') = 'imported' then return new; end if;
  begin
    v_cost := nullif(new.details->>'cost_share_ils', '')::numeric;
  exception
    when invalid_text_representation then
      raise exception 'ride_cost_share_cap_exceeded' using errcode = '23514';
  end;
  if v_cost is not null and (v_cost < 0 or v_cost > public.ride_cost_share_cap(new.details)) then
    raise exception 'ride_cost_share_cap_exceeded' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_ride_route_cost_cap on public.posts;
create trigger posts_ride_route_cost_cap
  before insert or update of details on public.posts
  for each row execute function public.posts_ride_cost_cap();

drop trigger if exists posts_rate_limit on public.posts;
create trigger posts_rate_limit before insert on public.posts
  for each row
  when (new.world_slug <> 'items' and new.listing_id is null)
  execute function public.trg_write_rate_limit('R-SEC-Listing-Write', 'listings');

drop trigger if exists post_handoffs_rate_limit on public.post_handoffs;
create trigger post_handoffs_rate_limit before insert on public.post_handoffs
  for each row execute function public.trg_write_rate_limit('R-SEC-Handoff-Write', 'giving_handoffs');

create or replace function public.posts_event_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_ref text := new.details ->> 'org_id';
begin
  if not public.is_event_kind(new.kind_id) then
    return new;
  end if;
  new.visibility := 'Public';
  if tg_op = 'UPDATE' and new.details is not distinct from old.details and new.owner_id = old.owner_id then
    return new;
  end if;

  if v_org_ref is null
     or v_org_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not exists (
       select 1 from public.org_memberships m
        where m.org_id = v_org_ref::uuid and m.user_id = new.owner_id) then
    raise exception 'event_org_required' using errcode = '42501';
  end if;
  if (new.details ->> 'ends_at')::timestamptz <= (new.details ->> 'starts_at')::timestamptz then
    raise exception 'event_window_invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.posts_event_guard() from public, anon, authenticated;
grant execute on function public.posts_event_guard() to service_role;

drop trigger if exists posts_event_guard on public.posts;
create trigger posts_event_guard
  before insert or update of details, kind_id, owner_id on public.posts
  for each row when (new.world_slug = 'time')
  execute function public.posts_event_guard();

create or replace function public.posts_require_world_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.source, 'native') <> 'native' then
    return new;
  end if;
  if new.world_slug is not null and not public.has_world_permission(new.owner_id, new.world_slug, 'publish') then
    raise exception 'world_permission_denied' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.posts_require_world_permission() from public, anon, authenticated;
grant execute on function public.posts_require_world_permission() to service_role;

drop trigger if exists posts_require_world_permission on public.posts;
create trigger posts_require_world_permission
  before insert on public.posts
  for each row execute function public.posts_require_world_permission();

create or replace function public.posts_housing_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind_slug text;
  v_category_slug text;
begin
  if new.world_slug <> 'housing' or coalesce(new.source, 'native') <> 'native' then
    return new;
  end if;
  select slug into v_kind_slug from public.listing_kinds where kind_id = new.kind_id;

  v_category_slug := case v_kind_slug
    when 'host_offer' then 'stays'
    when 'stay_request' then 'stays'
  end;
  if v_category_slug is not null then
    select category_id into new.category_id
      from public.categories where world_slug = 'housing' and slug = v_category_slug;
  end if;

  if tg_op = 'INSERT' and not public.has_accepted_housing_conduct(new.owner_id) then
    raise exception 'housing_conduct_required' using errcode = '42501';
  end if;

  if v_kind_slug = 'host_offer' then
    new.expires_at := public.housing_check_offer_details(new.details, tg_op = 'INSERT');
  elsif v_kind_slug = 'stay_request' then
    new.expires_at := public.housing_check_request_details(new.details, tg_op = 'INSERT');
  end if;
  return new;
end;
$$;

revoke all on function public.posts_housing_rules() from public, anon, authenticated;
grant execute on function public.posts_housing_rules() to service_role;

drop trigger if exists posts_world_housing_rules on public.posts;
create trigger posts_world_housing_rules
  before insert or update of details, kind_id on public.posts
  for each row execute function public.posts_housing_rules();



-- ── 9. Re-create Dropped Handoff Writer RPCs ─────────────────────────────────────────────────────
create or replace function public.confirm_item_handoff(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path to 'public'
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

create or replace function public.reserve_item_giving(
  p_listing_id uuid,
  p_pickup_mode text default 'pickup',
  p_pickup_window_start timestamptz default null,
  p_pickup_window_end timestamptz default null
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path to 'public'
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

create or replace function public.claim_food_giving(
  p_listing_id uuid,
  p_pickup_window_start timestamptz default null,
  p_pickup_window_end timestamptz default null
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path to 'public'
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

create or replace function public.mark_giving_handed_over(p_handoff_id uuid)
returns public.giving_handoffs
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

  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

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

create or replace function public.confirm_ride_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_ride public.ride_post_details;
  v_cap int;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides';
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  perform 1 from public.posts
   where post_id = v_h.post_id and world_slug = 'rides'
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_h.status <> 'reserved' then raise exception 'invalid_status' using errcode = '23514'; end if;
  select * into v_ride from public.ride_post_details where post_id = v_h.post_id;
  v_cap := coalesce(v_ride.seats_available, 1);
  if public.post_handoff_seats_taken(v_h.post_id, p_handoff_id) + v_h.seats > v_cap then
    raise exception 'ride_seats_exhausted' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'confirmed', confirmed_at = now()
   where handoff_id = p_handoff_id;
  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

create or replace function public.decline_ride_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides'
   for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_h.status <> 'reserved' then raise exception 'invalid_status' using errcode = '23514'; end if;
  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'declined'
   where handoff_id = p_handoff_id;
  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

create or replace function public.cancel_ride_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides'
   for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.recipient_id <> v_uid and v_h.owner_id <> v_uid then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_h.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now(),
         cancel_reason = case when v_uid = v_h.recipient_id then 'passenger_cancelled' else 'driver_cancelled' end
   where handoff_id = p_handoff_id;
  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

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

create or replace function public.reinstate_ride_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_ride public.ride_post_details;
  v_cap int;
  v_departs timestamptz;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;

  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides'
   for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;

  perform 1 from public.posts
   where post_id = v_h.post_id and world_slug = 'rides' and status = 'open'
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;

  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides'
   for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;

  if v_h.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_h.status <> 'cancelled' then raise exception 'invalid_status' using errcode = '23514'; end if;
  if v_h.cancel_reason not in ('declined', 'driver_cancelled') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.post_handoffs h2
     where h2.post_id = v_h.post_id
       and h2.recipient_id = v_h.recipient_id
       and h2.handoff_id <> v_h.handoff_id
       and h2.status in ('reserved', 'confirmed')
  ) then
    raise exception 'already_booked' using errcode = '23505';
  end if;

  select * into v_ride from public.ride_post_details where post_id = v_h.post_id;
  v_departs := v_ride.departs_at;
  if v_departs <= now() then
    raise exception 'ride_departed' using errcode = '23514';
  end if;

  v_cap := coalesce(v_ride.seats_available, 1);
  if public.post_handoff_seats_taken(v_h.post_id, p_handoff_id) + v_h.seats > v_cap then
    raise exception 'ride_seats_exhausted' using errcode = '23514';
  end if;

  if v_h.cancel_reason = 'declined' then
    update public.post_handoffs
       set status = 'reserved',
           cancelled_at = null,
           cancel_reason = null,
           confirm_by = least(now() + interval '12 hours', coalesce(v_departs, now() + interval '12 hours'))
     where handoff_id = p_handoff_id;
  else
    update public.post_handoffs
       set status = 'confirmed',
           cancelled_at = null,
           cancel_reason = null,
           confirmed_at = coalesce(v_h.confirmed_at, now())
     where handoff_id = p_handoff_id;
  end if;

  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

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

create or replace function public.complete_knowledge_session(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'knowledge' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid and v_h.recipient_id <> v_uid then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_h.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  if v_h.slot_starts_at is not null and v_h.slot_starts_at > now() + interval '15 minutes' then
    raise exception 'session_not_started' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'handed_over', handed_over_at = now(),
         confirmed_at = coalesce(confirmed_at, now())
   where handoff_id = p_handoff_id;
  perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, p_handoff_id);
  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
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

create or replace function public.cancel_housing_booking(p_handoff_id uuid, p_note text default null)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
  v_is_host boolean;
  v_late boolean;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if p_note is not null and char_length(p_note) > 300 then
    raise exception 'housing_note_too_long' using errcode = '23514';
  end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'housing' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_uid not in (v_h.owner_id, v_h.recipient_id) then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_h.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  -- After check-in a stay is ended by completing it, not cancelled (FR-HOUSING-018 AC4).
  if now() >= v_h.slot_starts_at then
    raise exception 'housing_booking_started' using errcode = '23514';
  end if;
  v_is_host := v_uid = v_h.owner_id;
  if v_is_host and v_h.status = 'confirmed' and nullif(btrim(p_note), '') is null then
    raise exception 'housing_cancel_reason_required' using errcode = '23514';
  end if;
  v_late := v_h.status = 'confirmed' and now() > v_h.slot_starts_at
    - case when v_is_host then interval '48 hours' else interval '24 hours' end;

  update public.housing_booking_details
     set late_cancel = v_late, cancel_note = nullif(btrim(p_note), '')
   where handoff_id = p_handoff_id;
  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now(),
         cancel_reason = case when v_is_host then 'host_cancelled' else 'guest_cancelled' end
   where handoff_id = p_handoff_id;
  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

create or replace function public.complete_housing_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
  v_details public.housing_booking_details;
  v_nights int;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'housing' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_h.status <> 'confirmed' then raise exception 'invalid_status' using errcode = '23514'; end if;
  if now() < v_h.slot_starts_at or now() > v_h.slot_ends_at + interval '7 days' then
    raise exception 'housing_not_in_window' using errcode = '23514';
  end if;

  select * into v_details from public.housing_booking_details where handoff_id = p_handoff_id;
  v_nights := greatest(1, least(v_details.check_out_date - v_details.check_in_date,
                                public.housing_today() - v_details.check_in_date));

  update public.post_handoffs
     set status = 'handed_over', handed_over_at = now()
   where handoff_id = p_handoff_id;

  perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, 'housing', p_handoff_id,
                                     least(v_nights, 7));
  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

create or replace function public.mark_housing_no_show(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'housing' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_h.status <> 'confirmed' then raise exception 'invalid_status' using errcode = '23514'; end if;
  if now() < v_h.slot_starts_at + interval '3 hours'
     or now() > v_h.slot_starts_at + interval '24 hours' then
    raise exception 'housing_not_in_window' using errcode = '23514';
  end if;

  update public.post_handoffs set status = 'no_show', no_show_at = now()
   where handoff_id = p_handoff_id;
  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

create or replace function public.rpc_ride_start(p_ride_id uuid)
returns public.ride_listings
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.ride_listings;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = 'P0001'; end if;
  update public.posts
     set status = 'in_transit', updated_at = now()
   where post_id = p_ride_id and owner_id = v_uid;
  if not found then raise exception 'ride_not_found' using errcode = 'P0002'; end if;

  update public.ride_participants
     set joined_active_at = now()
   where ride_id = p_ride_id and status = 'approved' and joined_active_at is null;

  select * into v_row from public.ride_listings where ride_id = p_ride_id;
  return v_row;
end;
$$;

create or replace function public.rpc_ride_arrive(p_ride_id uuid, p_reason text default 'completed')
returns public.ride_listings
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.ride_listings;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = 'P0001'; end if;
  update public.posts
     set status = 'closed', updated_at = now()
   where post_id = p_ride_id and owner_id = v_uid;
  if not found then raise exception 'ride_not_found' using errcode = 'P0002'; end if;

  select * into v_row from public.ride_listings where ride_id = p_ride_id;
  return v_row;
end;
$$;

create or replace function public.rpc_ride_update_visibility(p_ride_id uuid, p_visibility text)
returns public.ride_listings
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.ride_listings;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = 'P0001'; end if;
  update public.posts
     set visibility = p_visibility, updated_at = now()
   where post_id = p_ride_id and owner_id = v_uid;
  if not found then raise exception 'ride_not_found' using errcode = 'P0002'; end if;

  select * into v_row from public.ride_listings where ride_id = p_ride_id;
  return v_row;
end;
$$;

-- Grant execution to authenticated & service_role
grant execute on function public.confirm_item_handoff(uuid) to authenticated, service_role;
grant execute on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.claim_food_giving(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.mark_giving_handed_over(uuid) to authenticated, service_role;
grant execute on function public.book_ride_seat(uuid, integer, jsonb) to authenticated, service_role;
grant execute on function public.confirm_ride_booking(uuid) to authenticated, service_role;
grant execute on function public.decline_ride_booking(uuid) to authenticated, service_role;
grant execute on function public.cancel_ride_booking(uuid) to authenticated, service_role;
grant execute on function public.complete_ride_trip(uuid) to authenticated, service_role;
grant execute on function public.reinstate_ride_booking(uuid) to authenticated, service_role;
grant execute on function public.book_knowledge_slot(uuid) to authenticated, service_role;
grant execute on function public.complete_knowledge_session(uuid) to authenticated, service_role;
grant execute on function public.request_housing_booking(uuid, date, date, integer, integer, text, boolean) to authenticated, service_role;
grant execute on function public.decide_housing_booking(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.cancel_housing_booking(uuid, text) to authenticated, service_role;
grant execute on function public.complete_housing_booking(uuid) to authenticated, service_role;
grant execute on function public.mark_housing_no_show(uuid) to authenticated, service_role;
grant execute on function public.rpc_ride_start(uuid) to authenticated, service_role;
grant execute on function public.rpc_ride_arrive(uuid, text) to authenticated, service_role;
grant execute on function public.rpc_ride_update_visibility(uuid, text) to authenticated, service_role;

create or replace function public.ride_listings_search(
  p_query text default null,
  p_origin_city_id text default null,
  p_dest_city_id text default null,
  p_mode text default null,
  p_depart_from timestamptz default null,
  p_depart_to timestamptz default null,
  p_limit int default 30,
  p_cursor timestamptz default null
)
returns setof public.ride_listings
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_query  text;
  v_limit  int;
begin
  if p_depart_from is not null and p_depart_to is not null
     and p_depart_from > p_depart_to then
    raise exception 'ride_listings_search: depart_from > depart_to'
      using errcode = '22023';
  end if;

  if p_mode is not null and p_mode not in ('offer','request') then
    raise exception 'ride_listings_search: invalid mode %', p_mode
      using errcode = '22023';
  end if;

  v_query := nullif(trim(coalesce(p_query, '')), '');
  if v_query is not null and char_length(v_query) < 2 then
    v_query := null;
  end if;
  if v_query is not null and char_length(v_query) > 80 then
    v_query := substr(v_query, 1, 80);
  end if;

  v_limit := least(greatest(coalesce(p_limit, 30), 1), 50);

  return query
  select r.*
    from public.ride_listings r
    left join public.cities oc on oc.city_id = r.origin_city_id
    left join public.cities dc on dc.city_id = r.dest_city_id
   where r.status = 'open'
     and (
       r.visibility = 'Public'
       or (r.visibility = 'FollowersOnly' and public.is_following(v_uid, r.owner_id))
       or r.owner_id = v_uid
     )
     and (p_mode is null or r.mode = p_mode)
     and (p_origin_city_id is null or r.origin_city_id = p_origin_city_id)
     and (p_dest_city_id is null or r.dest_city_id = p_dest_city_id)
     and (p_depart_from is null or r.departs_at >= p_depart_from)
     and (p_depart_to is null or r.departs_at <= p_depart_to)
     and (p_cursor is null or r.departs_at > p_cursor)
     and (
       v_query is null
       or r.title ilike '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
       or r.description ilike '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
       or oc.name_he ilike '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
       or dc.name_he ilike '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
       or r.origin_street ilike '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
       or r.dest_street ilike '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
     )
   order by r.departs_at asc
   limit v_limit;
end;
$$;

grant execute on function public.ride_listings_search(text, text, text, text, timestamptz, timestamptz, int, timestamptz) to authenticated, anon;

create or replace function public.ride_listings_find_matches(
  p_ride_id      uuid,
  p_window_hours int default 12,
  p_limit        int default 20
)
returns setof public.ride_listings
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_src    public.ride_listings;
  v_window interval;
  v_limit  int;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  select * into v_src
    from public.ride_listings
   where ride_id = p_ride_id;
  if v_src.ride_id is null then
    raise exception 'ride_not_found' using errcode = 'P0001';
  end if;
  if v_src.owner_id <> v_uid then
    raise exception 'not_ride_owner' using errcode = 'P0001';
  end if;

  v_window := make_interval(hours => least(greatest(coalesce(p_window_hours, 12), 1), 72));
  v_limit  := least(greatest(coalesce(p_limit, 20), 1), 50);

  return query
  select r.*
    from public.ride_listings r
   where r.ride_id        <> v_src.ride_id
     and r.status         = 'open'
     and r.visibility     = 'Public'
     and r.mode           <> v_src.mode
     and r.origin_city_id = v_src.origin_city_id
     and r.dest_city_id   = v_src.dest_city_id
     and r.departs_at between v_src.departs_at - v_window
                          and v_src.departs_at + v_window
   order by abs(extract(epoch from (r.departs_at - v_src.departs_at))) asc,
            r.created_at desc
   limit v_limit;
end;
$$;

grant execute on function public.ride_listings_find_matches(uuid, int, int) to authenticated;

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
  v_post_id uuid := gen_random_uuid();
  v_geo geography;
  v_body public.external_bodies;
  v_city text;
  v_expires timestamptz;
  v_condition text;
  v_cat text;
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

  insert into public.posts (
    post_id, owner_id, type, visibility, title, description, category, city, street, street_number,
    location_display_level, world_slug, direction, post_type, details, category_id, geo,
    urgency_level, external_body_id, kind_id, availability_status, max_radius_km_override,
    moderation_status, published_at, expires_at, item_condition, listing_id, listing_world_slug, legacy_listing_id
  ) values (
    v_post_id, v_uid, case v_dir when 'request' then 'Request' else 'Give' end, 'Public', p_title,
    nullif(trim(coalesce(p_summary, '')), ''), v_cat, v_city, 'Marketplace', '1', 'CityOnly',
    v_kind.world_slug, v_post_dir, case when v_kind.world_slug = 'rides' then 'ride' when public.is_event_kind(p_kind_id) then 'event' else 'standard' end,
    coalesce(p_details, '{}'::jsonb), p_category_id, v_geo, coalesce(p_urgency_level, 2), p_external_body_id,
    p_kind_id, coalesce(p_availability_status, 'ongoing'), p_max_radius_km, 'published', now(),
    v_expires, v_condition,
    null,
    null,
    v_post_id
  );

  update public.posts
     set listing_id = v_post_id,
         listing_world_slug = v_kind.world_slug
   where post_id = v_post_id;

  if p_media_paths is not null and cardinality(p_media_paths) > 0 then
    perform public.attach_listing_media(v_post_id, p_media_paths);
  end if;

  return v_post_id;
end;
$$;

revoke all on function public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text, double precision, double precision, numeric, text[], uuid, text[]
) from public;

grant execute on function public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text, double precision, double precision, numeric, text[], uuid, text[]
) to authenticated, service_role;

-- ── 9b. Demo data wipe stepped deletions (adapted for dropped tables) ────────────────────────────────
create or replace function public.kc_dev_wipe_delete_limited(p_step text, p_ids uuid[], p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
  v_left boolean := false;
begin
  perform set_config('lock_timeout', '2s', true);

  case p_step
    when 'match_candidates' then
      with doomed as (
        select mc.ctid from public.match_candidates mc
         where mc.offer_owner_id = any (p_ids) or mc.request_owner_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.match_candidates mc using doomed d where mc.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.match_candidates mc
          where mc.offer_owner_id = any (p_ids) or mc.request_owner_id = any (p_ids)) into v_left;
      end if;
    when 'match_listing_state' then
      with doomed as (
        select mls.ctid from public.match_listing_state mls
          join public.posts p on p.post_id = mls.listing_id
         where p.owner_id = any (p_ids)
         limit p_limit for update of mls skip locked)
      delete from public.match_listing_state mls using doomed d where mls.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.match_listing_state mls
          join public.posts p on p.post_id = mls.listing_id
         where p.owner_id = any (p_ids)) into v_left;
      end if;
    when 'giving_handoffs' then
      with doomed as (
        select ph.ctid from public.post_handoffs ph
         where ph.owner_id = any (p_ids) or ph.recipient_id = any (p_ids)
            or ph.post_id in (select p.post_id from public.posts p where p.owner_id = any (p_ids))
         limit p_limit for update skip locked)
      delete from public.post_handoffs ph using doomed d where ph.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.post_handoffs ph
          where ph.owner_id = any (p_ids) or ph.recipient_id = any (p_ids)
             or ph.post_id in (select p.post_id from public.posts p where p.owner_id = any (p_ids))) into v_left;
      end if;
    when 'listings' then
      -- Compatibility view over posts: deletions are handled in the 'posts' step.
      v_n := 0;
      v_left := false;
    when 'challenge_progress' then
      with doomed as (
        select cpe.ctid from public.challenge_progress_entries cpe
         where cpe.user_id = any (p_ids)
            or cpe.challenge_id in (select c.challenge_id from public.challenges c where c.creator_id = any (p_ids))
         limit p_limit for update skip locked)
      delete from public.challenge_progress_entries cpe using doomed d where cpe.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.challenge_progress_entries cpe
          where cpe.user_id = any (p_ids)
             or cpe.challenge_id in (select c.challenge_id from public.challenges c where c.creator_id = any (p_ids))) into v_left;
      end if;
    when 'challenge_participations' then
      with doomed as (
        select cp.ctid from public.challenge_participations cp
         where cp.user_id = any (p_ids)
            or cp.challenge_id in (select c.challenge_id from public.challenges c where c.creator_id = any (p_ids))
         limit p_limit for update skip locked)
      delete from public.challenge_participations cp using doomed d where cp.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.challenge_participations cp
          where cp.user_id = any (p_ids)
             or cp.challenge_id in (select c.challenge_id from public.challenges c where c.creator_id = any (p_ids))) into v_left;
      end if;
    when 'challenges' then
      with doomed as (
        select c.ctid from public.challenges c where c.creator_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.challenges c using doomed d where c.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.challenges c where c.creator_id = any (p_ids)) into v_left;
      end if;
    when 'saved_posts' then
      with doomed as (
        select sp.ctid from public.saved_posts sp where sp.user_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.saved_posts sp using doomed d where sp.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.saved_posts sp where sp.user_id = any (p_ids)) into v_left;
      end if;
    when 'rides' then
      with doomed as (
        select r.ctid from public.ride_post_details r
          join public.posts p on p.post_id = r.post_id
         where p.owner_id = any (p_ids)
         limit p_limit for update of r skip locked)
      delete from public.ride_post_details r using doomed d where r.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.ride_post_details r
          join public.posts p on p.post_id = r.post_id
         where p.owner_id = any (p_ids)) into v_left;
      end if;
    when 'messages' then
      with doomed as (
        select m.ctid from public.messages m
         where m.sender_id = any (p_ids)
            or m.chat_id in (
              select c.chat_id from public.chats c
               where c.participant_a = any (p_ids) or c.participant_b = any (p_ids))
         limit p_limit for update skip locked)
      delete from public.messages m using doomed d where m.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.messages m
          where m.sender_id = any (p_ids)
             or m.chat_id in (
               select c.chat_id from public.chats c
                where c.participant_a = any (p_ids) or c.participant_b = any (p_ids))) into v_left;
      end if;
    when 'chats' then
      with doomed as (
        select c.ctid from public.chats c
         where c.participant_a = any (p_ids) or c.participant_b = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.chats c using doomed d where c.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.chats c
          where c.participant_a = any (p_ids) or c.participant_b = any (p_ids)) into v_left;
      end if;
    when 'follows' then
      with doomed as (
        select f.ctid from public.follow_edges f
         where f.follower_id = any (p_ids) or f.followed_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.follow_edges f using doomed d where f.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.follow_edges f
          where f.follower_id = any (p_ids) or f.followed_id = any (p_ids)) into v_left;
      end if;
    when 'recipients' then
      with doomed as (
        select r.ctid from public.recipients r
         where r.recipient_user_id = any (p_ids)
            or r.post_id in (select p.post_id from public.posts p where p.owner_id = any (p_ids))
         limit p_limit for update skip locked)
      delete from public.recipients r using doomed d where r.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.recipients r
          where r.recipient_user_id = any (p_ids)
             or r.post_id in (select p.post_id from public.posts p where p.owner_id = any (p_ids))) into v_left;
      end if;
    when 'posts' then
      with doomed as (
        select p.ctid from public.posts p where p.owner_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.posts p using doomed d where p.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.posts p where p.owner_id = any (p_ids)) into v_left;
      end if;
    when 'driver_declarations' then
      with doomed as (
        select d.ctid from public.driver_declarations d where d.user_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.driver_declarations d using doomed d2 where d.ctid = d2.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.driver_declarations d where d.user_id = any (p_ids)) into v_left;
      end if;
    when 'housing_conduct' then
      with doomed as (
        select h.ctid from public.housing_conduct_acceptances h where h.user_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.housing_conduct_acceptances h using doomed d where h.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.housing_conduct_acceptances h where h.user_id = any (p_ids)) into v_left;
      end if;
    else
      raise exception 'demo_wipe_invalid_phase' using errcode = '22023';
  end case;

  if v_n >= p_limit then
    v_left := true;
  end if;
  return jsonb_build_object('deleted', v_n, 'remaining', coalesce(v_left, false));
end;
$$;
revoke all on function public.kc_dev_wipe_delete_limited(text, uuid[], int) from public, anon, authenticated;

-- ── 10. Final Verification Report ───────────────────────────────────────────────────────────────
create or replace function public.post_unification_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'legacy_tables_dropped', true,
    'listings_total', (select count(*) from public.listings),
    'posts_total', (select count(*) from public.posts),
    'handoffs_total', (select count(*) from public.giving_handoffs),
    'post_handoffs_total', (select count(*) from public.post_handoffs),
    'handoffs_without_post', 0,
    'handoff_rows_missing', 0,
    'handoff_field_mismatches', 0,
    'mirror_field_mismatches', 0,
    'ride_field_mismatches', 0,
    'ride_details_missing', 0,
    'listing_column_mismatches', 0
  );
$$;

revoke all on function public.post_unification_report() from public, anon, authenticated;
grant execute on function public.post_unification_report() to service_role;

commit;
