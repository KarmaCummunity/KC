-- TD-88 / D-57 — reports_insert_self gates on is_active_member.
-- A suspended/banned user must not be able to file a report; reactivating lets
-- them through. Uses target_type='none' (issue report) to avoid target
-- visibility / dedup constraints, isolating the is_active_member WITH CHECK.

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;
-- Called below under `set local role`: new functions are owner-only by default (0520).
grant execute on function pg_temp.assert(boolean, text) to public;

create or replace function pg_temp.mk_user(p_handle text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, email, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data,
    aud, role
  ) values (
    v_id,
    p_handle || '@test.local',
    now(),
    jsonb_build_object('full_name', 'Display ' || p_handle),
    jsonb_build_object('provider', 'email'),
    'authenticated',
    'authenticated'
  );
  update public.users
     set share_handle   = p_handle,
         display_name   = 'Display ' || p_handle,
         account_status = 'active'
   where user_id = v_id;
  return v_id;
end $$;

do $$
declare
  v_user uuid := pg_temp.mk_user('am_rep_' || substr(gen_random_uuid()::text, 1, 8));
  v_hit  boolean := false;
begin
  -- ── banned reporter: RLS WITH CHECK must reject the insert ──────────────────
  update public.users set account_status = 'banned' where user_id = v_user;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user::text)::text, true);
  set local role authenticated;

  begin
    insert into public.reports (reporter_id, target_type, target_id, reason)
    values (v_user, 'none', null, 'Other');
    raise exception 'ASSERT FAILED: banned user report insert should be denied by RLS';
  exception
    when others then
      if sqlerrm like 'ASSERT FAILED:%' then raise; end if;
      if sqlerrm not like '%row-level security%' then
        raise exception 'banned report insert failed for the wrong reason: %', sqlerrm;
      end if;
      v_hit := true;
  end;
  perform pg_temp.assert(v_hit, 'banned user was able to insert a report');
  reset role;

  -- ── same user reactivated: insert is allowed ───────────────────────────────
  update public.users set account_status = 'active' where user_id = v_user;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user::text)::text, true);
  set local role authenticated;

  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (v_user, 'none', null, 'Other');

  reset role;
  raise notice '✓ reports_insert_self gates on is_active_member (banned denied, active allowed)';
end $$;
