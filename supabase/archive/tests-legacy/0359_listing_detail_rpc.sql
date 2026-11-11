-- supabase/tests/0359_listing_detail_rpc.sql | get_marketplace_listing_detail runs and returns the owner

begin;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
values ('00000000-0000-0000-0000-000000359001', 'detail_rpc@test.local', now(),
        jsonb_build_object('full_name', 'Display detail_rpc'),
        jsonb_build_object('provider', 'email'), 'authenticated', 'authenticated');
update public.users
   set share_handle = 'detail_rpc', display_name = 'Display detail_rpc',
       account_status = 'active', privacy_mode = 'Public'
 where user_id = '00000000-0000-0000-0000-000000359001';

select set_config('request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-0000-0000-000000359001', 'role', 'authenticated')::text, true);

do $$
declare
  v_kind uuid;
  v_id uuid;
  v_detail jsonb;
begin
  select kind_id into v_kind from public.listing_kinds where world_slug = 'items' and slug = 'give_item';
  v_id := public.create_marketplace_listing(
    p_kind_id => v_kind, p_title => 'Detail RPC chair', p_details => '{}'::jsonb,
    p_media_paths => null::text[]);
  v_detail := public.get_marketplace_listing_detail(v_id);
  if v_detail is null or v_detail->>'title' <> 'Detail RPC chair' then
    raise exception 'ASSERT FAILED: listing detail missing, got %', v_detail;
  end if;
  if v_detail->'owner'->>'user_id' <> '00000000-0000-0000-0000-000000359001' then
    raise exception 'ASSERT FAILED: listing detail owner wrong: %', v_detail->'owner';
  end if;
end $$;

rollback;

\echo '✓ 0359_listing_detail_rpc.sql passed'
