-- 0554_posts_own_listing_worlds | G1 step 2 (ADR-006, D2 / D19 / D104, BACKLOG G1-S2)
--
-- `posts` becomes the source of truth for the four create categories that still ran on the
-- listing engine (food, rides, housing, time). The app keeps calling the same RPCs
-- (`create_marketplace_listing`, `update_my_listing`, `pause / resume / fulfill / delete_my_listing`)
-- with the same ids and error codes; what changes is where they write:
--
--   create  → a `posts` row; `listing_upsert_from_post` (0243, now every create world) derives
--             the listing with `origin = 'native'` and `legacy_post_id = post_id`, so every
--             listing-side rule still runs on it (world permission, rate limit, detail schema,
--             official places, ride schedule, cost cap, food expiry, matching, embeddings);
--             the post then links back through `posts.listing_id`, as a mirror does today.
--   edit    → the post; the listing follows.
--   status  → the post (open / paused / closed_delivered / deleted); the listing follows.
--   back    → what the listing side computes or changes (expiry, canonical details, urgency,
--             status set by sweeps, handoffs or moderation, the world's anonymity cap) flows
--             back to the post through `post_sync_from_listing`. Both directions compare before
--             writing, so the chain converges.
--
-- Items stay as they are (the post engine; the listing keeps `origin = 'post'` and its legacy
-- detail shape, G34 moves its closing later). Listings of worlds without a create form
-- (knowledge, medical, …) and listings inserted directly (tests, intake) stay listing-sourced
-- with a mirror post. The post-side cap, karma, counters and closure messages apply to items
-- posts only, which is what the mirror exemption did before.
-- Backfill: every native listing of the four worlds gets a post (reusing its mirror) and the
-- `legacy_post_id` link. Additive and idempotent.

begin;

-- ── 1. Which listing kind a post of a create category derives to ────────────────────
create or replace function public.listing_kind_for_post(p_world_slug text, p_direction text)
returns uuid
language sql
stable
set search_path = public
as $$
  select lk.kind_id
    from public.listing_kinds lk
   where lk.world_slug = p_world_slug
     and lk.is_active
     and lk.slug = case p_world_slug
       when 'items'   then case when p_direction = 'request' then 'request_item'    else 'give_item'       end
       when 'food'    then case when p_direction = 'request' then 'request_food'    else 'give_food'       end
       when 'rides'   then case when p_direction = 'request' then 'ride_request'    else 'ride_offer'      end
       when 'housing' then case when p_direction = 'request' then 'stay_request'    else 'host_offer'      end
       when 'time'    then case when p_direction = 'request' then 'support_request' else 'volunteer_shift' end
     end
   limit 1;
$$;

comment on function public.listing_kind_for_post(text, text) is
  'The listing kind a post of a create category (items, food, rides, housing, time) derives to: one kind per world and direction (D-207, G1 step 2).';

revoke all on function public.listing_kind_for_post(text, text) from public, anon, authenticated;
grant execute on function public.listing_kind_for_post(text, text) to service_role;

-- A post owns its listing unless it is the mirror of a listing-sourced native listing.
create or replace function public.post_owns_listing(p_post public.posts)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_post.listing_id is null
      or exists (
           select 1 from public.listings l
            where l.listing_id = p_post.listing_id
              and l.legacy_post_id = p_post.post_id);
$$;

revoke all on function public.post_owns_listing(public.posts) from public, anon, authenticated;
grant execute on function public.post_owns_listing(public.posts) to service_role;

-- The listing status a post status maps to (the inverse of listing_feed_mirror_status).
create or replace function public.listing_status_for_post(p_status text)
returns text
language sql
immutable
as $$
  select case p_status
    when 'open' then 'open'
    when 'paused' then 'cancelled'
    when 'closed_delivered' then 'closed'
    when 'expired' then 'expired'
    when 'removed_admin' then 'removed_admin'
    when 'hidden_pending_review' then 'hidden_pending_review'
    else 'closed'
  end;
$$;

revoke all on function public.listing_status_for_post(text) from public, anon, authenticated;
grant execute on function public.listing_status_for_post(text) to service_role;

-- ── 2. posts → listings for every create world ──────────────────────────────────────
-- Items keep the 0243 shape (origin 'post', legacy detail keys, sub-category from the legacy
-- text). The other create worlds derive a native listing that carries the post's own fields.
create or replace function public.listing_upsert_from_post(p_post public.posts)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_world       text := coalesce(p_post.world_slug, 'items');
  v_direction   text := coalesce(p_post.direction, case when p_post.type = 'Request' then 'request' else 'offer' end);
  v_kind_id     uuid := public.listing_kind_for_post(v_world, v_direction);
  v_is_items    boolean := v_world = 'items';
  v_status      text := public.listing_status_for_post(p_post.status);
  v_category_id uuid;
  v_geo         extensions.geography;
  v_details     jsonb;
  v_time_window tstzrange;
  v_expires_at  timestamptz;
  v_listing_id  uuid;
begin
  if v_kind_id is null or not public.post_owns_listing(p_post) then
    return;
  end if;

  if v_is_items then
    select category_id into v_category_id
      from public.categories
     where world_slug = 'items' and legacy_post_category = p_post.category
     order by sort_order limit 1;
    v_geo := coalesce(p_post.geo, public.listing_geo_from_city(p_post.city));
    v_details := jsonb_strip_nulls(jsonb_build_object(
      'item_condition', p_post.item_condition,
      'urgency', p_post.urgency,
      'street', p_post.street,
      'street_number', p_post.street_number,
      'location_display_level', p_post.location_display_level));
    v_time_window := case when p_post.delete_after is not null
      then tstzrange(p_post.created_at, p_post.delete_after, '[)') end;
    v_expires_at := p_post.delete_after;
  else
    v_category_id := p_post.category_id;
    v_geo := coalesce(p_post.geo, public.listing_geo_from_city(p_post.city));
    v_details := coalesce(p_post.details, '{}'::jsonb);
    v_time_window := p_post.time_window;
    v_expires_at := p_post.expires_at;
  end if;

  -- Update in place when the listing exists; an INSERT … ON CONFLICT would run the listing's
  -- BEFORE INSERT triggers (world TTL, expiry from details, rate limit) on every sync and feed
  -- their result into `excluded`, resetting what the listing side had set since.
  select l.listing_id into v_listing_id from public.listings l where l.legacy_post_id = p_post.post_id;

  if v_listing_id is null then
    insert into public.listings (
      owner_id, world_slug, kind_id, category_id, direction, status, visibility,
      anonymity_level, title, summary, geo, city_id, time_window, expires_at,
      details, origin, legacy_post_id, moderation_status, published_at, created_at, updated_at,
      urgency_level, external_body_id, beneficiary_org_id
    ) values (
      p_post.owner_id, v_world, v_kind_id, v_category_id,
      case when v_direction = 'request' then 'request' else 'give' end,
      v_status, p_post.visibility, public.visibility_to_anonymity_level(p_post.visibility),
      p_post.title, p_post.description, v_geo, p_post.city, v_time_window, v_expires_at,
      v_details, case when v_is_items then 'post' else 'native' end, p_post.post_id, 'published',
      coalesce(p_post.created_at, now()), coalesce(p_post.created_at, now()), coalesce(p_post.updated_at, now()),
      coalesce(p_post.urgency_level, 2), p_post.external_body_id, p_post.beneficiary_org_id
    )
    returning listing_id into v_listing_id;
  else
    update public.listings l set
      owner_id           = p_post.owner_id,
      kind_id            = v_kind_id,
      category_id        = v_category_id,
      direction          = case when v_direction = 'request' then 'request' else 'give' end,
      status             = v_status,
      visibility         = p_post.visibility,
      anonymity_level    = public.visibility_to_anonymity_level(p_post.visibility),
      title              = p_post.title,
      summary            = p_post.description,
      geo                = v_geo,
      city_id            = p_post.city,
      time_window        = v_time_window,
      expires_at         = v_expires_at,
      details            = v_details,
      urgency_level      = coalesce(p_post.urgency_level, 2),
      external_body_id   = p_post.external_body_id,
      beneficiary_org_id = p_post.beneficiary_org_id,
      updated_at         = now()
    where l.listing_id = v_listing_id
      and (l.owner_id, l.kind_id, l.category_id, l.direction, l.status, l.visibility, l.anonymity_level,
           l.title, l.summary, l.geo::text, l.city_id, l.time_window, l.expires_at, l.details,
           l.urgency_level, l.external_body_id, l.beneficiary_org_id)
          is distinct from
          (p_post.owner_id, v_kind_id, v_category_id,
           case when v_direction = 'request' then 'request' else 'give' end,
           v_status, p_post.visibility, public.visibility_to_anonymity_level(p_post.visibility),
           p_post.title, p_post.description, v_geo::text, p_post.city, v_time_window, v_expires_at,
           v_details, coalesce(p_post.urgency_level, 2), p_post.external_body_id, p_post.beneficiary_org_id);
  end if;

  -- A post of a listing world points at its listing like a mirror does, so the feed card,
  -- the detail redirect and the photo sync keep working (0466, 0522).
  if not v_is_items then
    update public.posts
       set listing_id = v_listing_id, listing_world_slug = v_world
     where post_id = p_post.post_id
       and listing_id is null;
  end if;
end;
$$;

revoke all on function public.listing_upsert_from_post(public.posts) from public, anon, authenticated;
grant execute on function public.listing_upsert_from_post(public.posts) to service_role;

-- The posts → listings trigger runs for every post that owns its listing (not for mirrors).
create or replace function public.trg_posts_sync_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.post_owns_listing(new) then
    perform public.listing_upsert_from_post(new);
  end if;
  return new;
end;
$$;

revoke all on function public.trg_posts_sync_listing() from public, anon, authenticated;

-- ── 3. listings → posts: what the listing side computes flows back to its post ───────
create or replace function public.post_sync_from_listing(p_listing public.listings)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status     text := public.listing_feed_mirror_status(p_listing);
  v_visibility text := public.anonymity_level_to_visibility(p_listing.anonymity_level);
begin
  update public.posts p
     set status        = v_status,
         visibility    = v_visibility,
         expires_at    = p_listing.expires_at,
         details       = coalesce(p_listing.details, '{}'::jsonb),
         time_window   = p_listing.time_window,
         urgency_level = p_listing.urgency_level,
         geo           = p_listing.geo,
         category_id   = p_listing.category_id,
         listing_id    = p_listing.listing_id,
         listing_world_slug = p_listing.world_slug
   where p.post_id = p_listing.legacy_post_id
     and (p.status, p.visibility, p.expires_at, p.details, p.time_window, p.urgency_level,
          p.geo::text, p.category_id, p.listing_id, p.listing_world_slug)
         is distinct from
         (v_status, v_visibility, p_listing.expires_at, coalesce(p_listing.details, '{}'::jsonb),
          p_listing.time_window, p_listing.urgency_level, p_listing.geo::text, p_listing.category_id,
          p_listing.listing_id, p_listing.world_slug);
  perform public.listing_feed_mirror_sync_media(p_listing.listing_id, p_listing.legacy_post_id);
  if p_listing.world_slug = 'rides' then
    perform public.ride_post_details_upsert(p_listing.legacy_post_id, coalesce(p_listing.details, '{}'::jsonb));
  end if;
end;
$$;

revoke all on function public.post_sync_from_listing(public.listings) from public, anon, authenticated;
grant execute on function public.post_sync_from_listing(public.listings) to service_role;

-- Same conditions as 0466 / 0531 for listing-sourced listings; a post-sourced listing syncs back instead.
create or replace function public.listings_feed_mirror_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mirrored boolean;
begin
  if new.origin <> 'native' then
    return new;
  end if;

  if new.legacy_post_id is not null then
    begin
      perform public.post_sync_from_listing(new);
    exception when others then
      raise warning 'post_sync_from_listing: listing % not synced: % (%)', new.listing_id, sqlerrm, sqlstate;
    end;
    return new;
  end if;

  select exists (select 1 from public.posts p where p.listing_id = new.listing_id)
    into v_mirrored;

  -- Without a mirror yet, only a published open listing of a mirrored world gets one — and
  -- of a recurring ride only its soonest upcoming occurrence (FR-RIDE-046, 0531).
  if not v_mirrored then
    if new.moderation_status <> 'published' or new.status <> 'open' then
      return new;
    end if;
    if not exists (select 1 from public.worlds w where w.slug = new.world_slug and w.feed_mirror) then
      return new;
    end if;
    if public.ride_series_feed_waits(new) then
      return new;
    end if;
  end if;

  begin
    perform public.listing_feed_mirror_upsert(new);
  exception when others then
    raise warning 'listing_feed_mirror: listing % not mirrored: % (%)', new.listing_id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.listings_feed_mirror_sync() from public, anon, authenticated;

-- ── 4. Post-side cap, karma, counters and closure messages: items posts only ────────
-- A post of a listing world is created with listing_id still null, so the mirror exemption
-- (`new.listing_id is null`) no longer tells the engines apart; the world does.
create or replace function public.posts_enforce_active_cap()
returns trigger language plpgsql as $$
declare
  active_n int;
begin
  -- Listing worlds have their own limits (rate limits, 0534); mirrors follow their listing.
  if new.listing_id is not null or coalesce(new.world_slug, 'items') <> 'items' then
    return new;
  end if;
  -- Admin restore exemption: removed_admin → open is moderation, not creation.
  if tg_op = 'UPDATE' and old.status = 'removed_admin' and new.status = 'open' then
    return new;
  end if;
  if new.status = 'open' and (tg_op = 'INSERT' or old.status <> 'open') then
    select count(*) into active_n
    from public.posts
    where owner_id = new.owner_id and status = 'open' and listing_id is null and world_slug = 'items';
    if active_n >= 20 then
      raise exception 'active_post_limit_exceeded'
        using errcode = 'check_violation', detail = 'limit=20';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists karma_posts_after_insert on public.posts;
create trigger karma_posts_after_insert
  after insert on public.posts
  for each row when (new.listing_id is null and new.world_slug = 'items')
  execute function public.karma_on_post_change();

drop trigger if exists karma_posts_after_status_update on public.posts;
create trigger karma_posts_after_status_update
  after update of status on public.posts
  for each row when (new.listing_id is null and new.world_slug = 'items')
  execute function public.karma_on_post_change();

drop trigger if exists posts_after_update_emit_closure_messages on public.posts;
create trigger posts_after_update_emit_closure_messages
  after update of status on public.posts
  for each row when (new.listing_id is null and new.world_slug = 'items')
  execute function public.posts_emit_closure_system_messages();

drop trigger if exists posts_after_insert_counters on public.posts;
create trigger posts_after_insert_counters
  after insert on public.posts
  for each row when (new.listing_id is null and new.world_slug = 'items')
  execute function public.posts_after_change_counters();

drop trigger if exists posts_after_update_counters on public.posts;
create trigger posts_after_update_counters
  after update of status, visibility on public.posts
  for each row when (new.listing_id is null and new.world_slug = 'items')
  execute function public.posts_after_change_counters();

drop trigger if exists posts_after_delete_counters on public.posts;
create trigger posts_after_delete_counters
  after delete on public.posts
  for each row when (old.listing_id is null and old.world_slug = 'items')
  execute function public.posts_after_change_counters();

-- ── 5. The create RPC writes a post for the listing worlds ──────────────────────────
-- Same signature, ids and error codes as 0353. Items (tests and legacy callers) and worlds
-- without a create form keep the listing-only path.
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
  p_external_body_id uuid default null
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
  v_listing_id uuid;
  v_post_id uuid;
  v_geo geography;
  v_body public.external_bodies;
  v_city text;
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

  if v_kind.world_slug in ('food', 'rides', 'housing', 'time')
     and public.listing_kind_for_post(v_kind.world_slug, v_post_dir) = p_kind_id then
    -- The post is the record; the listing is derived by the posts → listings trigger and
    -- every listing-side rule runs on it (a refusal rolls the post back too).
    if char_length(p_title) > 80 then
      raise exception 'title_too_long' using errcode = '23514';
    end if;
    v_city := coalesce(p_city_id, (select u.city from public.users u where u.user_id = v_uid), 'tel-aviv');

    insert into public.posts (
      owner_id, type, visibility, title, description, category, city, street, street_number,
      location_display_level, world_slug, direction, post_type, details, category_id, geo,
      urgency_level, external_body_id
    ) values (
      v_uid, case v_dir when 'request' then 'Request' else 'Give' end, 'Public', p_title,
      nullif(trim(coalesce(p_summary, '')), ''), 'Other', v_city, 'Marketplace', '1', 'CityOnly',
      v_kind.world_slug, v_post_dir, case when v_kind.world_slug = 'rides' then 'ride' else 'standard' end,
      coalesce(p_details, '{}'::jsonb), p_category_id, v_geo, coalesce(p_urgency_level, 2), p_external_body_id
    )
    returning post_id into v_post_id;

    select l.listing_id into v_listing_id from public.listings l where l.legacy_post_id = v_post_id;
    if v_listing_id is null then
      raise exception 'listing_not_derived' using errcode = 'P0001';
    end if;

    -- Radius override and availability live on the listing only.
    update public.listings
       set max_radius_km_override = p_max_radius_km,
           availability_status = coalesce(p_availability_status, 'ongoing')
     where listing_id = v_listing_id
       and (max_radius_km_override is distinct from p_max_radius_km
            or availability_status is distinct from coalesce(p_availability_status, 'ongoing'));
  else
    insert into public.listings (
      owner_id, world_slug, kind_id, category_id, direction, title, summary, details,
      city_id, geo, max_radius_km_override, urgency_level, availability_status, origin, moderation_status,
      external_body_id
    ) values (
      v_uid, v_kind.world_slug, p_kind_id, p_category_id, v_dir, p_title, p_summary, coalesce(p_details, '{}'::jsonb),
      p_city_id, v_geo, p_max_radius_km, coalesce(p_urgency_level, 2), coalesce(p_availability_status, 'ongoing'),
      'native', 'published',
      p_external_body_id
    )
    returning listing_id into v_listing_id;
  end if;

  perform public.attach_listing_media(v_listing_id, p_media_paths);

  return v_listing_id;
end;
$$;

-- `create or replace` keeps the 0353 grants; restated so this migration is self-contained.
revoke all on function public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text,
  double precision, double precision, numeric, text[], uuid
) from public, anon;
grant execute on function public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text,
  double precision, double precision, numeric, text[], uuid
) to authenticated;

-- ── 6. Edits go to the post of a post-sourced listing ───────────────────────────────
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
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.listings%rowtype;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_row from public.listings where listing_id = p_listing_id and owner_id = v_uid for update;
  if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;
  if v_row.status not in ('open', 'cancelled') then
    raise exception 'listing_not_editable' using errcode = '23514';
  end if;
  if p_details is not null and not public.validate_listing_details(v_row.kind_id, p_details) then
    raise exception 'details_schema_mismatch' using errcode = '23514';
  end if;

  if v_row.origin = 'native' and v_row.legacy_post_id is not null then
    if p_title is not null and char_length(trim(p_title)) > 80 then
      raise exception 'title_too_long' using errcode = '23514';
    end if;
    -- The post is the record; the listing follows through the posts → listings trigger.
    update public.posts set
      title         = coalesce(nullif(trim(p_title), ''), title),
      description   = case when p_summary is null then description else nullif(trim(p_summary), '') end,
      details       = coalesce(p_details, details),
      city          = coalesce(p_city_id, city),
      urgency_level = coalesce(p_urgency_level, urgency_level),
      geo           = case when p_city_id is not null then public.listing_geo_from_city(p_city_id) else geo end,
      updated_at    = now()
    where post_id = v_row.legacy_post_id;

    update public.listings set
      max_radius_km_override = coalesce(p_max_radius_km, max_radius_km_override),
      availability_status    = coalesce(p_availability_status, availability_status),
      updated_at             = now()
    where listing_id = p_listing_id
      and (p_max_radius_km is not null or p_availability_status is not null);
    return;
  end if;

  update public.listings set
    title = coalesce(nullif(trim(p_title), ''), title),
    summary = case when p_summary is null then summary else nullif(trim(p_summary), '') end,
    details = coalesce(p_details, details),
    city_id = coalesce(p_city_id, city_id),
    max_radius_km_override = coalesce(p_max_radius_km, max_radius_km_override),
    urgency_level = coalesce(p_urgency_level, urgency_level),
    availability_status = coalesce(p_availability_status, availability_status),
    geo = case
      when p_city_id is not null then public.listing_geo_from_city(p_city_id)
      else geo
    end,
    updated_at = now()
  where listing_id = p_listing_id;
end;
$$;

revoke all on function public.update_my_listing(uuid, text, text, jsonb, text, numeric, smallint, text) from public, anon;
grant execute on function public.update_my_listing(uuid, text, text, jsonb, text, numeric, smallint, text) to authenticated;

-- ── 7. Owner management (D104) acts on the post when the post is the record ─────────
-- Guards and error codes are those of 0543; only the row that changes differs.
create or replace function public.listing_set_post_status(p_listing public.listings, p_status text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_listing.origin <> 'native' or p_listing.legacy_post_id is null then
    return false;
  end if;
  perform 1 from public.posts where post_id = p_listing.legacy_post_id for update;
  update public.posts set status = p_status, updated_at = now() where post_id = p_listing.legacy_post_id;
  return true;
end;
$$;

revoke all on function public.listing_set_post_status(public.listings, text) from public, anon, authenticated;

create or replace function public.pause_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.listings := public.listing_lock_own(p_listing_id);
begin
  if v_row.status <> 'open' then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(p_listing_id) then
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  if public.listing_set_post_status(v_row, 'paused') then
    update public.listings set availability_status = 'ongoing', updated_at = now() where listing_id = p_listing_id;
    return;
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
  v_row public.listings := public.listing_lock_own(p_listing_id);
begin
  if v_row.status <> 'cancelled' then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'listing_expired' using errcode = '23514';
  end if;
  if public.listing_set_post_status(v_row, 'open') then
    return;
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
  v_row public.listings := public.listing_lock_own(p_listing_id);
begin
  if v_row.status <> 'open' then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(p_listing_id) then
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  if not public.listing_set_post_status(v_row, 'closed_delivered') then
    update public.listings set status = 'closed', updated_at = now() where listing_id = p_listing_id;
  end if;
  perform public.karma_grant_once(v_row.owner_id, 'listing_fulfilled', 'listing', p_listing_id::text, 4);
end;
$$;

create or replace function public.delete_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.listings := public.listing_lock_own(p_listing_id);
begin
  if v_row.status not in ('open', 'cancelled', 'closed') then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(p_listing_id) then
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  -- A handed-over handoff is the other side's record too (rating, karma), as for posts
  -- (FR-POST-010: a closed post with a recipient cannot be deleted).
  if exists (
    select 1 from public.giving_handoffs h
     where h.listing_id = p_listing_id and h.status = 'handed_over'
  ) then
    raise exception 'listing_has_handoff_history' using errcode = '23514';
  end if;
  delete from public.listing_media where listing_id = p_listing_id;
  if v_row.origin = 'native' and v_row.legacy_post_id is not null then
    -- The post is the record; its listing goes with it (legacy_post_id cascades).
    delete from public.posts where post_id = v_row.legacy_post_id;
    return;
  end if;
  delete from public.listings where listing_id = p_listing_id;
end;
$$;

-- `create or replace` keeps the 0543 grants; restated so this migration is self-contained.
revoke all on function public.pause_my_listing(uuid) from public, anon;
revoke all on function public.resume_my_listing(uuid) from public, anon;
revoke all on function public.fulfill_my_listing(uuid) from public, anon;
revoke all on function public.delete_my_listing(uuid) from public, anon;
grant execute on function public.pause_my_listing(uuid) to authenticated;
grant execute on function public.resume_my_listing(uuid) to authenticated;
grant execute on function public.fulfill_my_listing(uuid) to authenticated;
grant execute on function public.delete_my_listing(uuid) to authenticated;

-- ── 8. Backfill: every native listing of the four worlds owns a post ─────────────────
-- A listing with a mirror keeps it as its post; one without gets a post the same way; then
-- the listing points back through legacy_post_id. One odd row is reported, not fatal.
do $$
declare
  l public.listings;
  v_post_id uuid;
begin
  for l in
    select * from public.listings
     where origin = 'native'
       and legacy_post_id is null
       and world_slug in ('food', 'rides', 'housing', 'time')
     order by created_at
  loop
    begin
      select p.post_id into v_post_id from public.posts p where p.listing_id = l.listing_id;
      -- An occurrence of a recurring ride waiting its turn in the feed keeps waiting (0531):
      -- it stays listing-sourced and the series sweep mirrors it when it is the soonest.
      if v_post_id is null and l.details ? 'ride_series' then
        continue;
      end if;
      if v_post_id is null then
        v_post_id := public.listing_feed_mirror_upsert(l);
      end if;
      update public.listings set legacy_post_id = v_post_id where listing_id = l.listing_id;
    exception when others then
      raise warning 'posts_own_listing_worlds backfill: listing % skipped: % (%)', l.listing_id, sqlerrm, sqlstate;
    end;
  end loop;
end $$;

commit;
