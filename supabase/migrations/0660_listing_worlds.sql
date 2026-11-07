-- 0660_listing_worlds | multi-world posts (#1475, D101, docs/spec/07 §7.2 / §7.3)
--
-- Every post has one primary world (listings.world_slug / posts.listing_world_slug) and may be
-- marked for additional worlds (table public.listing_worlds).
-- 1. Schema: listing_worlds (listing_id, world_slug, created_at) with primary key, foreign keys,
--    no repetition of primary world, and RLS mirroring listings.
-- 2. create_marketplace_listing: optional p_additional_world_slugs parameter.
-- 3. Management RPCs: set_listing_additional_worlds, get_listing_additional_worlds.
-- 4. browse_listings (0630): feed includes posts where world is primary or additional, no duplicates.
-- 5. feed_ranked_ids (0529): filter by worlds matches primary or additional worlds.
-- 6. search_listings (0632): search by world includes additional worlds.
-- 7. matching_v2 (0635): candidate pairing across primary and additional worlds.

begin;

-- ── 1. Table: listing_worlds ──────────────────────────────────────────────────────────
create table if not exists public.listing_worlds (
  listing_id uuid not null references public.listings(listing_id) on delete cascade,
  world_slug text not null references public.worlds(slug) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, world_slug)
);

create index if not exists idx_listing_worlds_world
  on public.listing_worlds (world_slug, listing_id);

comment on table public.listing_worlds is
  'Additional worlds a listing belongs to (#1475). The primary world stays listings.world_slug.';

-- Prevent primary world repetition in listing_worlds
create or replace function public.check_listing_worlds_not_primary()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_primary text;
begin
  select world_slug into v_primary from public.listings where listing_id = new.listing_id;
  if v_primary is not null and new.world_slug = v_primary then
    raise exception 'cannot add primary world as additional world' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_listing_worlds_not_primary on public.listing_worlds;
create trigger trg_check_listing_worlds_not_primary
  before insert or update on public.listing_worlds
  for each row
  execute function public.check_listing_worlds_not_primary();

-- If primary world updates to an additional world, remove it from listing_worlds
create or replace function public.check_listing_primary_not_in_additional()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.world_slug is distinct from old.world_slug then
    delete from public.listing_worlds
     where listing_id = new.listing_id
       and world_slug = new.world_slug;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_listing_primary_not_in_additional on public.listings;
create trigger trg_check_listing_primary_not_in_additional
  before update of world_slug on public.listings
  for each row
  execute function public.check_listing_primary_not_in_additional();

-- RLS
alter table public.listing_worlds enable row level security;

drop policy if exists "listing_worlds_select" on public.listing_worlds;
create policy "listing_worlds_select"
  on public.listing_worlds for select
  using (
    exists (
      select 1 from public.listings l
       where l.listing_id = listing_worlds.listing_id
         and (
           (l.status = 'open' and l.moderation_status = 'published')
           or l.owner_id = auth.uid()
           or public.is_admin(auth.uid())
         )
    )
  );

drop policy if exists "listing_worlds_insert" on public.listing_worlds;
create policy "listing_worlds_insert"
  on public.listing_worlds for insert
  with check (
    exists (
      select 1 from public.listings l
       where l.listing_id = listing_worlds.listing_id
         and (l.owner_id = auth.uid() or public.is_admin(auth.uid()))
    )
  );

drop policy if exists "listing_worlds_delete" on public.listing_worlds;
create policy "listing_worlds_delete"
  on public.listing_worlds for delete
  using (
    exists (
      select 1 from public.listings l
       where l.listing_id = listing_worlds.listing_id
         and (l.owner_id = auth.uid() or public.is_admin(auth.uid()))
    )
  );

-- ── 2. Helper RPCs ────────────────────────────────────────────────────────────────────

create or replace function public.get_listing_additional_worlds(p_listing_id uuid)
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(lw.world_slug order by lw.world_slug), array[]::text[])
    from public.listing_worlds lw
   where lw.listing_id = p_listing_id;
$$;

grant execute on function public.get_listing_additional_worlds(uuid) to authenticated, anon;

create or replace function public.set_listing_additional_worlds(
  p_listing_id uuid,
  p_world_slugs text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_primary text;
  v_slug text;
begin
  select owner_id, world_slug into v_owner, v_primary
    from public.listings
   where listing_id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_owner <> v_uid and not public.is_admin(v_uid) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  delete from public.listing_worlds where listing_id = p_listing_id;

  if p_world_slugs is not null then
    foreach v_slug in array p_world_slugs loop
      if v_slug is not null and v_slug <> v_primary then
        insert into public.listing_worlds (listing_id, world_slug)
        values (p_listing_id, v_slug)
        on conflict do nothing;
      end if;
    end loop;
  end if;
end;
$$;

revoke all on function public.set_listing_additional_worlds(uuid, text[]) from public;
grant execute on function public.set_listing_additional_worlds(uuid, text[]) to authenticated;

-- ── 3. create_marketplace_listing with p_additional_world_slugs ───────────────────────
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
  v_listing_id uuid;
  v_post_id uuid;
  v_geo geography;
  v_body public.external_bodies;
  v_city text;
  v_slug text;
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

  if p_additional_world_slugs is not null then
    foreach v_slug in array p_additional_world_slugs loop
      if v_slug is not null and v_slug <> v_kind.world_slug then
        insert into public.listing_worlds (listing_id, world_slug)
        values (v_listing_id, v_slug)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  return v_listing_id;
end;
$$;

revoke all on function public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text, double precision, double precision, numeric, text[], uuid, text[]
) from public;

grant execute on function public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text, double precision, double precision, numeric, text[], uuid, text[]
) to authenticated;

-- ── 4. browse_listings (multi-world feed) ─────────────────────────────────────────────
create or replace function public.browse_listings(
  p_world_slug text DEFAULT NULL::text,
  p_direction text DEFAULT NULL::text,
  p_urgency_min smallint DEFAULT NULL::smallint,
  p_availability text DEFAULT NULL::text,
  p_lat double precision DEFAULT NULL::double precision,
  p_lng double precision DEFAULT NULL::double precision,
  p_radius_km numeric DEFAULT NULL::numeric,
  p_limit integer DEFAULT 24,
  p_offset integer DEFAULT 0,
  p_viewer uuid DEFAULT auth.uid(),
  p_cursor_sort double precision DEFAULT NULL::double precision,
  p_cursor_urgency smallint DEFAULT NULL::smallint,
  p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_cursor_id uuid DEFAULT NULL::uuid,
  p_category_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  listing_id uuid,
  world_slug text,
  kind_slug text,
  direction text,
  title text,
  summary text,
  urgency_level smallint,
  availability_status text,
  city_id text,
  distance_km numeric,
  geo geography,
  created_at timestamp with time zone,
  sort_key double precision
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
declare
  v_anchor geography;
  v_radius_m double precision := least(greatest(coalesce(p_radius_km, 25), 0.1), 500)::double precision * 1000.0;
  v_lim int := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_skip int := case when p_cursor_id is null then least(greatest(coalesce(p_offset, 0), 0), 10000) else 0 end;
  v_has_cursor boolean := p_cursor_id is not null and p_cursor_created_at is not null;
  v_n int := 0;
  v_cur refcursor;
  r record;
  v_post public.posts;
begin
  if (p_lat is null) <> (p_lng is null)
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if p_lat is not null and p_lng is not null then
    v_anchor := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::geography;
  elsif p_viewer is not null then
    select coalesce(ugp.home_geo, public.listing_geo_from_city(ugp.home_city_id))
      into v_anchor
      from public.user_geo_prefs ugp
     where ugp.user_id = p_viewer;
  end if;

  if v_anchor is null then
    open v_cur for
      select l as lrow, 1e15::double precision as sk
        from public.listings l
       where l.status = 'open'
         and l.moderation_status = 'published'
         and l.world_slug <> 'romantic_matchmaking'
         and (
           p_world_slug is null
           or l.world_slug = p_world_slug
           or exists (
             select 1 from public.listing_worlds lw
              where lw.listing_id = l.listing_id and lw.world_slug = p_world_slug
           )
         )
         and (p_direction is null or l.direction = p_direction)
         and (p_urgency_min is null or l.urgency_level >= p_urgency_min)
         and (p_availability is null or l.availability_status = p_availability)
         and (p_category_id is null or l.category_id = p_category_id)
         and (
           not v_has_cursor
           or (l.urgency_level, l.created_at, l.listing_id)
              < (p_cursor_urgency, p_cursor_created_at, p_cursor_id)
         )
       order by l.urgency_level desc, l.created_at desc, l.listing_id desc;
  else
    open v_cur for
      select c.lrow, c.sk
        from (
          select l as lrow,
                 l.urgency_level as urg,
                 l.created_at as cat,
                 l.listing_id as lid,
                 case when l.geo is null then 1e15::double precision
                      else extensions.st_distance(v_anchor, l.geo)
                 end as sk
            from public.listings l
           where l.status = 'open'
             and l.moderation_status = 'published'
             and l.world_slug <> 'romantic_matchmaking'
             and (
               p_world_slug is null
               or l.world_slug = p_world_slug
               or exists (
                 select 1 from public.listing_worlds lw
                  where lw.listing_id = l.listing_id and lw.world_slug = p_world_slug
               )
             )
             and (p_direction is null or l.direction = p_direction)
             and (p_urgency_min is null or l.urgency_level >= p_urgency_min)
             and (p_availability is null or l.availability_status = p_availability)
             and (p_category_id is null or l.category_id = p_category_id)
             and (l.geo is null or extensions.st_dwithin(l.geo, v_anchor, v_radius_m))
        ) c
       where not v_has_cursor
          or c.sk > p_cursor_sort
          or (c.sk = p_cursor_sort
              and (c.urg, c.cat, c.lid) < (p_cursor_urgency, p_cursor_created_at, p_cursor_id))
       order by c.sk, c.urg desc, c.cat desc, c.lid desc;
  end if;

  loop
    fetch v_cur into r;
    exit when not found;

    v_post := null;
    if (r.lrow).origin = 'native' and (r.lrow).legacy_post_id is not null then
      select * into v_post from public.posts where post_id = (r.lrow).legacy_post_id;
    end if;
    if v_post.post_id is not null then
      continue when not public.post_listing_visible_to(v_post, p_viewer);
    else
      continue when not public.is_listing_visible_to(r.lrow, p_viewer);
    end if;
    if v_skip > 0 then
      v_skip := v_skip - 1;
      continue;
    end if;

    listing_id := (r.lrow).listing_id;
    if v_post.post_id is not null then
      world_slug := v_post.world_slug;
      select lk.slug into kind_slug from public.listing_kinds lk
       where lk.kind_id = coalesce(v_post.kind_id, (r.lrow).kind_id);
      direction := case when v_post.direction = 'request' then 'request' else 'give' end;
      urgency_level := v_post.urgency_level;
      availability_status := v_post.availability_status;
      geo := v_post.geo;
    else
      world_slug := (r.lrow).world_slug;
      select lk.slug into kind_slug from public.listing_kinds lk where lk.kind_id = (r.lrow).kind_id;
      direction := (r.lrow).direction;
      urgency_level := (r.lrow).urgency_level;
      availability_status := (r.lrow).availability_status;
      geo := (r.lrow).geo;
    end if;
    title := (r.lrow).title;
    summary := (r.lrow).summary;
    city_id := (r.lrow).city_id;
    distance_km := case when r.sk >= 1e15 then null else (r.sk / 1000.0)::numeric end;
    created_at := (r.lrow).created_at;
    sort_key := r.sk;
    return next;

    v_n := v_n + 1;
    exit when v_n >= v_lim;
  end loop;
  close v_cur;
end;
$function$;

revoke all on function public.browse_listings(
  text, text, smallint, text, double precision, double precision, numeric, integer, integer, uuid,
  double precision, smallint, timestamp with time zone, uuid, uuid
) from public;

grant execute on function public.browse_listings(
  text, text, smallint, text, double precision, double precision, numeric, integer, integer, uuid,
  double precision, smallint, timestamp with time zone, uuid, uuid
) to authenticated, anon;

-- ── 5. search_listings (multi-world search) ───────────────────────────────────────────
create or replace function public.search_listings(
  p_query text,
  p_world_slug text default null,
  p_limit integer default 20,
  p_viewer uuid default auth.uid(),
  p_cursor_score double precision default null,
  p_cursor_id uuid default null
)
returns table (
  listing_id uuid,
  title text,
  world_slug text,
  kind_slug text,
  direction text,
  urgency_level smallint,
  availability_status text,
  city_id text,
  created_at timestamptz,
  score double precision
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_q tsquery;
  v_lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_has_cursor boolean := p_cursor_score is not null and p_cursor_id is not null;
  v_cur refcursor;
  r record;
  v_post public.posts;
  v_n integer := 0;
begin
  if p_query is null or trim(p_query) = '' then
    return;
  end if;

  v_q := websearch_to_tsquery('hebrew_nostop', p_query);
  if v_q is null or v_q = ''::tsquery then
    v_q := plainto_tsquery('simple', p_query);
  end if;
  if v_q is null or v_q = ''::tsquery then
    return;
  end if;

  open v_cur for
    select
      l as lrow,
      (ts_rank_cd(l.search_vector, v_q, 32)::double precision) as scr
    from public.listings l
    where l.status = 'open'
      and l.moderation_status = 'published'
      and l.world_slug <> 'romantic_matchmaking'
      and (
        p_world_slug is null
        or l.world_slug = p_world_slug
        or exists (
          select 1 from public.listing_worlds lw
           where lw.listing_id = l.listing_id and lw.world_slug = p_world_slug
        )
      )
      and l.search_vector @@ v_q
      and (
        not v_has_cursor
        or (ts_rank_cd(l.search_vector, v_q, 32)::double precision, l.listing_id)
           < (p_cursor_score, p_cursor_id)
      )
    order by scr desc, l.listing_id desc;

  loop
    fetch v_cur into r;
    exit when not found;

    v_post := null;
    if (r.lrow).origin = 'native' and (r.lrow).legacy_post_id is not null then
      select * into v_post from public.posts where post_id = (r.lrow).legacy_post_id;
    end if;
    if v_post.post_id is not null then
      continue when not public.post_listing_visible_to(v_post, p_viewer);
    else
      continue when not public.is_listing_visible_to(r.lrow, p_viewer);
    end if;

    listing_id := (r.lrow).listing_id;
    title := (r.lrow).title;
    if v_post.post_id is not null then
      world_slug := v_post.world_slug;
      select lk.slug into kind_slug from public.listing_kinds lk
       where lk.kind_id = coalesce(v_post.kind_id, (r.lrow).kind_id);
      direction := case when v_post.direction = 'request' then 'request' else 'give' end;
      urgency_level := v_post.urgency_level;
      availability_status := v_post.availability_status;
    else
      world_slug := (r.lrow).world_slug;
      select lk.slug into kind_slug from public.listing_kinds lk where lk.kind_id = (r.lrow).kind_id;
      direction := (r.lrow).direction;
      urgency_level := (r.lrow).urgency_level;
      availability_status := (r.lrow).availability_status;
    end if;
    city_id := (r.lrow).city_id;
    created_at := (r.lrow).created_at;
    score := r.scr;
    return next;

    v_n := v_n + 1;
    exit when v_n >= v_lim;
  end loop;
  close v_cur;
end;
$$;

revoke all on function public.search_listings(text, text, integer, uuid, double precision, uuid) from public;
grant execute on function public.search_listings(text, text, integer, uuid, double precision, uuid) to authenticated, anon;

-- ── 6. feed_ranked_ids (filter by worlds includes additional worlds) ──────────────────
create or replace function public.feed_ranked_ids(
  p_viewer_id uuid,
  p_filter_type text default null,
  p_filter_categories text[] default null,
  p_filter_item_conditions text[] default null,
  p_filter_status text default 'open',
  p_filter_center_city text default null,
  p_filter_radius_km double precision default null,
  p_sort_order text default 'newest',
  p_proximity_sort_city text default null,
  p_page_limit integer default 20,
  p_cursor_distance double precision default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_post_id uuid default null,
  p_filter_search_query text default null,
  p_followers_only boolean default false,
  p_cursor_rank_score double precision default null,
  p_filter_worlds text[] default null,
  p_filter_subcategories text[] default null
)
returns table (
  post_id uuid,
  distance_km double precision,
  rank_score double precision
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_center_lat double precision;
  v_center_lon double precision;
  v_filter_lat double precision;
  v_filter_lon double precision;
  v_status_set text[];
  v_search_esc text;
  v_sort text;
  v_use_mv boolean := false;
  w_fresh double precision;
  w_follow double precision;
  w_eng double precision;
  w_geo double precision;
  w_cat double precision;
  v_lim integer := greatest(1, least(coalesce(p_page_limit, 20), 100));
  v_n integer := 0;
  v_cur refcursor;
  r record;
begin
  if p_filter_status = 'all' then
    v_status_set := array['open', 'completed', 'cancelled'];
  elsif p_filter_status = 'closed' then
    v_status_set := array['completed', 'cancelled'];
  else
    v_status_set := array['open'];
  end if;

  v_sort := coalesce(p_sort_order, 'newest');

  if p_filter_center_city is not null then
    select latitude, longitude into v_filter_lat, v_filter_lon
    from public.cities
    where id = p_filter_center_city;
  end if;

  if p_proximity_sort_city is not null then
    select latitude, longitude into v_center_lat, v_center_lon
    from public.cities
    where id = p_proximity_sort_city;
  elsif p_viewer_id is not null then
    select c.latitude, c.longitude into v_center_lat, v_center_lon
    from public.users u
    join public.cities c on c.id = u.city
    where u.user_id = p_viewer_id;
  end if;

  if p_filter_search_query is not null and trim(p_filter_search_query) <> '' then
    v_search_esc := replace(replace(replace(trim(p_filter_search_query), '\', '\\'), '%', '\%'), '_', '\_');
  end if;

  open v_cur for
    select
      p.post_id as pid,
      case
        when v_center_lat is not null and p.latitude is not null then
          6371.0 * 2.0 * asin(sqrt(
            power(sin(radians(p.latitude - v_center_lat) / 2.0), 2) +
            cos(radians(v_center_lat)) * cos(radians(p.latitude)) *
            power(sin(radians(p.longitude - v_center_lon) / 2.0), 2)
          ))
        else null
      end as dist_km,
      0.0::double precision as rscore
    from public.feed_visible_posts p
    where p.status = any(v_status_set)
      and (p_filter_type is null or p.type = p_filter_type)
      and (p_filter_categories is null or p.category = any(p_filter_categories))
      and (p_filter_item_conditions is null or p.item_condition = any(p_filter_item_conditions))
      and (
        p_filter_worlds is null
        or coalesce(p.listing_world_slug, 'items') = any(p_filter_worlds)
        or (
          p.listing_id is not null
          and exists (
            select 1 from public.listing_worlds lw
             where lw.listing_id = p.listing_id
               and lw.world_slug = any(p_filter_worlds)
          )
        )
      )
      and (
        p_filter_subcategories is null
        or (p.listing_id is not null and exists (
          select 1 from public.listings l
          join public.categories c on c.category_id = l.category_id
          where l.listing_id = p.listing_id
            and c.slug = any(p_filter_subcategories)
        ))
      )
      and (
        v_filter_lat is null or p_filter_radius_km is null
        or (p.latitude is not null and (
          6371.0 * 2.0 * asin(sqrt(
            power(sin(radians(p.latitude - v_filter_lat) / 2.0), 2) +
            cos(radians(v_filter_lat)) * cos(radians(p.latitude)) *
            power(sin(radians(p.longitude - v_filter_lon) / 2.0), 2)
          )) <= p_filter_radius_km
        ))
      )
      and (
        v_search_esc is null
        or p.title ilike '%' || v_search_esc || '%'
        or coalesce(p.description, '') ilike '%' || v_search_esc || '%'
      )
      and (
        not p_followers_only
        or p_viewer_id is null
        or exists (
          select 1 from public.follows f
          where f.follower_id = p_viewer_id and f.following_id = p.owner_id
        )
      )
      and (
        p_cursor_created_at is null
        or (p.created_at, p.post_id) < (p_cursor_created_at, p_cursor_post_id)
      )
    order by p.created_at desc, p.post_id desc;

  loop
    fetch v_cur into r;
    exit when not found;
    post_id := r.pid;
    distance_km := r.dist_km;
    rank_score := r.rscore;
    return next;
    v_n := v_n + 1;
    exit when v_n >= v_lim;
  end loop;
  close v_cur;
end;
$$;

revoke all on function public.feed_ranked_ids(
  uuid, text, text[], text[], text, text, double precision,
  text, text, integer, double precision, timestamptz, uuid, text, boolean, double precision, text[], text[]
) from public;

grant execute on function public.feed_ranked_ids(
  uuid, text, text[], text[], text, text, double precision,
  text, text, integer, double precision, timestamptz, uuid, text, boolean, double precision, text[], text[]
) to authenticated, anon;

-- ── 7. matching_v2 candidate query (cross-world pairing) ──────────────────────────────
create or replace function public.match_generate_candidates_for_listing(
  p_listing public.listings
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_src record;
  v_set public.matching_settings;
  v_world public.worlds;
  v_count integer := 0;
  v_opp_dir text;
begin
  select * into v_set from public.get_matching_settings();
  if not coalesce(v_set.enabled, false) then
    return 0;
  end if;

  select p_listing.listing_id as listing_id,
         p_listing.owner_id as owner_id,
         case when po.post_id is null then p_listing.world_slug else po.world_slug end as world_slug,
         case when po.post_id is null then (case when p_listing.direction = 'request' then 'request' else 'give' end)
              else (case when po.direction = 'request' then 'request' else 'give' end) end as direction,
         case when po.post_id is null then p_listing.urgency_level else coalesce(po.urgency_level, p_listing.urgency_level) end as urgency_level,
         case when po.post_id is null then p_listing.anonymity_level else 0 end as anonymity_level,
         case when po.post_id is null then p_listing.status else p_listing.status end as status,
         case when po.post_id is null then p_listing.moderation_status else p_listing.moderation_status end as moderation_status,
         case when po.post_id is null then p_listing.details else coalesce(po.details, p_listing.details) end as details,
         case when po.post_id is null then p_listing.geo else coalesce(po.geo, p_listing.geo) end as geo
    into v_src
    from (select 1) _
    left join public.posts po on po.post_id = p_listing.legacy_post_id and p_listing.origin = 'native';

  if v_src.status <> 'open' or v_src.moderation_status <> 'published'
     or not (v_src.world_slug = any (v_set.worlds)) or v_src.anonymity_level = 1 then
    return 0;
  end if;

  v_opp_dir := case when v_src.direction = 'give' then 'request' else 'give' end;
  select * into v_world from public.worlds where slug = v_src.world_slug;

  with pool as (
    select c.*,
           extensions.st_distance(v_src.geo, c.geo) / 1000.0 as dist_km
      from public.listings c
     where (
       c.world_slug = v_src.world_slug
       or exists (
         select 1 from public.listing_worlds lw
          where lw.listing_id = c.listing_id and lw.world_slug = v_src.world_slug
       )
       or exists (
         select 1 from public.listing_worlds lw
          where lw.listing_id = v_src.listing_id and lw.world_slug = c.world_slug
       )
       or exists (
         select 1 from public.listing_worlds lw1
          join public.listing_worlds lw2 on lw1.world_slug = lw2.world_slug
          where lw1.listing_id = v_src.listing_id and lw2.listing_id = c.listing_id
       )
     )
       and c.direction = v_opp_dir
       and c.status = 'open'
       and c.moderation_status = 'published'
       and c.owner_id <> v_src.owner_id
       and c.anonymity_level <> 1
       and (
         v_src.geo is null or c.geo is null
         or v_src.world_slug = 'rides'
         or extensions.st_dwithin(v_src.geo, c.geo, coalesce(v_set.max_distance_km, 30.0) * 1000.0)
       )
       and not exists (
         select 1 from public.blocks b
          where (b.blocker_id = v_src.owner_id and b.blocked_id = c.owner_id)
             or (b.blocker_id = c.owner_id and b.blocked_id = v_src.owner_id)
       )
       and not exists (
         select 1 from public.mutes m
          where (m.user_id = v_src.owner_id and m.muted_id = c.owner_id)
             or (m.user_id = c.owner_id and m.muted_id = v_src.owner_id)
       )
     order by
       case when v_src.world_slug = 'rides' then
         abs(extract(epoch from ((v_src.details ->> 'departs_at')::timestamptz - (c.details ->> 'departs_at')::timestamptz)))
       else
         extensions.st_distance(v_src.geo, c.geo)
       end nulls last
     limit coalesce(v_set.candidate_pool_limit, 50)
  ),
  scored as (
    select
      case when v_src.direction = 'give' then v_src.listing_id else p.listing_id end as offer_id,
      case when v_src.direction = 'give' then p.listing_id else v_src.listing_id end as request_id,
      case when v_src.direction = 'give' then v_src.owner_id else p.owner_id end as offer_owner,
      case when v_src.direction = 'give' then p.owner_id else v_src.owner_id end as request_owner,
      p.dist_km,
      case when v_src.direction = 'give'
        then public.match_score_pair(v_src.listing_id, p.listing_id)
        else public.match_score_pair(p.listing_id, v_src.listing_id)
      end as res
    from pool p
  )
  insert into public.match_candidates (
    offer_listing_id, request_listing_id, offer_owner_id, request_owner_id, world_slug,
    score, components, distance_km, updated_at
  )
  select
    s.offer_id, s.request_id, s.offer_owner, s.request_owner,
    v_src.world_slug, (s.res).score, (s.res).components, s.dist_km, clock_timestamp()
  from scored s
  where (s.res).score >= coalesce(v_set.min_score_threshold, 0.60)
  on conflict (offer_listing_id, request_listing_id)
  do update set
    score = excluded.score,
    components = excluded.components,
    distance_km = excluded.distance_km,
    updated_at = excluded.updated_at;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

commit;
