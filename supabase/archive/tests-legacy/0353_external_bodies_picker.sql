-- supabase/tests/0353_external_bodies_picker.sql | 0353 external-organisation picker

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
         account_status = 'active', privacy_mode = 'Public'
   where user_id = p_id;
end $$;

select pg_temp.mk_user('00000000-0000-0000-0000-000000353001', 'org_member');
select pg_temp.mk_user('00000000-0000-0000-0000-000000353002', 'org_moderator');
-- animals / medical worlds require a verified member (0264 has_world_permission).
update public.users set verified_at = now() where user_id = '00000000-0000-0000-0000-000000353001';
insert into public.admin_role_grants (user_id, role)
values ('00000000-0000-0000-0000-000000353002', 'moderator');

-- 1) RLS: anon/authenticated only see active + verified bodies.
set local role anon;
do $$
begin
  if exists (select 1 from public.external_bodies where slug = 'municipal_ewaste') then
    raise exception 'ASSERT FAILED: unverified body visible to anon';
  end if;
  if not exists (select 1 from public.external_bodies where slug = 'mda') then
    raise exception 'ASSERT FAILED: verified body hidden from anon';
  end if;
end $$;
reset role;

-- 2) Search: scoped by world, matches he/en/slug, hides unverified, escapes LIKE wildcards.
do $$
declare
  v_n int;
begin
  select count(*) into v_n from public.search_external_bodies('animals', null, 20);
  if v_n < 2 then raise exception 'ASSERT FAILED: expected seeded animals bodies, got %', v_n; end if;

  select count(*) into v_n from public.search_external_bodies('animals', 'spca', 20);
  if v_n <> 1 then raise exception 'ASSERT FAILED: en search, got %', v_n; end if;

  -- Hebrew-label match without inline Hebrew (repo Hebrew-scan rule): search by a slice of label_he.
  select count(*) into v_n
    from public.search_external_bodies('environment',
           (select substr(label_he, 3, 6) from public.external_bodies where slug = 'spni'), 20);
  if v_n <> 1 then raise exception 'ASSERT FAILED: he search, got %', v_n; end if;

  select count(*) into v_n from public.search_external_bodies('environment', 'e-waste', 20);
  if v_n <> 0 then raise exception 'ASSERT FAILED: unverified body returned by search'; end if;

  select count(*) into v_n from public.search_external_bodies('medical', 'spca', 20);
  if v_n <> 0 then raise exception 'ASSERT FAILED: search leaked across worlds'; end if;

  select count(*) into v_n from public.search_external_bodies('animals', '%', 20);
  if v_n <> 0 then raise exception 'ASSERT FAILED: %% should be literal, got %', v_n; end if;
end $$;

-- 3) Admin RPCs: members are forbidden; moderators create (unverified) and verify.
do $$
declare
  v_id uuid;
  v_n int;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000353001')::text, true);
  begin
    perform public.admin_create_external_body('rogue_org', 'animals', 'Rogue org (he)', 'Rogue org');
    raise exception 'ASSERT FAILED: member should not create bodies';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000353002')::text, true);
  v_id := public.admin_create_external_body('test_shelter', 'animals', 'Test shelter (he)', 'Test shelter');
  select count(*) into v_n from public.search_external_bodies('animals', 'Test shelter', 20) where label_en = 'Test shelter';
  if v_n <> 0 then raise exception 'ASSERT FAILED: new body must start unverified'; end if;

  perform public.admin_set_external_body_status(v_id, true, null);
  select count(*) into v_n from public.search_external_bodies('animals', 'Test shelter', 20) where label_en = 'Test shelter';
  if v_n <> 1 then raise exception 'ASSERT FAILED: verified body should be searchable'; end if;

  select count(*) into v_n from public.admin_list_external_bodies('environment') where slug = 'municipal_ewaste';
  if v_n <> 1 then raise exception 'ASSERT FAILED: admin list should include unverified bodies'; end if;
end $$;

-- 4) create_marketplace_listing with an external body.
do $$
declare
  v_kind uuid;
  v_body uuid;
  v_other uuid;
  v_unverified uuid;
  v_id uuid;
  v_saved uuid;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000353001')::text, true);
  select kind_id into v_kind from public.listing_kinds where world_slug = 'animals' and slug = 'foster_offer';
  select body_id into v_body from public.external_bodies where slug = 'spca_israel';
  select body_id into v_other from public.external_bodies where slug = 'mda';
  select body_id into v_unverified from public.external_bodies where slug = 'municipal_ewaste';

  v_id := public.create_marketplace_listing(
    p_kind_id => v_kind, p_title => 'Foster a cat', p_details => '{"species":"cat","care_mode":"full_boarding"}'::jsonb,
    p_external_body_id => v_body);
  select external_body_id into v_saved from public.listings where listing_id = v_id;
  if v_saved is distinct from v_body then
    raise exception 'ASSERT FAILED: external_body_id not stored';
  end if;

  -- Animals are direct give and take since 0612: no body needed. Environment is still routed.
  perform public.create_marketplace_listing(p_kind_id => v_kind, p_title => 'No org',
    p_details => '{"species":"cat","care_mode":"pet_sitting"}'::jsonb, p_external_body_id => null::uuid);

  begin
    perform public.create_marketplace_listing(
      p_kind_id => (select kind_id from public.listing_kinds where world_slug = 'environment' and slug = 'recycling_give'),
      p_title => 'No org', p_details => '{}'::jsonb, p_external_body_id => null::uuid);
    raise exception 'ASSERT FAILED: routed world without body should fail';
  exception when check_violation then
    if sqlerrm <> 'routed_world_requires_external_body' then raise; end if;
  end;

  begin
    perform public.create_marketplace_listing(p_kind_id => v_kind, p_title => 'Wrong world org',
      p_details => '{"species":"cat","care_mode":"full_boarding"}'::jsonb, p_external_body_id => v_other);
    raise exception 'ASSERT FAILED: body from another world should fail';
  exception when check_violation then
    if sqlerrm <> 'external_body_invalid' then raise; end if;
  end;

  select kind_id into v_kind from public.listing_kinds where world_slug = 'environment' and slug = 'recycling_give';
  begin
    perform public.create_marketplace_listing(p_kind_id => v_kind, p_title => 'Unverified org',
      p_details => '{}'::jsonb, p_external_body_id => v_unverified);
    raise exception 'ASSERT FAILED: unverified body should fail';
  exception when check_violation then
    if sqlerrm <> 'external_body_invalid' then raise; end if;
  end;
end $$;

rollback;

\echo '✓ 0353_external_bodies_picker.sql passed'
