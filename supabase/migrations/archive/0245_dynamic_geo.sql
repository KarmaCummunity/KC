-- 0245_dynamic_geo | Issue #828
-- user_geo_prefs, listing geo overrides, effective_geo() resolution.

begin;

create table public.user_geo_prefs (
  user_id            uuid primary key references public.users(user_id) on delete cascade,
  geo_mode           text check (geo_mode is null or geo_mode in ('local','regional','remote')),
  default_radius_km  numeric(8, 2) check (default_radius_km is null or default_radius_km > 0),
  geo_weight         numeric(4, 3) check (geo_weight is null or (geo_weight >= 0 and geo_weight <= 1)),
  home_city_id       text references public.cities(city_id),
  home_geo           geography(point, 4326),
  updated_at         timestamptz not null default now()
);

create trigger user_geo_prefs_set_updated_at
  before update on public.user_geo_prefs
  for each row execute function public.set_updated_at();

alter table public.user_geo_prefs enable row level security;

create policy user_geo_prefs_select_own on public.user_geo_prefs
  for select to authenticated using (user_id = auth.uid());

create policy user_geo_prefs_insert_own on public.user_geo_prefs
  for insert to authenticated with check (user_id = auth.uid());

create policy user_geo_prefs_update_own on public.user_geo_prefs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.listings
  add column if not exists geo_mode_override text
    check (geo_mode_override is null or geo_mode_override in ('local','regional','remote')),
  add column if not exists max_radius_km_override numeric(8, 2)
    check (max_radius_km_override is null or max_radius_km_override > 0),
  add column if not exists geo_weight_override numeric(4, 3)
    check (geo_weight_override is null or (geo_weight_override >= 0 and geo_weight_override <= 1));

comment on column public.listings.geo_mode_override is
  'Listing-level geo mode; wins over world defaults in effective_geo().';

-- Resolved geo parameters for matching/search (world ← listing override ← user prefs for viewer).
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

grant execute on function public.effective_geo(public.listings, uuid) to anon, authenticated, service_role;

commit;
