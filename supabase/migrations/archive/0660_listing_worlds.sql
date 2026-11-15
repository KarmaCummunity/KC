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
drop function if exists public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text, double precision, double precision, numeric, text[], uuid
);

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
) to anon, authenticated, service_role;

-- ── 5. search_listings (multi-world search; updates 0633) ───────────────────────────────
create or replace function public.search_listings(
  p_query text,
  p_world_slug text default null,
  p_limit int default 20,
  p_viewer uuid default auth.uid(),
  p_cursor_score numeric default null,
  p_cursor_id uuid default null
)
returns table (
  listing_id uuid,
  rrf_score numeric,
  fts_rank int,
  trgm_rank int,
  vector_rank int,
  geo_rank int
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_tsq tsquery;
  v_anchor geography;
  v_radius numeric := 25;
  v_geo_weight numeric := 1;
begin
  if v_q is null then
    raise exception 'query_required' using errcode = '22023';
  end if;
  v_tsq := plainto_tsquery('simple', v_q);
  perform set_config('pg_trgm.similarity_threshold', '0.15', true);

  if p_viewer is not null then
    select coalesce(ugp.home_geo, public.listing_geo_from_city(ugp.home_city_id)),
           coalesce(ugp.default_radius_km, 25),
           coalesce(ugp.geo_weight, 1)
      into v_anchor, v_radius, v_geo_weight
      from public.user_geo_prefs ugp
     where ugp.user_id = p_viewer;
  end if;

  return query
  with cand as (
    -- Index-backed text candidates (listings_search_vector_gin_idx, listings_title_trgm_idx).
    select l.listing_id
      from public.listings l
     where l.status = 'open'
       and l.moderation_status = 'published'
       and (
         p_world_slug is null
         or l.world_slug = p_world_slug
         or exists (
           select 1 from public.listing_worlds lw
            where lw.listing_id = l.listing_id and lw.world_slug = p_world_slug
         )
       )
       and l.world_slug <> 'romantic_matchmaking'
       and (l.search_vector @@ v_tsq or l.title % v_q)
  ),
  base as (
    select l.*,
           case when p.post_id is null then l.geo else p.geo end as record_geo,          -- 0632: the post's
           public.listing_embedding_of(l) as record_embedding                            -- 0633: the post's when it has one
      from cand c
      join public.listings l on l.listing_id = c.listing_id
      -- 0632: the post of a post-owned listing (food, rides, housing, time; 0554), the record.
      left join public.posts p on p.post_id = l.legacy_post_id and l.origin = 'native'    -- 0632
     where (case when p.post_id is null then public.is_listing_visible_to(l, p_viewer)    -- 0632
                 else public.post_listing_visible_to(p, p_viewer) end)                   -- 0632
  ),
  fts as (
    select b.listing_id,
           row_number() over (order by ts_rank_cd(b.search_vector, v_tsq) desc, b.listing_id) as rnk
      from base b
     where b.search_vector @@ v_tsq
  ),
  trgm as (
    select b.listing_id,
           row_number() over (order by similarity(b.title, v_q) desc, b.listing_id) as rnk
      from base b
     where similarity(b.title, v_q) > 0.15
  ),
  vec as (
    select b.listing_id,
           row_number() over (order by ts_rank_cd(b.search_vector, v_tsq) desc, b.listing_id) as rnk
      from base b
     where b.record_embedding is not null -- 0633
       and b.search_vector @@ v_tsq
  ),
  geo as (
    select b.listing_id,
           row_number() over (
             order by case
               when v_anchor is null or b.record_geo is null then 0.5 -- 0632
               else greatest(
                 0,
                 1 - (extensions.st_distance(v_anchor, b.record_geo) / 1000.0) / greatest(v_radius, 1) -- 0632
               ) * v_geo_weight
             end desc, b.listing_id
           ) as rnk
      from base b
  ),
  fused as (
    select b.listing_id,
      round(
        coalesce(1.0 / (60 + f.rnk), 0) + coalesce(1.0 / (60 + t.rnk), 0)
          + coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + g.rnk), 0),
        12
      ) as score,
      f.rnk::int as fts_rank, t.rnk::int as trgm_rank, v.rnk::int as vector_rank, g.rnk::int as geo_rank
    from base b
    left join fts f on f.listing_id = b.listing_id
    left join trgm t on t.listing_id = b.listing_id
    left join vec v on v.listing_id = b.listing_id
    left join geo g on g.listing_id = b.listing_id
    -- A text signal (FTS or trigram) is required; geo/vector only re-rank.
    where f.listing_id is not null or t.listing_id is not null
  )
  select fu.listing_id, fu.score, fu.fts_rank, fu.trgm_rank, fu.vector_rank, fu.geo_rank
    from fused fu
   where p_cursor_id is null
      or (fu.score, fu.listing_id) < (p_cursor_score, p_cursor_id)
   order by fu.score desc, fu.listing_id desc
   limit v_lim;
end;
$$;

revoke all on function public.search_listings(text, text, int, uuid, numeric, uuid) from public;
grant execute on function public.search_listings(text, text, int, uuid, numeric, uuid)
  to anon, authenticated, service_role;

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
  v_followed uuid[] := '{}'::uuid[];
  v_cats text[] := '{}'::text[];
  v_vc_lat double precision;
  v_vc_lon double precision;
  v_post public.posts;
begin
  v_sort := coalesce(p_sort_order, 'newest');
  if v_sort not in ('newest', 'oldest', 'distance', 'personalized') then
    v_sort := 'newest';
  end if;

  select coalesce(max(case when config_key = 'freshness' then weight end), 0.35),
         coalesce(max(case when config_key = 'follow_graph' then weight end), 0.25),
         coalesce(max(case when config_key = 'engagement' then weight end), 0.20),
         coalesce(max(case when config_key = 'geo' then weight end), 0.15),
         coalesce(max(case when config_key = 'interest_category' then weight end), 0.05)
    into w_fresh, w_follow, w_eng, w_geo, w_cat
    from public.feed_ranking_config;

  if v_sort = 'distance' then
    if p_proximity_sort_city is not null then
      select c.lat, c.lon into v_center_lat, v_center_lon
      from public.cities c where c.city_id = p_proximity_sort_city;
    elsif p_viewer_id is not null then
      select c.lat, c.lon into v_center_lat, v_center_lon
      from public.users u
      join public.cities c on c.city_id = u.city
      where u.user_id = p_viewer_id;
    end if;
    if v_center_lat is null then v_sort := 'newest'; end if;
  elsif v_sort = 'personalized' and p_viewer_id is null then
    v_sort := 'newest';
  end if;

  if p_filter_center_city is not null and p_filter_radius_km is not null then
    select c.lat, c.lon into v_filter_lat, v_filter_lon
    from public.cities c where c.city_id = p_filter_center_city;
  end if;

  v_status_set := case p_filter_status
    when 'open'   then array['open']::text[]
    when 'closed' then array['closed_delivered']::text[]
    when 'all'    then array['open','closed_delivered']::text[]
    else array['open']::text[]
  end;

  if p_filter_search_query is not null and length(trim(p_filter_search_query)) >= 2 then
    v_search_esc := public.escape_ilike(trim(p_filter_search_query));
  end if;

  v_use_mv := v_sort = 'newest'
    and v_search_esc is null
    and coalesce(p_followers_only, false) = false
    and p_filter_radius_km is null
    and p_filter_center_city is null;

  if p_viewer_id is not null then
    v_followed := coalesce(array(
      select fe.followed_id from public.follow_edges fe where fe.follower_id = p_viewer_id
    ), '{}'::uuid[]);
    if v_sort = 'personalized' then
      v_cats := coalesce(array(
        select distinct px.category
          from public.post_reactions pr
          join public.posts px on px.post_id = pr.post_id
         where pr.user_id = p_viewer_id
      ), '{}'::text[]);
      select c.lat, c.lon into v_vc_lat, v_vc_lon
        from public.users u
        join public.cities c on c.city_id = u.city
       where u.user_id = p_viewer_id;
    end if;
  end if;

  if v_use_mv then
    -- Newest fast path: walk feed_open_posts_mv_open_newest_idx in order.
    open v_cur for
      select p as prow, p.post_id as pid, null::double precision as dist, null::double precision as score
        from kc_private.feed_open_posts_mv fm
        join public.posts p on p.post_id = fm.post_id
        join public.cities c on c.city_id = fm.city
       where fm.status = any(v_status_set)
         and (p_filter_type is null or fm.type = p_filter_type)
         and (p_filter_categories is null or fm.category = any(p_filter_categories))
         and (p_filter_item_conditions is null or fm.item_condition = any(p_filter_item_conditions))
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
           or (
             p.listing_id is not null
             and exists (
               -- 0565: the post carries its listing's sub-category (posts.category_id, 0551).
               select 1 from public.categories cat
               where cat.category_id = p.category_id
                 and cat.slug = any(p_filter_subcategories)
             )
           )
           or (
             p.listing_id is null
             and exists (
               select 1 from public.categories cat
               where cat.world_slug = 'items'
                 and cat.legacy_post_category = p.category
                 and cat.slug = any(p_filter_subcategories)
             )
           )
         )
         and (
           p_cursor_created_at is null
           or (fm.created_at, fm.post_id) < (p_cursor_created_at, p_cursor_post_id)
         )
       order by fm.created_at desc, fm.post_id desc;
  elsif v_sort in ('personalized', 'distance') and v_search_esc is null then
    open v_cur for
      select q.prow, q.pid, q.dist, q.score
        from (
          select
            p as prow,
            fm.post_id as pid,
            fm.created_at as cat,
            case when v_sort = 'distance'
                 then public.haversine_km(v_center_lat, v_center_lon, c.lat, c.lon)
            end as dist,
            case when v_filter_lat is not null
                 then public.haversine_km(v_filter_lat, v_filter_lon, c.lat, c.lon)
            end as filter_dist,
            case when v_sort = 'personalized' then (
              w_fresh * (1.0 / (1.0 + extract(epoch from (now() - fm.created_at)) / 86400.0))
              + w_follow * case when fm.owner_id = any(v_followed) then 1.0 else 0.0 end
              + w_eng * ln(1.0 + fm.reaction_count + fm.comment_count)
              + w_geo * case when v_vc_lat is not null then
                  1.0 / (1.0 + public.haversine_km(v_vc_lat, v_vc_lon, c.lat, c.lon) / 50.0)
                else 0.0 end
              + w_cat * case when fm.category = any(v_cats) then 1.0 else 0.0 end
            )::double precision end as score
          from kc_private.feed_open_posts_mv fm
          join public.posts p on p.post_id = fm.post_id
          join public.cities c on c.city_id = fm.city
          where fm.status = any(v_status_set)
            and (p_filter_type is null or fm.type = p_filter_type)
            and (p_filter_categories is null or fm.category = any(p_filter_categories))
            and (p_filter_item_conditions is null or fm.item_condition = any(p_filter_item_conditions))
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
              or (
                p.listing_id is not null
                and exists (
                  -- 0565: the post carries its listing's sub-category (posts.category_id, 0551).
                  select 1 from public.categories cat
                  where cat.category_id = p.category_id
                    and cat.slug = any(p_filter_subcategories)
                )
              )
              or (
                p.listing_id is null
                and exists (
                  select 1 from public.categories cat
                  where cat.world_slug = 'items'
                    and cat.legacy_post_category = p.category
                    and cat.slug = any(p_filter_subcategories)
                )
              )
            )
            and (coalesce(p_followers_only, false) = false or fm.owner_id = any(v_followed))
        ) q
       where (p_filter_radius_km is null or q.filter_dist is null or q.filter_dist <= p_filter_radius_km)
         and (
           case
             when p_cursor_created_at is null then true
             when v_sort = 'personalized' then
               coalesce(q.score, 0) < coalesce(p_cursor_rank_score, 1e9)
               or (coalesce(q.score, 0) = coalesce(p_cursor_rank_score, 0)
                   and (q.cat, q.pid) < (p_cursor_created_at, p_cursor_post_id))
             else
               coalesce(q.dist, 1e9) > coalesce(p_cursor_distance, -1)
               or (coalesce(q.dist, 1e9) = coalesce(p_cursor_distance, -1)
                   and q.cat < p_cursor_created_at)
               or (coalesce(q.dist, 1e9) = coalesce(p_cursor_distance, -1)
                   and q.cat = p_cursor_created_at
                   and q.pid > p_cursor_post_id)
           end
         )
       order by
         case when v_sort = 'personalized' then q.score end desc nulls last,
         case when v_sort = 'distance' then q.dist end asc nulls last,
         q.cat desc,
         q.pid desc;
  else
    open v_cur for
      select q.prow, q.pid, q.dist, q.score
        from (
          select
            p as prow,
            p.post_id as pid,
            p.created_at as cat,
            case when v_sort = 'distance'
                 then public.haversine_km(v_center_lat, v_center_lon, c.lat, c.lon)
            end as dist,
            case when v_filter_lat is not null
                 then public.haversine_km(v_filter_lat, v_filter_lon, c.lat, c.lon)
            end as filter_dist,
            case when v_sort = 'personalized' then (
              w_fresh * (1.0 / (1.0 + extract(epoch from (now() - p.created_at)) / 86400.0))
              + w_follow * case when p.owner_id = any(v_followed) then 1.0 else 0.0 end
              + w_eng * ln(1.0 + coalesce(ps.reaction_count, 0) + coalesce(ps.comment_count, 0))
              + w_geo * case when v_vc_lat is not null then
                  1.0 / (1.0 + public.haversine_km(v_vc_lat, v_vc_lon, c.lat, c.lon) / 50.0)
                else 0.0 end
              + w_cat * case when p.category = any(v_cats) then 1.0 else 0.0 end
            )::double precision end as score
          from public.posts p
          join public.cities c on c.city_id = p.city
          left join public.post_stats ps on ps.post_id = p.post_id
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
              or (
                p.listing_id is not null
                and exists (
                  -- 0565: the post carries its listing's sub-category (posts.category_id, 0551).
                  select 1 from public.categories cat
                  where cat.category_id = p.category_id
                    and cat.slug = any(p_filter_subcategories)
                )
              )
              or (
                p.listing_id is null
                and exists (
                  select 1 from public.categories cat
                  where cat.world_slug = 'items'
                    and cat.legacy_post_category = p.category
                    and cat.slug = any(p_filter_subcategories)
                )
              )
            )
            and (
              v_search_esc is null
              or p.title ilike '%' || v_search_esc || '%' escape '\'
              or p.description ilike '%' || v_search_esc || '%' escape '\'
              or p.category ilike '%' || v_search_esc || '%' escape '\'
            )
            and (coalesce(p_followers_only, false) = false or p.owner_id = any(v_followed))
        ) q
       where (p_filter_radius_km is null or q.filter_dist is null or q.filter_dist <= p_filter_radius_km)
         and (
           case
             when p_cursor_created_at is null then true
             when v_sort = 'personalized' then
               coalesce(q.score, 0) < coalesce(p_cursor_rank_score, 1e9)
               or (coalesce(q.score, 0) = coalesce(p_cursor_rank_score, 0)
                   and (q.cat, q.pid) < (p_cursor_created_at, p_cursor_post_id))
             when v_sort = 'newest' then (q.cat, q.pid) < (p_cursor_created_at, p_cursor_post_id)
             when v_sort = 'oldest' then (q.cat, q.pid) > (p_cursor_created_at, p_cursor_post_id)
             when v_sort = 'distance' then
               coalesce(q.dist, 1e9) > coalesce(p_cursor_distance, -1)
               or (coalesce(q.dist, 1e9) = coalesce(p_cursor_distance, -1)
                   and q.cat < p_cursor_created_at)
               or (coalesce(q.dist, 1e9) = coalesce(p_cursor_distance, -1)
                   and q.cat = p_cursor_created_at
                   and q.pid > p_cursor_post_id)
             else true
           end
         )
       order by
         case when v_sort = 'personalized' then q.score end desc nulls last,
         case when v_sort = 'distance' then q.dist end asc nulls last,
         case when v_sort = 'oldest' then q.cat end asc,
         case when v_sort = 'oldest' then q.pid end asc,
         case when v_sort in ('newest', 'distance', 'personalized') then q.cat end desc,
         q.pid desc;
  end if;

  loop
    fetch v_cur into r;
    exit when not found;
    if (r.prow).post_id is null then
      select p.* into v_post
        from public.posts p
       where p.post_id = r.pid and p.status = any(v_status_set);
      continue when not found;
    else
      v_post := r.prow;
    end if;
    continue when not public.is_post_visible_to(v_post, p_viewer_id);
    -- A post that exists for a listing kept out of the main feed (0557) is not listed.
    continue when coalesce(v_post.feed_hidden, false);
    if p_viewer_id is not null then
      continue when exists (
        select 1 from public.feed_post_hides h
         where h.user_id = p_viewer_id and h.post_id = r.pid
      );
      continue when exists (
        select 1 from public.feed_mute_filters mf
         where mf.user_id = p_viewer_id
           and (
             (mf.filter_kind = 'user' and mf.filter_value = v_post.owner_id::text)
             or (mf.filter_kind in ('category', 'world') and mf.filter_value = v_post.category)
             or (mf.filter_kind = 'keyword' and (
               v_post.title ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
               or v_post.description ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
             ))
           )
      );
    end if;
    post_id := r.pid;
    distance_km := r.dist;
    rank_score := r.score;
    return next;
    v_n := v_n + 1;
    exit when v_n >= v_lim;
  end loop;
  close v_cur;
end;
$$;

revoke all on function public.feed_ranked_ids(
  uuid, text, text[], text[], text, text, double precision,
  text, text, integer, double precision, timestamptz, uuid, text, boolean, double precision,
  text[], text[]
) from public;

grant execute on function public.feed_ranked_ids(
  uuid, text, text[], text[], text, text, double precision,
  text, text, integer, double precision, timestamptz, uuid, text, boolean, double precision,
  text[], text[]
) to anon, authenticated, service_role;

commit;
