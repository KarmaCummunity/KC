-- Staff roster, tree, census and the first super admin (migrations 0012, 0013): every
-- team-managing role reads its organization's grants; the roster and the tree carry names
-- and the last-seen time and are scoped to the organizations the caller's grants reach
-- (platform admins see everything); the census counts community members, role holders and
-- affiliates without identities; the first super admin is created once, by the service role.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a one-column query as a member (or as 'service' / 'anon') and returns its values
-- joined by ' ',
-- 'none' for no row, the P0001 message or the SQLSTATE. @x is the member with hex digit x,
-- &slug an organization.
create function pg_temp.rows_as(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := regexp_replace(p_sql, '@([0-9a-f])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
  v_match text[];
  v_value text;
begin
  for v_match in select regexp_matches(p_sql, '&([a-z]+)', 'g') loop
    v_sql := replace(v_sql, '&' || v_match[1], coalesce(quote_literal((
      select o.id from public.organizations o where o.slug = v_match[1])), 'null') || '::uuid');
  end loop;
  begin
    perform set_config('request.jwt.claims', case p_who
      when 'anon' then '{"role":"anon"}' when 'service' then '{"role":"service_role"}'
      else jsonb_build_object('sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text end, true);
    perform set_config('role', case p_who when 'anon' then 'anon' when 'service' then 'service_role' else 'authenticated' end, true);
    execute format('select string_agg(r.v::text, '' '') from (%s) r(v)', v_sql) into v_value;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return coalesce(v_value, 'none');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- One active grant of a member, written as the database owner under a manager grant.
create function pg_temp.grant_role(p_who text, p_role text, p_org text, p_manager_of text default null)
returns void
language sql
as $$
  insert into public.admin_role_grants (user_id, role, scope_org_id, granted_by, manager_grant_id)
  select ('00000000-0000-4000-8000-00000000000' || p_who)::uuid, p_role,
         (select o.id from public.organizations o where o.slug = p_org),
         case when p_manager_of is not null then ('00000000-0000-4000-8000-00000000000' || p_manager_of)::uuid end,
         (select g.id from public.admin_role_grants g
           where g.user_id = ('00000000-0000-4000-8000-00000000000' || p_manager_of)::uuid and g.revoked_at is null
           order by g.granted_at limit 1);
$$;

select plan(17);

-- a super admin · d admin · b moderator (platform) · f org_admin, 3 volunteer_manager,
-- 7 operators_manager, c org_employee of `one` · 9 org_admin of `two` · 1, 2, 4, 5, 6 members
-- without a role (4 banned, 5 suspended, 6 not verified yet).
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test',
       case x when '6' then '{"provider":"email"}' else '{"provider":"google"}' end::jsonb
  from unnest(string_to_array('a,b,c,d,f,1,2,3,4,5,6,7,9', ',')) x;
update public.users set display_name = 'Name ' || right(id::text, 1);
insert into public.organizations (slug, name, is_platform, is_verified_nonprofit) values
  ('kc', 'Karma Community', true, false), ('one', 'Org One', false, true), ('two', 'Org Two', false, false);
select pg_temp.grant_role('a', 'super_admin', null);
select pg_temp.grant_role('d', 'admin', null, 'a');
select pg_temp.grant_role('b', 'moderator', null, 'a');
select pg_temp.grant_role('f', 'org_admin', 'one', 'a');
select pg_temp.grant_role('3', 'volunteer_manager', 'one', 'f');
select pg_temp.grant_role('7', 'operators_manager', 'one', 'f');
select pg_temp.grant_role('c', 'org_employee', 'one', 'f');
select pg_temp.grant_role('9', 'org_admin', 'two', 'a');
update public.user_account set status = 'banned' where user_id = '00000000-0000-4000-8000-000000000004';
update public.user_account set status = 'suspended_admin' where user_id = '00000000-0000-4000-8000-000000000005';
insert into public.user_devices (user_id, platform, push_token, last_seen_at) values
  ('00000000-0000-4000-8000-00000000000f', 'ios', 'token-f-1', '2026-03-01 10:00+00'),
  ('00000000-0000-4000-8000-00000000000f', 'web', 'token-f-2', '2026-03-02 10:00+00');
insert into kc_private.user_active_days (user_id, active_on) values
  ('00000000-0000-4000-8000-000000000003', '2026-04-10'), ('00000000-0000-4000-8000-000000000003', '2026-04-12');
-- Affiliates of `one`: 1 and 5 count; f holds a role there, 4 is banned. 2 of `two`.
insert into public.user_profile_fields (user_id, field_key, visibility, affiliated_org_id)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, 'affiliated_org', 'only_me', o.id
  from unnest(string_to_array('1,5,f,4', ',')) x, public.organizations o where o.slug = 'one';
insert into public.user_profile_fields (user_id, field_key, visibility, affiliated_org_id)
select '00000000-0000-4000-8000-000000000002'::uuid, 'affiliated_org', 'everyone', o.id
  from public.organizations o where o.slug = 'two';

-- ── Direct reads of the grants ──────────────────────────────────────────────
select is(pg_temp.rows_as('3', 'select count(*) from public.admin_role_grants')
  || '/' || pg_temp.rows_as('7', 'select count(*) from public.admin_role_grants')
  || '/' || pg_temp.rows_as('c', 'select count(*) from public.admin_role_grants')
  || '/' || pg_temp.rows_as('9', 'select count(*) from public.admin_role_grants'),
  '4/4/1/1', 'every team-managing role reads its organization''s grants; an employee reads their own');

-- ── Roster ──────────────────────────────────────────────────────────────────
select is(pg_temp.rows_as('a', 'select count(*) from public.admin_list_admins()')
  || '/' || pg_temp.rows_as('d', 'select count(*) from public.admin_list_admins()')
  || '/' || pg_temp.rows_as('f', 'select count(*) from public.admin_list_admins()')
  || '/' || pg_temp.rows_as('c', 'select count(*) from public.admin_list_admins()')
  || '/' || pg_temp.rows_as('b', 'select count(*) from public.admin_list_admins()')
  || '/' || pg_temp.rows_as('9', 'select count(*) from public.admin_list_admins()'),
  '8/8/4/4/3/1', 'the roster shows every grant to platform admins and the reached organizations to anyone else');
select is(pg_temp.rows_as('1', 'select count(*) from public.admin_list_admins()')
  || '/' || pg_temp.rows_as('anon', 'select count(*) from public.admin_list_admins()')
  || '/' || pg_temp.rows_as('1', 'select count(*) from public.admin_org_tree()'),
  '42501/42501/42501', 'a member without a grant and a signed-out caller read no roster');
select is(pg_temp.rows_as('f', $$select role || ':' || display_name || ':' || coalesce(granted_by_display_name, '-')
    from public.admin_list_admins() order by role$$),
  'operators_manager:Name 7:Name f org_admin:Name f:Name a org_employee:Name c:Name f volunteer_manager:Name 3:Name f',
  'the roster carries the holder and granter names');
select is(pg_temp.rows_as('f', 'select role from public.admin_list_admins() limit 1'), 'org_admin',
  'the most senior role comes first');
select is(pg_temp.rows_as('f', $$select role || '=' || coalesce((last_seen_at at time zone 'Asia/Jerusalem')::date::text, 'never')
    from public.admin_list_admins() where role in ('org_admin', 'volunteer_manager', 'org_employee') order by role$$),
  'org_admin=2026-03-02 org_employee=never volunteer_manager=2026-04-12',
  'last seen is the latest device check-in or active day');
select is(pg_temp.rows_as('f', $$select (max(last_seen_at) at time zone 'Asia/Jerusalem')::text
    from public.admin_list_admins() where role = 'volunteer_manager'$$),
  '2026-04-12 00:00:00', 'an active day counts from its start in Israel time');
select is(pg_temp.rows_as('f', 'select manager_grant_id is not null from public.admin_list_admins() where role = ''org_employee'''),
  'true', 'the roster carries the manager edge');
update public.admin_role_grants set revoked_at = now() where user_id = '00000000-0000-4000-8000-00000000000c';
select is(pg_temp.rows_as('f', 'select count(*) from public.admin_list_admins()')
  || '/' || pg_temp.rows_as('f', 'select count(*) filter (where revoked_at is not null) from public.admin_list_admins(true)'),
  '3/1', 'revoked grants appear only on request');
select is(pg_temp.rows_as('a', 'select count(*) from public.user_devices'), '0', 'device rows stay with their owner');

-- ── Organization tree ───────────────────────────────────────────────────────
select is(pg_temp.rows_as('b', $$select role || '@' || org_name || ':' || is_platform from public.admin_org_tree() order by role$$)
  || '|' || pg_temp.rows_as('a', 'select count(*) from public.admin_org_tree(&two)')
  || '|' || pg_temp.rows_as('f', 'select count(*) from public.admin_org_tree(&two)'),
  'admin@Karma Community:true moderator@Karma Community:true super_admin@Karma Community:true|1|0',
  'platform grants count in the platform organization; a caller reads only the organizations they reach');

-- ── Census ──────────────────────────────────────────────────────────────────
select is(pg_temp.rows_as('3', $$select x ->> 'community_total' || '/' || (x ->> 'role_holder_total') || '/'
    || (select string_agg(o ->> 'name' || '=' || (o ->> 'affiliated_count') || ':' || (o ->> 'is_verified'), ',')
          from json_array_elements(x -> 'orgs') o)
    from public.admin_hierarchy_census() x$$),
  '11/7/Org One=2:true', 'the census counts members (suspended in, banned and unverified out), role holders and affiliates without a role');
select is(pg_temp.rows_as('a', $$select string_agg(o ->> 'slug' || '/' || (o ->> 'name') || '=' || (o ->> 'affiliated_count'), ',')
    from public.admin_hierarchy_census() x, json_array_elements(x -> 'orgs') o$$),
  'kc/Karma Community=0,one/Org One=2,two/Org Two=1', 'the super admin sees every organization, the platform first');
select is(pg_temp.rows_as('1', 'select public.admin_hierarchy_census()')
  || '/' || pg_temp.rows_as('anon', 'select public.admin_hierarchy_census()'),
  '42501/42501', 'members without a grant and signed-out callers get no census');

-- ── First super admin ───────────────────────────────────────────────────────
select is(pg_temp.rows_as('a', 'select kc_private.bootstrap_super_admin(@1)')
  || '/' || pg_temp.rows_as('service', 'select kc_private.bootstrap_super_admin(@1)'),
  '42501/super_admin_exists', 'only the service role bootstraps, and never while a super admin exists');
update public.admin_role_grants set revoked_at = now() where role = 'super_admin';
select is(pg_temp.rows_as('service', 'select kc_private.bootstrap_super_admin(@4)')
  || '/' || pg_temp.rows_as('service', 'select kc_private.bootstrap_super_admin(@1) is not null'),
  'target_not_active/true', 'the first super admin is an active member');
select is((select count(*) from audit.events e where e.action = 'admin_role_grant'
              and e.target_id = '00000000-0000-4000-8000-000000000001' and e.metadata ->> 'role' = 'super_admin'),
  1::bigint, 'the bootstrap grant is audited');

select * from finish();
rollback;
