-- 0334_create_listing_geo_media | geo + radius + media attach on create.

begin;

create or replace function public.attach_listing_media(
  p_listing_id uuid,
  p_storage_paths text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_path text;
  v_ord smallint := 0;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  select owner_id into v_owner from public.listings where listing_id = p_listing_id;
  if v_owner is null then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_owner <> v_uid then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.listing_media where listing_id = p_listing_id;

  if p_storage_paths is null or cardinality(p_storage_paths) = 0 then
    return;
  end if;

  foreach v_path in array p_storage_paths loop
    if v_path is null or length(trim(v_path)) = 0 then
      continue;
    end if;
    if not (v_path like v_uid::text || '/%') then
      raise exception 'media_path_must_be_owned' using errcode = '23514';
    end if;
    insert into public.listing_media (listing_id, storage_path, sort_order)
    values (p_listing_id, v_path, v_ord);
    v_ord := v_ord + 1;
    if v_ord >= 10 then
      exit;
    end if;
  end loop;
end;
$$;

revoke all on function public.attach_listing_media(uuid, text[]) from public;
grant execute on function public.attach_listing_media(uuid, text[]) to authenticated;

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
  p_media_paths text[] default null
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

  if p_lat is not null and p_lng is not null then
    v_geo := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::geography;
  elsif p_city_id is not null then
    v_geo := public.listing_geo_from_city(p_city_id);
  end if;

  insert into public.listings (
    owner_id, world_slug, kind_id, category_id, direction, title, summary, details,
    city_id, geo, max_radius_km_override, urgency_level, availability_status, origin, moderation_status
  ) values (
    v_uid, v_kind.world_slug, p_kind_id, p_category_id, v_dir, p_title, p_summary, coalesce(p_details, '{}'::jsonb),
    p_city_id, v_geo, p_max_radius_km, coalesce(p_urgency_level, 2), coalesce(p_availability_status, 'ongoing'),
    'native', 'published'
  )
  returning listing_id into v_listing_id;

  perform public.attach_listing_media(v_listing_id, p_media_paths);

  return v_listing_id;
end;
$$;

revoke all on function public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text,
  double precision, double precision, numeric, text[]
) from public;
grant execute on function public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text,
  double precision, double precision, numeric, text[]
) to authenticated;

commit;
