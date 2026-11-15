-- 0321_marketplace_typed_details | Epic #893 / #904
-- Per-world JSON Schema tightening + dev seed rows (one per active world).

begin;

update public.listing_kinds
   set detail_schema = detail_schema || '{"additionalProperties":false}'::jsonb
 where detail_schema->>'type' = 'object'
   and not (detail_schema ? 'additionalProperties');

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

revoke all on function public.validate_listing_details(uuid, jsonb) from public;
grant execute on function public.validate_listing_details(uuid, jsonb) to anon, authenticated, service_role;

create or replace function public.create_marketplace_listing(
  p_kind_id uuid,
  p_title text,
  p_summary text default null,
  p_details jsonb default '{}'::jsonb,
  p_direction text default null,
  p_category_id uuid default null,
  p_city_id text default null,
  p_urgency_level smallint default 2,
  p_availability_status text default 'ongoing'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kind public.listing_kinds;
  v_dir text;
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

  if not public.validate_listing_details(p_kind_id, p_details) then
    raise exception 'details_schema_mismatch' using errcode = '23514';
  end if;

  insert into public.listings (
    owner_id, world_slug, kind_id, category_id, direction, title, summary, details,
    city_id, urgency_level, availability_status, origin, moderation_status
  ) values (
    v_uid, v_kind.world_slug, p_kind_id, p_category_id, v_dir, p_title, p_summary, coalesce(p_details, '{}'::jsonb),
    p_city_id, coalesce(p_urgency_level, 2), coalesce(p_availability_status, 'ongoing'),
    'native', 'published'
  )
  returning listing_id into v_listing_id;

  return v_listing_id;
end;
$$;

revoke all on function public.create_marketplace_listing(uuid, text, text, jsonb, text, uuid, text, smallint, text) from public;
grant execute on function public.create_marketplace_listing(uuid, text, text, jsonb, text, uuid, text, smallint, text) to authenticated;

-- NOTE: an earlier draft seeded one "[demo]" listing per world here. It was removed
-- before this migration was applied anywhere: the bare '{}' details violate the 0266
-- world rules (items_image_required, food_expiry_required, routed-world external body)
-- on any project with active users (failed DB deploy run 38991437180 on kc-dev), and
-- demo rows must never ship to prod. QA listings belong in supabase/seed/kc-dev.

commit;
