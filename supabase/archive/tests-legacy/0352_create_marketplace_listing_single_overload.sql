-- supabase/tests/0352_create_marketplace_listing_single_overload.sql | 0352

begin;

do $$
declare
  v_n int;
  v_args text;
begin
  select count(*), max(pg_get_function_identity_arguments(p.oid))
    into v_n, v_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_marketplace_listing';
  if v_n <> 1 then
    raise exception 'ASSERT FAILED: expected exactly 1 create_marketplace_listing overload, got %', v_n;
  end if;
  if v_args not like '%p_media_paths text[]%' then
    raise exception 'ASSERT FAILED: remaining overload should be the 13-param media version, got %', v_args;
  end if;
end $$;

-- A call using only the shared (9-param era) arguments resolves unambiguously now.
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

select pg_temp.mk_user('00000000-0000-0000-0000-000000352001', 'single_overload');
select set_config('request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-0000-0000-000000352001', 'role', 'authenticated')::text, true);

do $$
declare
  v_kind uuid;
  v_id uuid;
begin
  select kind_id into v_kind from public.listing_kinds where world_slug = 'items' and slug = 'give_item';
  v_id := public.create_marketplace_listing(
    p_kind_id => v_kind, p_title => 'Shared-args call',
    p_details => '{"image_url":"https://example.test/x.jpg"}'::jsonb);
  if v_id is null then
    raise exception 'ASSERT FAILED: shared-args call should return a listing id';
  end if;
end $$;

rollback;

\echo '✓ 0352_create_marketplace_listing_single_overload.sql passed'
