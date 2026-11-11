-- supabase/tests/0048_donation_link_report_message.sql
-- Verifies report_donation_link() injects a system message with the right payload.

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;

create or replace function pg_temp.mk_user(p_handle text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (v_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         privacy_mode = 'Public', account_status = 'active'
   where user_id = v_id;
  return v_id;
end $$;

-- SETUP: super admin
do $$
declare v_admin uuid;
begin
  select user_id into v_admin from public.users where is_super_admin = true limit 1;
  if v_admin is null then
    v_admin := pg_temp.mk_user('test_admin_dl_' || substr(gen_random_uuid()::text,1,8));
    update public.users set is_super_admin = true where user_id = v_admin;
  end if;
end $$;

-- TEST 1: reporting a donation link injects a system message in the reporter's support thread
do $$
declare
  v_reporter uuid := pg_temp.mk_user('t1dl_' || substr(gen_random_uuid()::text,1,8));
  v_link uuid;
  v_payload jsonb;
begin
  -- Insert a donation link directly (bypass the Edge Function path)
  insert into public.donation_links (
    id, category_slug, url, display_name, submitted_by, validated_at
  ) values (
    gen_random_uuid(),
    (select slug from public.donation_categories limit 1),
    'https://example.com/donate',
    'Example Charity',
    v_reporter,
    now()
  ) returning id into v_link;

  -- Call the RPC as the reporter (use set_config to fake auth.uid())
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_reporter::text)::text, true);
  perform public.report_donation_link(v_link);

  select m.system_payload into v_payload
    from public.messages m
    join public.chats c on c.chat_id = m.chat_id
   where c.is_support_thread = true
     and (c.participant_a = v_reporter or c.participant_b = v_reporter)
     and m.system_payload->>'kind' = 'donation_link_reported'
   order by m.created_at desc limit 1;

  perform pg_temp.assert(v_payload is not null, 'T1: donation_link_reported message missing');
  perform pg_temp.assert((v_payload->>'link_id')::uuid = v_link, 'T1: link_id wrong');
  perform pg_temp.assert(v_payload->>'url' = 'https://example.com/donate', 'T1: url wrong');
  perform pg_temp.assert(v_payload->>'display_name' = 'Example Charity', 'T1: display_name wrong');

  raise notice '✓ T1 donation-link report message injected';
end $$;

\echo '✓ 0048 donation-link report message tests passed'
