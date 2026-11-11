-- supabase/tests/0196_users_update_grant.sql
-- Regression for migration 0196 (security audit 2026-06-14, Finding H1 — CRITICAL).
--
-- Before 0196, Supabase default privileges granted table-wide UPDATE on
-- public.users to `authenticated`, so any signed-in user could run
--   update public.users set is_super_admin = true where user_id = auth.uid();
-- and self-escalate to platform super-admin (the users_sync_admin_role_grants
-- AFTER trigger then writes the super_admin RBAC row). 0196 revokes UPDATE and
-- re-grants only the profile columns the client legitimately writes.
--
-- Two parts: (1) the privilege matrix is correct, (2) an end-to-end escalation
-- attempt as the `authenticated` role is rejected. Runs in a rolled-back
-- transaction so it leaves no rows behind.

begin;

-- ── Part 1: privilege matrix ────────────────────────────────────────────────
do $$
begin
  -- Privileged / system-owned columns must be unreachable by client roles.
  if has_column_privilege('authenticated','public.users','is_super_admin','UPDATE')
     or has_column_privilege('authenticated','public.users','account_status','UPDATE')
     or has_column_privilege('authenticated','public.users','karma_points','UPDATE')
     or has_column_privilege('authenticated','public.users','followers_count','UPDATE')
     or has_column_privilege('authenticated','public.users','false_reports_count','UPDATE')
     or has_column_privilege('anon','public.users','is_super_admin','UPDATE') then
    raise exception 'SECURITY REGRESSION (H1): a client role can UPDATE a privileged users column';
  end if;

  -- 0698: the onboarding stage moved behind rpc_set_onboarding_state.
  if has_column_privilege('authenticated','public.users','onboarding_state','UPDATE') then
    raise exception 'REGRESSION (0698): authenticated can UPDATE users.onboarding_state directly';
  end if;

  -- Profile columns the app writes must remain updatable (no breakage).
  if not has_column_privilege('authenticated','public.users','display_name','UPDATE')
     or not has_column_privilege('authenticated','public.users','privacy_mode','UPDATE')
     or not has_column_privilege('authenticated','public.users','contact_phone','UPDATE') then
    raise exception 'BROKE PROFILE EDIT: authenticated lost UPDATE on a profile column';
  end if;

  -- messages: body immutable from the client (M1); status still updatable.
  if has_column_privilege('authenticated','public.messages','body','UPDATE')
     or has_column_privilege('authenticated','public.messages','sender_id','UPDATE') then
    raise exception 'SECURITY REGRESSION (M1): authenticated can UPDATE messages.body/sender_id';
  end if;
  if not has_column_privilege('authenticated','public.messages','status','UPDATE') then
    raise exception 'BROKE READ RECEIPTS: authenticated lost UPDATE on messages.status';
  end if;
end $$;

-- ── Part 2: end-to-end escalation attempt is rejected ───────────────────────
-- Insert a confirmed auth user (the on-insert trigger materialises public.users).
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
values ('00000000-0000-0000-0000-0000000a0196', 'attacker196@test.local', now(),
        '{"full_name":"Attacker 196"}'::jsonb, '{"provider":"email"}'::jsonb,
        'authenticated','authenticated');

select set_config('request.jwt.claims',
  jsonb_build_object('sub','00000000-0000-0000-0000-0000000a0196','role','authenticated')::text, true);

set local role authenticated;

do $$
declare v_blocked boolean := false;
begin
  begin
    update public.users set is_super_admin = true
     where user_id = '00000000-0000-0000-0000-0000000a0196';
  exception when insufficient_privilege then
    v_blocked := true;  -- 42501 permission denied on the column → expected
  end;
  if not v_blocked then
    raise exception 'CRITICAL (H1): authenticated self-escalated is_super_admin';
  end if;
  raise notice '✓ 0196: self-escalation blocked (42501 on users.is_super_admin)';
end $$;

reset role;
rollback;

\echo '✓ 0196 users/messages update-grant regression test passed'
