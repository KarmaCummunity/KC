-- TD-90 — a NULL display_name is only valid while onboarding_state =
-- 'pending_basic_info'; a completed user cannot null it back out.

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;

create or replace function pg_temp.mk_user(p_handle text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role
  ) values (
    v_id, p_handle || '@test.local', now(),
    jsonb_build_object('full_name', 'Display ' || p_handle),
    jsonb_build_object('provider', 'email'), 'authenticated', 'authenticated'
  );
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle, account_status = 'active'
   where user_id = v_id;
  return v_id;
end $$;

do $$
declare
  v_user uuid := pg_temp.mk_user('dn_' || substr(gen_random_uuid()::text, 1, 8));
  v_hit  boolean := false;
begin
  -- completed user must keep a non-null display_name
  update public.users set onboarding_state = 'completed' where user_id = v_user;
  begin
    update public.users set display_name = null where user_id = v_user;
    raise exception 'ASSERT FAILED: nulling display_name on a completed user should violate the check';
  exception
    when check_violation then v_hit := true;
  end;
  perform pg_temp.assert(v_hit, 'completed user was able to null display_name');

  -- a pending_basic_info user may still have a null display_name (a new member: the stage
  -- graph, 0698, has no move back to step 1 outside the developer reset)
  v_user := pg_temp.mk_user('dn_' || substr(gen_random_uuid()::text, 1, 8));
  update public.users set display_name = null where user_id = v_user;

  raise notice '✓ display_name null only permitted during pending_basic_info (TD-90)';
end $$;
