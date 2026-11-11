-- 0243_listings_legacy_sync | Issue #826
-- Sync posts → items listings, ride_listings → rides listings (backfill + triggers).
-- Opportunities of the retired product omitted (removed, D-190).

begin;

create or replace function public.listing_geo_from_city(p_city_id text)
returns extensions.geography
language sql
stable
set search_path = public, extensions
as $$
  select c.geo from public.cities c where c.city_id = p_city_id;
$$;

create or replace function public.listing_upsert_from_post(p_post public.posts)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind_id uuid;
  v_category_id uuid;
  v_geo extensions.geography;
begin
  select kind_id into v_kind_id
    from public.listing_kinds
   where world_slug = 'items'
     and slug = case when p_post.type = 'Give' then 'give_item' else 'request_item' end;

  if v_kind_id is null then
    return;
  end if;

  select category_id into v_category_id
    from public.categories
   where world_slug = 'items'
     and legacy_post_category = p_post.category
   limit 1;

  v_geo := public.listing_geo_from_city(p_post.city);

  insert into public.listings (
    owner_id, world_slug, kind_id, category_id, direction, status, visibility,
    anonymity_level, title, summary, geo, city_id, time_window, expires_at,
    details, origin, legacy_post_id, moderation_status, published_at, created_at, updated_at
  ) values (
    p_post.owner_id,
    'items',
    v_kind_id,
    v_category_id,
    lower(p_post.type),
    case p_post.status
      when 'open' then 'open'
      when 'closed_delivered' then 'closed'
      when 'expired' then 'expired'
      when 'removed_admin' then 'removed_admin'
      else 'closed'
    end,
    p_post.visibility,
    public.visibility_to_anonymity_level(p_post.visibility),
    p_post.title,
    p_post.description,
    v_geo,
    p_post.city,
    case when p_post.delete_after is not null
      then tstzrange(p_post.created_at, p_post.delete_after, '[)')
      else null end,
    p_post.delete_after,
    jsonb_strip_nulls(jsonb_build_object(
      'item_condition', p_post.item_condition,
      'urgency', p_post.urgency,
      'street', p_post.street,
      'street_number', p_post.street_number,
      'location_display_level', p_post.location_display_level
    )),
    'post',
    p_post.post_id,
    'published',
    coalesce(p_post.created_at, now()),
    coalesce(p_post.created_at, now()),
    coalesce(p_post.updated_at, now())
  )
  on conflict (legacy_post_id) where legacy_post_id is not null do update set
    owner_id = excluded.owner_id,
    kind_id = excluded.kind_id,
    category_id = excluded.category_id,
    direction = excluded.direction,
    status = excluded.status,
    visibility = excluded.visibility,
    anonymity_level = excluded.anonymity_level,
    title = excluded.title,
    summary = excluded.summary,
    geo = excluded.geo,
    city_id = excluded.city_id,
    time_window = excluded.time_window,
    expires_at = excluded.expires_at,
    details = excluded.details,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.listing_upsert_from_ride(p_ride public.ride_listings)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind_id uuid;
  v_geo extensions.geography;
begin
  select kind_id into v_kind_id
    from public.listing_kinds
   where world_slug = 'rides'
     and slug = case when p_ride.mode = 'offer' then 'ride_offer' else 'ride_request' end;

  if v_kind_id is null then
    return;
  end if;

  v_geo := public.listing_geo_from_city(p_ride.origin_city_id);

  insert into public.listings (
    owner_id, world_slug, kind_id, direction, status, visibility, anonymity_level,
    title, summary, geo, city_id, time_window, expires_at, details, origin,
    legacy_ride_id, moderation_status, published_at, created_at, updated_at
  ) values (
    p_ride.owner_id,
    'rides',
    v_kind_id,
    case when p_ride.mode = 'offer' then 'give' else 'request' end,
    case p_ride.status when 'open' then 'open' when 'cancelled' then 'cancelled' else 'closed' end,
    p_ride.visibility,
    public.visibility_to_anonymity_level(p_ride.visibility),
    p_ride.title,
    p_ride.description,
    v_geo,
    p_ride.origin_city_id,
    tstzrange(p_ride.departs_at, p_ride.departs_at + interval '6 hours', '[)'),
    p_ride.departs_at + interval '6 hours',
    jsonb_strip_nulls(jsonb_build_object(
      'seats_available', p_ride.seats_available,
      'dest_city_id', p_ride.dest_city_id,
      'origin_city_id', p_ride.origin_city_id,
      'departs_at', p_ride.departs_at
    )),
    'ride_listing',
    p_ride.ride_id,
    'published',
    coalesce(p_ride.created_at, now()),
    coalesce(p_ride.created_at, now()),
    coalesce(p_ride.updated_at, now())
  )
  on conflict (legacy_ride_id) where legacy_ride_id is not null do update set
    owner_id = excluded.owner_id,
    kind_id = excluded.kind_id,
    direction = excluded.direction,
    status = excluded.status,
    visibility = excluded.visibility,
    anonymity_level = excluded.anonymity_level,
    title = excluded.title,
    summary = excluded.summary,
    geo = excluded.geo,
    city_id = excluded.city_id,
    time_window = excluded.time_window,
    expires_at = excluded.expires_at,
    details = excluded.details,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.trg_posts_sync_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.listing_upsert_from_post(new);
  return new;
end;
$$;

create or replace function public.trg_ride_listings_sync_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.listing_upsert_from_ride(new);
  return new;
end;
$$;

drop trigger if exists posts_sync_listing on public.posts;
create trigger posts_sync_listing
  after insert or update on public.posts
  for each row execute function public.trg_posts_sync_listing();

drop trigger if exists ride_listings_sync_listing on public.ride_listings;
create trigger ride_listings_sync_listing
  after insert or update on public.ride_listings
  for each row execute function public.trg_ride_listings_sync_listing();

-- One-time backfill (idempotent via ON CONFLICT in upsert helpers).
do $$
declare
  r public.posts;
  v public.ride_listings;
begin
  for r in select * from public.posts loop
    perform public.listing_upsert_from_post(r);
  end loop;
  for v in select * from public.ride_listings loop
    perform public.listing_upsert_from_ride(v);
  end loop;
end $$;

grant execute on function public.listing_geo_from_city(text) to authenticated, service_role;
grant execute on function public.listing_upsert_from_post(public.posts) to service_role;
grant execute on function public.listing_upsert_from_ride(public.ride_listings) to service_role;

commit;
