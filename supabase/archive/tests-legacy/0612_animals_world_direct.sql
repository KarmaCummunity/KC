-- supabase/tests/0612_animals_world_direct.sql | 0612 animals: direct give and take

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', privacy_mode = 'Public', verified_at = now()
   where user_id = p_id;
end $$;

select pg_temp.mk_user('00000000-0000-0000-0000-000000612001', 'animal_owner');
select set_config('request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-0000-0000-000000612001')::text, true);

do $$
declare
  v_kind uuid;
  v_id uuid;
  v_world text;
  v_n int;
begin
  -- 1) The four kinds exist, two per direction.
  select count(*) into v_n from public.listing_kinds
   where world_slug = 'animals' and is_active
     and slug in ('adoption_offer', 'adoption_request', 'foster_offer', 'foster_request');
  if v_n <> 4 then raise exception 'ASSERT FAILED: expected 4 animals kinds, got %', v_n; end if;
  select count(*) into v_n from public.listing_kinds where world_slug = 'animals' and direction = 'request';
  if v_n <> 2 then raise exception 'ASSERT FAILED: expected 2 animals request kinds, got %', v_n; end if;

  -- 2) A verified member hands an animal over without any external body.
  select kind_id into v_kind from public.listing_kinds where world_slug = 'animals' and slug = 'adoption_offer';
  v_id := public.create_marketplace_listing(p_kind_id => v_kind, p_title => 'Kitten to a good home',
    p_details => '{"species":"cat","age_group":"young","vaccinated":true,"good_with":["children"]}'::jsonb);
  if not exists (select 1 from public.listings where listing_id = v_id and external_body_id is null) then
    raise exception 'ASSERT FAILED: adoption offer not stored without a body';
  end if;

  -- 3) Boarding / pet-sitting offers and requests.
  select kind_id into v_kind from public.listing_kinds where world_slug = 'animals' and slug = 'foster_offer';
  perform public.create_marketplace_listing(p_kind_id => v_kind, p_title => 'Dog sitter, weekdays',
    p_details => '{"species":"dog","care_mode":"part_time","location_mode":"either"}'::jsonb);
  select kind_id into v_kind from public.listing_kinds where world_slug = 'animals' and slug = 'foster_request';
  perform public.create_marketplace_listing(p_kind_id => v_kind, p_title => 'Boarding for two weeks',
    p_details => '{"species":"cat","care_mode":"full_boarding","starts_on":"2026-12-01","ends_on":"2026-12-14"}'::jsonb);
  select kind_id into v_kind from public.listing_kinds where world_slug = 'animals' and slug = 'adoption_request';
  perform public.create_marketplace_listing(p_kind_id => v_kind, p_title => 'Looking for a small dog',
    p_details => '{"species":"dog","size":"small"}'::jsonb);

  -- 4) The binding schema rejects unknown keys and values.
  select kind_id into v_kind from public.listing_kinds where world_slug = 'animals' and slug = 'foster_offer';
  begin
    perform public.create_marketplace_listing(p_kind_id => v_kind, p_title => 'Bad care mode',
      p_details => '{"species":"dog","care_mode":"forever"}'::jsonb);
    raise exception 'ASSERT FAILED: unknown care_mode should fail';
  exception when others then
    if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  end;
  begin
    perform public.create_marketplace_listing(p_kind_id => v_kind, p_title => 'Missing species',
      p_details => '{"care_mode":"part_time"}'::jsonb);
    raise exception 'ASSERT FAILED: missing species should fail';
  exception when others then
    if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  end;

  -- 5) Animals listings reach the main feed with their world.
  select p.listing_world_slug into v_world from public.posts p where p.listing_id = v_id;
  if v_world is distinct from 'animals' then
    raise exception 'ASSERT FAILED: animals listing not mirrored into the feed (world %)', v_world;
  end if;

  -- 6) Medical and environment are still routed.
  begin
    perform public.create_marketplace_listing(
      p_kind_id => (select kind_id from public.listing_kinds where world_slug = 'environment' and slug = 'plant_give'),
      p_title => 'Plants', p_details => '{}'::jsonb);
    raise exception 'ASSERT FAILED: environment without a body should fail';
  exception when check_violation then
    if sqlerrm <> 'routed_world_requires_external_body' then raise; end if;
  end;
end $$;

rollback;

\echo '✓ 0612_animals_world_direct.sql passed'
