-- 0242_listings_registry | Issue #825
-- Unified offers/needs registry with RLS, legacy back-references, indexes.

begin;

create or replace function public.is_listing_operator(p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_viewer is not null and (
    public.has_admin_role(p_viewer, 'support')
    or public.has_admin_role(p_viewer, 'moderator')
    or public.has_admin_role(p_viewer, 'super_admin')
  );
$$;

revoke all on function public.is_listing_operator(uuid) from public;
grant execute on function public.is_listing_operator(uuid) to anon, authenticated, service_role;

-- ── listings ─────────────────────────────────────────────────────────────────
create table public.listings (
  listing_id           uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references public.users(user_id) on delete cascade,
  world_slug           text not null references public.worlds(slug),
  kind_id              uuid not null references public.listing_kinds(kind_id),
  category_id          uuid references public.categories(category_id) on delete set null,
  direction            text not null check (direction in ('give', 'request')),
  status               text not null default 'open'
    check (status in ('open','closed','cancelled','expired','removed_admin')),
  visibility           text not null default 'Public'
    check (visibility in ('Public','FollowersOnly','OnlyMe')),
  anonymity_level      smallint not null default 3 check (anonymity_level between 1 and 3),
  title                text not null check (char_length(title) between 1 and 120),
  summary              text check (summary is null or char_length(summary) <= 500),
  geo                  geography(point, 4326),
  city_id              text references public.cities(city_id),
  time_window          tstzrange,
  expires_at           timestamptz,
  details              jsonb not null default '{}'::jsonb,
  external_body_id     uuid references public.external_bodies(body_id) on delete set null,
  origin               text not null default 'native'
    check (origin in ('native','post','ride_listing')),
  canonical_id         uuid references public.listings(listing_id) on delete set null,
  legacy_post_id       uuid references public.posts(post_id) on delete cascade,
  legacy_ride_id       uuid references public.ride_listings(ride_id) on delete cascade,
  moderation_status    text not null default 'published'
    check (moderation_status in ('draft','pending_review','published','rejected')),
  published_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint listings_visibility_anonymity_sync check (
    visibility = public.anonymity_level_to_visibility(anonymity_level)
  ),
  constraint listings_legacy_origin_post check (
    origin <> 'post' or legacy_post_id is not null
  ),
  constraint listings_legacy_origin_ride check (
    origin <> 'ride_listing' or legacy_ride_id is not null
  ),
  constraint listings_single_legacy check (
    not (legacy_post_id is not null and legacy_ride_id is not null)
  )
);

create or replace function public.listings_enforce_kind_world()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_world text;
begin
  select world_slug into v_world from public.listing_kinds where kind_id = new.kind_id;
  if v_world is null then
    raise exception 'listing_kind_not_found' using errcode = '23503';
  end if;
  if new.world_slug is distinct from v_world then
    raise exception 'listing_kind_world_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger listings_kind_world_trg
  before insert or update of kind_id, world_slug on public.listings
  for each row execute function public.listings_enforce_kind_world();

create unique index listings_legacy_post_uidx
  on public.listings (legacy_post_id) where legacy_post_id is not null;

create unique index listings_legacy_ride_uidx
  on public.listings (legacy_ride_id) where legacy_ride_id is not null;

create index listings_open_world_recent_idx
  on public.listings (world_slug, created_at desc)
  where status = 'open' and moderation_status = 'published';

create index listings_geo_gist_idx
  on public.listings using gist (geo)
  where geo is not null and status = 'open';

create index listings_details_gin_idx
  on public.listings using gin (details jsonb_path_ops);

create index listings_title_trgm_idx
  on public.listings using gin (title gin_trgm_ops);

create index listings_expires_open_idx
  on public.listings (expires_at)
  where status = 'open' and expires_at is not null;

create trigger listings_set_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

-- Sync visibility from anonymity on write; stamp published_at once.
create or replace function public.listings_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_kind_slug text;
  v_world_anon smallint;
  v_ttl_hours integer;
begin
  if tg_op = 'INSERT' and new.origin = 'native' then
    select w.default_anonymity_level,
           coalesce(lk.default_ttl_hours, w.default_ttl_hours)
      into v_world_anon, v_ttl_hours
      from public.worlds w
      join public.listing_kinds lk on lk.kind_id = new.kind_id
     where w.slug = new.world_slug;

    -- World default caps openness; an explicitly more restrictive level
    -- (lower number) chosen by the author is preserved.
    new.anonymity_level := least(new.anonymity_level, coalesce(v_world_anon, new.anonymity_level));

    if new.expires_at is null and v_ttl_hours is not null then
      new.expires_at := now() + make_interval(hours => v_ttl_hours);
    end if;
  end if;

  new.visibility := public.anonymity_level_to_visibility(new.anonymity_level);

  if new.moderation_status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  select lk.slug into v_kind_slug
    from public.listing_kinds lk
   where lk.kind_id = new.kind_id;

  if new.world_slug = 'medical'
     and new.origin = 'native'
     and v_kind_slug in ('blood_appointment','adi_registration','living_donation_intent','blood_urgency_org')
     and new.external_body_id is null then
    raise exception 'medical_listing_requires_external_body'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger listings_before_write_trg
  before insert or update on public.listings
  for each row execute function public.listings_before_write();

-- After publish, anonymity may only become more restrictive (3→2→1).
create or replace function public.listings_anonymity_tighten_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.published_at is not null
     and new.anonymity_level > old.anonymity_level then
    raise exception 'anonymity_loosen_forbidden'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger listings_anonymity_tighten_only_trg
  before update of anonymity_level on public.listings
  for each row execute function public.listings_anonymity_tighten_only();

-- Optional JSON Schema validation (pg_jsonschema when installed).
create or replace function public.listings_validate_details_schema()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_schema jsonb;
  v_has_ext boolean;
begin
  select exists(select 1 from pg_extension where extname = 'pg_jsonschema') into v_has_ext;
  if not v_has_ext then
    return new;
  end if;

  select lk.detail_schema into v_schema
    from public.listing_kinds lk
   where lk.kind_id = new.kind_id;

  if v_schema is null then
    return new;
  end if;

  begin
    if not extensions.json_matches_schema(v_schema::json, new.details) then
      raise exception 'listing_details_schema_mismatch'
        using errcode = '23514';
    end if;
  exception
    when undefined_function then
      null;
  end;

  return new;
end;
$$;

create trigger listings_validate_details_trg
  before insert or update of details, kind_id on public.listings
  for each row execute function public.listings_validate_details_schema();

-- ── visibility predicate ─────────────────────────────────────────────────────
create or replace function public.is_listing_visible_to(p_listing public.listings, p_viewer uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_post public.posts;
  v_ride public.ride_listings;
begin
  if p_listing.owner_id = p_viewer then
    return true;
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

  if p_listing.moderation_status <> 'published' then
    return false;
  end if;

  if p_listing.status not in ('open', 'closed') then
    return false;
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

alter table public.listings enable row level security;

create policy listings_select_visible on public.listings
  for select using (public.is_listing_visible_to(listings.*, auth.uid()));

create policy listings_insert_own on public.listings
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and public.is_active_member(auth.uid())
  );

create policy listings_update_own on public.listings
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy listings_delete_own_open on public.listings
  for delete to authenticated
  using (owner_id = auth.uid() and status = 'open' and origin = 'native');

commit;
