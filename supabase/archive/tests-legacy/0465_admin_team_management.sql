-- supabase/tests/0465_admin_team_management.sql
-- Regression for migration 0465 (FR-ADMIN-030).
--
-- Asserts:
--   1. admin_change_role grants: anon has no EXECUTE, authenticated does; SECURITY DEFINER;
--   2. admin_list_admins is org-scoped: an org admin sees only their org's grants,
--      a platform moderator only the platform org, super_admin everything;
--   3. admin_change_role replaces the role in place: the old grant is revoked, the
--      new one keeps user, scope and manager, reports follow it, and the change
--      is audited as a revoke + grant pair;
--   4. it rejects a caller outside the grant's subtree (FR-ADMIN-027) or org, a
--      scope-crossing role, a role the person already holds (rolling back the
--      revoke), and the super_admin grant.
-- Runs in a rolled-back transaction so it leaves no rows behind.

begin;

-- 1. Grants + definer.
do $$
begin
  if has_function_privilege('anon', 'public.admin_change_role(uuid, text)', 'EXECUTE') then
    raise exception 'ASSERT FAILED: anon must not EXECUTE admin_change_role';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_change_role(uuid, text)', 'EXECUTE') then
    raise exception 'ASSERT FAILED: authenticated must EXECUTE admin_change_role';
  end if;
  if not (select p.prosecdef from pg_proc p
           where p.oid = 'public.admin_change_role(uuid, text)'::regprocedure) then
    raise exception 'ASSERT FAILED: admin_change_role must be SECURITY DEFINER';
  end if;
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
  update public.users set account_status = 'active' where user_id = v_id;
  return v_id;
end $$;

create or replace function pg_temp.act_as(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- Asserts that `p_sql` raises an exception whose message is `p_expected`.
create or replace function pg_temp.expect_error(p_sql text, p_expected text, p_label text)
returns void language plpgsql as $$
declare
  v_raised text;
begin
  -- Only the statement under test sits in the protected block, so the
  -- "did not raise" assertion below is never swallowed by its own handler.
  begin
    execute p_sql;
  exception when others then
    v_raised := sqlerrm;
  end;
  if v_raised is null then
    raise exception 'ASSERT FAILED: % did not raise %', p_label, p_expected;
  elsif v_raised <> p_expected then
    raise exception 'ASSERT FAILED: % raised "%" instead of %', p_label, v_raised, p_expected;
  end if;
end $$;
-- Called below under `set local role`: new functions are owner-only by default (0520).
grant execute on function pg_temp.expect_error(text, text, text) to public;

-- Fixture: orgs A and B; a super_admin; a platform moderator; org admins of A
-- and B; in A a volunteer manager reporting to A's admin with one volunteer
-- reporting to them; and a member of A holding both employee and volunteer.
create temp table fx on commit drop as
select
  gen_random_uuid()               as org_a,
  gen_random_uuid()               as org_b,
  pg_temp.mk_user('tm_super')     as super_id,
  pg_temp.mk_user('tm_mod')       as mod_id,
  pg_temp.mk_user('tm_admin_a')   as admin_a_id,
  pg_temp.mk_user('tm_admin_b')   as admin_b_id,
  pg_temp.mk_user('tm_vm_a')      as vm_a_id,
  pg_temp.mk_user('tm_vol_a')     as vol_a_id,
  pg_temp.mk_user('tm_dual_a')    as dual_a_id;
grant select on fx to authenticated;

insert into public.organizations (org_id, name, slug)
select org_a, 'Team Org A', 'team-a-' || left(org_a::text, 8) from fx
union all select org_b, 'Team Org B', 'team-b-' || left(org_b::text, 8) from fx;

-- Ensure the fixture super_admin is the single active one (partial unique index).
update public.admin_role_grants set revoked_at = now()
 where role = 'super_admin' and revoked_at is null;

insert into public.admin_role_grants (user_id, role, scope_org_id)
-- Typed nulls: an untyped null pair would resolve the UNION column to text.
select super_id, 'super_admin', null::uuid from fx
union all select mod_id, 'moderator', null::uuid from fx
union all select admin_a_id, 'org_admin', org_a from fx
union all select admin_b_id, 'org_admin', org_b from fx
union all select dual_a_id, 'org_employee', org_a from fx
union all select dual_a_id, 'org_volunteer', org_a from fx;

-- Chain in A: admin_a ← vm_a ← vol_a.
insert into public.admin_role_grants (user_id, role, scope_org_id, manager_grant_id)
select vm_a_id, 'volunteer_manager', org_a,
       (select grant_id from public.admin_role_grants
         where user_id = fx.admin_a_id and revoked_at is null)
  from fx;
insert into public.admin_role_grants (user_id, role, scope_org_id, manager_grant_id)
select vol_a_id, 'org_volunteer', org_a,
       (select grant_id from public.admin_role_grants
         where user_id = fx.vm_a_id and revoked_at is null)
  from fx;

-- Grant ids the steps below refer to (read as the table owner).
create temp table ids on commit drop as
select
  (select grant_id from public.admin_role_grants g, fx
    where g.user_id = fx.vm_a_id and g.revoked_at is null)                as vm_grant,
  (select grant_id from public.admin_role_grants g, fx
    where g.user_id = fx.admin_a_id and g.revoked_at is null)             as admin_a_grant,
  (select grant_id from public.admin_role_grants g, fx
    where g.user_id = fx.dual_a_id and g.role = 'org_volunteer'
      and g.revoked_at is null)                                           as dual_vol_grant,
  (select grant_id from public.admin_role_grants g, fx
    where g.user_id = fx.super_id and g.revoked_at is null)               as super_grant;
grant select on ids to authenticated;

-- 2a. Org admin of A sees only org A grants.
select pg_temp.act_as((select admin_a_id from fx));
set local role authenticated;
do $$
declare
  v_a uuid := (select org_a from fx);
begin
  if exists (select 1 from public.admin_list_admins(false) r
              where r.scope_org_id is distinct from v_a) then
    raise exception 'ASSERT FAILED: org admin of A saw a grant outside org A';
  end if;
  -- admin_a, dual_a ×2, vm_a, vol_a.
  if (select count(*) from public.admin_list_admins(false)) <> 5 then
    raise exception 'ASSERT FAILED: org admin of A expected 5 org-A grants, got %',
      (select count(*) from public.admin_list_admins(false));
  end if;
end $$;
reset role;

-- 2b. A platform moderator sees only the platform org (null scope).
select pg_temp.act_as((select mod_id from fx));
set local role authenticated;
do $$
begin
  -- Checked against the fixture orgs so pre-existing platform rows cannot interfere.
  if exists (select 1 from public.admin_list_admins(false) r
              where r.scope_org_id in (select org_a from fx union all select org_b from fx)) then
    raise exception 'ASSERT FAILED: platform moderator saw an org-scoped grant';
  end if;
end $$;
reset role;

-- 2c. super_admin sees both fixture orgs.
select pg_temp.act_as((select super_id from fx));
set local role authenticated;
do $$
begin
  if (select count(distinct r.scope_org_id) from public.admin_list_admins(false) r
       where r.scope_org_id in (select org_a from fx union all select org_b from fx)) <> 2 then
    raise exception 'ASSERT FAILED: super_admin should see grants of both fixture orgs';
  end if;
end $$;
reset role;

-- 3. Org admin of A changes the volunteer manager into an org manager.
create temp table changed (new_grant uuid) on commit drop;
grant insert, select on changed to authenticated;
select pg_temp.act_as((select admin_a_id from fx));
set local role authenticated;
insert into changed select public.admin_change_role((select vm_grant from ids), 'org_manager');
reset role;

do $$
declare
  v_new  uuid := (select new_grant from changed);
  v_old  uuid := (select vm_grant from ids);
  v_row  public.admin_role_grants;
begin
  select * into v_row from public.admin_role_grants where grant_id = v_new;
  if v_row.role <> 'org_manager' or v_row.revoked_at is not null then
    raise exception 'ASSERT FAILED: new grant should be an active org_manager';
  end if;
  if v_row.user_id <> (select vm_a_id from fx) or v_row.scope_org_id <> (select org_a from fx) then
    raise exception 'ASSERT FAILED: new grant must keep the user and the scope';
  end if;
  if v_row.manager_grant_id is distinct from (select admin_a_grant from ids) then
    raise exception 'ASSERT FAILED: new grant must keep the direct manager';
  end if;
  if (select revoked_at from public.admin_role_grants where grant_id = v_old) is null then
    raise exception 'ASSERT FAILED: old grant must be revoked';
  end if;
  if (select manager_grant_id from public.admin_role_grants g, fx
       where g.user_id = fx.vol_a_id and g.revoked_at is null) <> v_new then
    raise exception 'ASSERT FAILED: the report must now report to the new grant';
  end if;
  if (select count(*) from public.audit_events
       where metadata ->> 'change_of' = v_old::text
         and action in ('admin_role_revoke', 'admin_role_grant')) <> 2 then
    raise exception 'ASSERT FAILED: change must be audited as a revoke + grant pair';
  end if;
end $$;

-- 4a'. Position rule (FR-ADMIN-027): even in their own org, an org admin may not
-- re-role a grant outside their subtree (dual_a reports to nobody). The target
-- role is one dual_a does not hold, so only the position check can refuse it.
select pg_temp.act_as((select admin_a_id from fx));
set local role authenticated;
select pg_temp.expect_error(
  format('select public.admin_change_role(%L, %L)', (select dual_vol_grant from ids), 'operator'),
  'forbidden_grant', 'change outside the subtree');
reset role;

-- 4a. Org admin of B has no authority in org A.
select pg_temp.act_as((select admin_b_id from fx));
set local role authenticated;
select pg_temp.expect_error(
  format('select public.admin_change_role(%L, %L)', (select dual_vol_grant from ids), 'org_employee'),
  'forbidden_grant', 'cross-org change');
reset role;

-- 4b. An org grant cannot become a platform role.
select pg_temp.act_as((select super_id from fx));
set local role authenticated;
select pg_temp.expect_error(
  format('select public.admin_change_role(%L, %L)', (select dual_vol_grant from ids), 'moderator'),
  'invalid_scope', 'platform role on an org grant');

-- 4c. A role the person already holds in that org is rejected and rolled back.
select pg_temp.expect_error(
  format('select public.admin_change_role(%L, %L)', (select dual_vol_grant from ids), 'org_employee'),
  'role_already_active', 'duplicate role');

-- 4d. The super_admin grant is never changeable.
select pg_temp.expect_error(
  format('select public.admin_change_role(%L, %L)', (select super_grant from ids), 'moderator'),
  'forbidden_grant', 'super_admin change');
reset role;

do $$
begin
  if (select revoked_at from public.admin_role_grants
       where grant_id = (select dual_vol_grant from ids)) is not null then
    raise exception 'ASSERT FAILED: a rejected change must leave the old grant active';
  end if;
end $$;

rollback;
