-- KC#869 — notification inbox sync + unread RPC.

create or replace function pg_temp.mk_user(p_handle text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, email, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data,
    aud, role
  ) values (
    v_id, p_handle || '@test.local', now(),
    jsonb_build_object('full_name', 'Display ' || p_handle),
    jsonb_build_object('provider', 'email'),
    'authenticated', 'authenticated'
  );
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle, account_status = 'active'
   where user_id = v_id;
  return v_id;
end $$;

do $$
declare
  v_owner uuid := pg_temp.mk_user('inbox_o_' || substr(gen_random_uuid()::text, 1, 6));
  v_fan uuid := pg_temp.mk_user('inbox_f_' || substr(gen_random_uuid()::text, 1, 6));
  v_post uuid;
  v_unread int;
begin
  insert into public.posts (
    owner_id, type, title, status, visibility,
    city, street, street_number, location_display_level, category
  ) values (
    v_owner, 'Give', 'inbox test', 'open', 'Public',
    'tel-aviv', 'Test', '1', 'CityOnly', 'Other'
  ) returning post_id into v_post;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_fan::text)::text, true);
  set local role authenticated;
  perform public.rpc_set_post_reaction(v_post, 'like');
  reset role;

  select count(*) into v_unread
    from public.notification_inbox
   where user_id = v_owner and read_at is null;
  if v_unread < 1 then
    raise exception 'ASSERT FAILED: owner should have inbox row from reaction, got %', v_unread;
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text)::text, true);
  set local role authenticated;
  select public.rpc_notification_inbox_unread_count() into v_unread;
  if v_unread < 1 then
    raise exception 'ASSERT FAILED: unread count rpc expected >= 1, got %', v_unread;
  end if;
  perform public.rpc_notification_inbox_mark_all_read();
  select public.rpc_notification_inbox_unread_count() into v_unread;
  if v_unread <> 0 then
    raise exception 'ASSERT FAILED: mark all read expected 0 unread, got %', v_unread;
  end if;
  reset role;

  raise notice '✓ notification inbox sync + mark all read';
end $$;

\echo '✓ 0255_notification_inbox.sql passed'
