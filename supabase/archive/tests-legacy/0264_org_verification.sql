-- supabase/tests/0264_org_verification.sql | Issue #848

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

do $$
declare
  v_user uuid := '00000000-0000-0000-0000-000000264001';
begin
  perform pg_temp.mk_user(v_user, 'unverified_user');
  if public.has_world_permission(v_user, 'items', 'publish') <> true then
    raise exception 'ASSERT FAILED: items should not require verification';
  end if;
  if public.has_world_permission(v_user, 'knowledge', 'publish') <> false then
    raise exception 'ASSERT FAILED: knowledge should require verified user';
  end if;
  update public.users set verified_at = now(), verification_method = 'manual' where user_id = v_user;
  if public.has_world_permission(v_user, 'knowledge', 'publish') <> true then
    raise exception 'ASSERT FAILED: verified user should pass knowledge permission';
  end if;
end $$;

rollback;

\echo '✓ 0264_org_verification.sql passed'
