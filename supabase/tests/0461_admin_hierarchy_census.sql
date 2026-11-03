-- supabase/tests/0461_admin_hierarchy_census.sql
-- Regression for migration 0461 (FR-ADMIN-028).
--
-- Asserts the security + counting contract of public.admin_hierarchy_census():
--   1. grants: anon has no EXECUTE, authenticated does; SECURITY DEFINER;
--   2. a caller without an active grant, or a banned grant holder, is
--      rejected with 42501;
--   3. an org-scoped admin sees only their own org;
--   4. super_admin sees every org, and the counts are correct:
--      community_total counts members (active or suspended, D84),
--      role_holder_total counts distinct granted members, affiliated_count
--      excludes members who already hold a grant in the same org and
--      non-members (banned).
-- Runs in a rolled-back transaction so it leaves no rows behind.

begin;

-- 1. Grants + definer.
do $$
begin
  if has_function_privilege('anon', 'public.admin_hierarchy_census()', 'EXECUTE') then
    raise exception 'ASSERT FAILED: anon must not EXECUTE admin_hierarchy_census';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_hierarchy_census()', 'EXECUTE') then
    raise exception 'ASSERT FAILED: authenticated must EXECUTE admin_hierarchy_census';
  end if;
  if not (select p.prosecdef from pg_proc p
           where p.oid = 'public.admin_hierarchy_census()'::regprocedure) then
    raise exception 'ASSERT FAILED: admin_hierarchy_census must be SECURITY DEFINER';
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

-- Fixture: one org, an org_admin who also holds a second grant (so distinct
-- users ≠ grant rows), a suspended org_manager (a member, so a role-holder),
-- a granted volunteer, two membership-only volunteers, a suspended
-- membership-only volunteer (a member, so counted), a banned volunteer with
-- an unrevoked grant and a membership (not a member, so counted nowhere), and
-- a plain user.
create temp table fx on commit drop as
select
  gen_random_uuid()              as org_id,
  pg_temp.mk_user('hc_super')    as super_id,
  pg_temp.mk_user('hc_orgadmin') as org_admin_id,
  pg_temp.mk_user('hc_grantvol') as grant_vol_id,
  pg_temp.mk_user('hc_memvol1')  as mem_vol1_id,
  pg_temp.mk_user('hc_memvol2')  as mem_vol2_id,
  pg_temp.mk_user('hc_suspmgr')  as susp_mgr_id,
  pg_temp.mk_user('hc_suspvol')  as susp_vol_id,
  pg_temp.mk_user('hc_banvol')   as ban_vol_id,
  pg_temp.mk_user('hc_plain')    as plain_id;
grant select on fx to authenticated;

insert into public.organizations (org_id, name, slug)
select org_id, 'Census Test Org', 'census-test-' || left(org_id::text, 8) from fx;

-- Ensure the fixture super_admin is the single active one (partial unique index).
update public.admin_role_grants set revoked_at = now()
 where role = 'super_admin' and revoked_at is null;
insert into public.admin_role_grants (user_id, role, scope_org_id)
select super_id, 'super_admin', null from fx
union all select org_admin_id, 'org_admin', org_id from fx
union all select grant_vol_id, 'org_volunteer', org_id from fx
union all select org_admin_id, 'org_volunteer', org_id from fx
union all select susp_mgr_id, 'org_manager', org_id from fx
union all select ban_vol_id, 'org_volunteer', org_id from fx;

update public.users set account_status = 'suspended_admin'
 where user_id = (select susp_vol_id from fx);
update public.users set account_status = 'suspended_for_false_reports'
 where user_id = (select susp_mgr_id from fx);
update public.users set account_status = 'banned'
 where user_id = (select ban_vol_id from fx);

-- The granted volunteer also holds a membership: it must not be double-counted.
insert into public.org_memberships (org_id, user_id, role)
select org_id, grant_vol_id, 'org_volunteer' from fx
union all select org_id, mem_vol1_id, 'org_volunteer' from fx
union all select org_id, mem_vol2_id, 'volunteer' from fx
union all select org_id, susp_vol_id, 'org_volunteer' from fx
union all select org_id, ban_vol_id, 'org_volunteer' from fx;

-- 2. No active grant → forbidden.
select pg_temp.act_as((select plain_id from fx));
set local role authenticated;
do $$
begin
  perform public.admin_hierarchy_census();
  raise exception 'ASSERT FAILED: caller without a grant was not rejected';
exception when insufficient_privilege then
  null;
end $$;
reset role;

-- 2b. A banned account keeps its grant row but is not a member → forbidden.
select pg_temp.act_as((select ban_vol_id from fx));
set local role authenticated;
do $$
begin
  perform public.admin_hierarchy_census();
  raise exception 'ASSERT FAILED: banned grant holder was not rejected';
exception when insufficient_privilege then
  null;
end $$;
reset role;

-- 3. Org-scoped admin sees only their org.
select pg_temp.act_as((select org_admin_id from fx));
set local role authenticated;
do $$
declare
  v json := public.admin_hierarchy_census();
  v_org uuid := (select org_id from fx);
begin
  if json_array_length(v -> 'orgs') <> 1 then
    raise exception 'ASSERT FAILED: org admin should see exactly 1 org, saw %', json_array_length(v -> 'orgs');
  end if;
  if (v -> 'orgs' -> 0 ->> 'org_id')::uuid <> v_org then
    raise exception 'ASSERT FAILED: org admin saw a foreign org';
  end if;
  -- mem_vol1 + mem_vol2 + suspended susp_vol; not the granted or banned ones.
  if (v -> 'orgs' -> 0 ->> 'affiliated_count')::int <> 3 then
    raise exception 'ASSERT FAILED: affiliated_count expected 3, got %', v -> 'orgs' -> 0 ->> 'affiliated_count';
  end if;
end $$;
reset role;

-- 4. super_admin sees every org; totals match the live tables. Expected
-- values are computed here as the table owner, so RLS / column grants on the
-- `authenticated` role cannot skew them.
create temp table expected on commit drop as
select
  (select count(*)::int from public.organizations) as orgs,
  (select count(*)::int from public.users
    where account_status in ('active', 'suspended_admin', 'suspended_for_false_reports')) as community,
  (select count(distinct g.user_id)::int
     from public.admin_role_grants g
     join public.users u on u.user_id = g.user_id
    where g.revoked_at is null
      and u.account_status in ('active', 'suspended_admin', 'suspended_for_false_reports')) as role_holders;
grant select on expected to authenticated;

select pg_temp.act_as((select super_id from fx));
set local role authenticated;
do $$
declare
  v json := public.admin_hierarchy_census();
  e record;
begin
  select * into e from expected;
  if json_array_length(v -> 'orgs') <> e.orgs then
    raise exception 'ASSERT FAILED: super_admin should see % orgs, saw %', e.orgs, json_array_length(v -> 'orgs');
  end if;
  if (v -> 'orgs' -> 0 ->> 'is_platform')::boolean is not true then
    raise exception 'ASSERT FAILED: platform org must be listed first';
  end if;
  if (v ->> 'community_total')::int <> e.community then
    raise exception 'ASSERT FAILED: community_total expected %, got %', e.community, v ->> 'community_total';
  end if;
  if (v ->> 'role_holder_total')::int <> e.role_holders then
    raise exception 'ASSERT FAILED: role_holder_total expected %, got %', e.role_holders, v ->> 'role_holder_total';
  end if;
end $$;
reset role;

rollback;
