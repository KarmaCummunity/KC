-- 0353_external_bodies_picker | unblock medical / animals / environment create
-- 0266 requires listings.external_body_id (FK to public.external_bodies, 0241) for the
-- routed worlds, but create_marketplace_listing had no way to set it. This migration:
--   1. Tightens RLS: anon/authenticated read only active + verified bodies.
--   2. Adds search_external_bodies(world, query, limit) for the create-form picker.
--   3. Adds admin RPCs (super_admin/moderator) to list, create (unverified) and
--      verify/deactivate bodies. The is_verified flag is admin-managed.
--   4. Replaces create_marketplace_listing (13 params → 14) with p_external_body_id.
--      It must be an active, verified body of the same world, otherwise it raises
--      external_body_invalid.
--   5. Seeds verified reference bodies for animals + environment (medical already has some).

begin;

-- 1. RLS -------------------------------------------------------------------------
drop policy if exists external_bodies_select_all on public.external_bodies;
drop policy if exists external_bodies_select_verified on public.external_bodies;
create policy external_bodies_select_verified on public.external_bodies
  for select to anon, authenticated
  using (is_active and is_verified);

create index if not exists external_bodies_world_verified_idx
  on public.external_bodies (world_slug)
  where is_active and is_verified;

-- 2. Picker search ----------------------------------------------------------------
create or replace function public.search_external_bodies(
  p_world_slug text,
  p_query text default null,
  p_limit int default 20
)
returns table (
  body_id uuid,
  slug text,
  world_slug text,
  label_he text,
  label_en text,
  body_type text,
  contact_url text
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select nullif(trim(coalesce(p_query, '')), '') as raw
  ), pat as (
    select raw,
           case when raw is null then null
                else '%' || replace(replace(replace(raw, '\', '\\'), '%', '\%'), '_', '\_') || '%'
           end as like_pat
      from q
  )
  select b.body_id, b.slug, b.world_slug, b.label_he, b.label_en, b.body_type, b.contact_url
    from public.external_bodies b, pat
   where b.is_active
     and b.is_verified
     and b.world_slug = p_world_slug
     and (pat.like_pat is null
          or b.label_he ilike pat.like_pat
          or b.label_en ilike pat.like_pat
          or b.slug ilike pat.like_pat)
   order by
     (pat.raw is not null and (b.label_he ilike pat.raw || '%' or b.label_en ilike pat.raw || '%')) desc,
     b.label_en
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.search_external_bodies(text, text, int) from public;
grant execute on function public.search_external_bodies(text, text, int) to anon, authenticated;

-- 3. Admin management -------------------------------------------------------------
create or replace function public.admin_list_external_bodies(p_world_slug text default null)
returns setof public.external_bodies
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_role(auth.uid(), array['super_admin','moderator']);
  return query
    select * from public.external_bodies b
     where p_world_slug is null or b.world_slug = p_world_slug
     order by b.world_slug, b.label_en;
end;
$$;

revoke all on function public.admin_list_external_bodies(text) from public;
grant execute on function public.admin_list_external_bodies(text) to authenticated;

create or replace function public.admin_create_external_body(
  p_slug text,
  p_world_slug text,
  p_label_he text,
  p_label_en text,
  p_body_type text default 'ngo',
  p_contact_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.admin_assert_role(auth.uid(), array['super_admin','moderator']);
  insert into public.external_bodies (slug, world_slug, label_he, label_en, body_type, contact_url, is_verified)
  values (trim(p_slug), p_world_slug, trim(p_label_he), trim(p_label_en), p_body_type, nullif(trim(p_contact_url), ''), false)
  returning body_id into v_id;
  return v_id;
end;
$$;

revoke all on function public.admin_create_external_body(text, text, text, text, text, text) from public;
grant execute on function public.admin_create_external_body(text, text, text, text, text, text) to authenticated;

create or replace function public.admin_set_external_body_status(
  p_body_id uuid,
  p_is_verified boolean default null,
  p_is_active boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_role(auth.uid(), array['super_admin','moderator']);
  update public.external_bodies
     set is_verified = coalesce(p_is_verified, is_verified),
         is_active   = coalesce(p_is_active, is_active)
   where body_id = p_body_id;
  if not found then
    raise exception 'external_body_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_set_external_body_status(uuid, boolean, boolean) from public;
grant execute on function public.admin_set_external_body_status(uuid, boolean, boolean) to authenticated;

-- 4. create_marketplace_listing with p_external_body_id ------------------------------
drop function if exists public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text,
  double precision, double precision, numeric, text[]
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
  v_listing_id uuid;
  v_geo geography;
  v_body public.external_bodies;
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

  perform public.attach_listing_media(v_listing_id, p_media_paths);

  return v_listing_id;
end;
$$;

revoke all on function public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text,
  double precision, double precision, numeric, text[], uuid
) from public;
grant execute on function public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text,
  double precision, double precision, numeric, text[], uuid
) to authenticated;


-- 5. Reference bodies ---------------------------------------------------------------
insert into public.external_bodies (slug, world_slug, label_he, label_en, body_type, requires_routing, is_verified)
values
  ('spca_israel', 'animals', 'צער בעלי חיים בישראל', 'SPCA Israel', 'ngo', true, true),
  ('let_animals_live', 'animals', 'תנו לחיות לחיות', 'Let the Animals Live', 'ngo', true, true),
  ('spni', 'environment', 'החברה להגנת הטבע', 'Society for the Protection of Nature in Israel', 'ngo', true, true)
on conflict (slug) do nothing;

commit;
