-- Staff roles (migration 0011): revoking or changing a grant needs the right to grant its
-- role; an organization keeps its last administrator; the super admin manages their own
-- grants but not the super admin grant; only the super admin detaches a grant to the top
-- or skips the seniority rule, and every refused move names its rule; the audit rows of a
-- revoke and of a role change are linked.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Test shorthand inside SQL text: @x is the member with hex digit x, &org the organization
-- with that slug, ~x/role the active grant of that role held by member x.
create function pg_temp.expand(p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
begin
  for v_match in select regexp_matches(p_sql, '~([0-9a-f])/([a-z_]+)', 'g') loop
    v_sql := replace(v_sql, '~' || v_match[1] || '/' || v_match[2], coalesce(quote_literal((
      select g.id from public.admin_role_grants g
       where g.user_id = ('00000000-0000-4000-8000-00000000000' || v_match[1])::uuid
         and g.role = v_match[2] and g.revoked_at is null)), 'null') || '::uuid');
  end loop;
  for v_match in select regexp_matches(p_sql, '&([a-z]+)', 'g') loop
    v_sql := replace(v_sql, '&' || v_match[1], coalesce(quote_literal((
      select o.id from public.organizations o where o.slug = v_match[1])), 'null') || '::uuid');
  end loop;
  return regexp_replace(v_sql, '@([0-9a-f])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
end;
$$;

-- Runs a statement as a signed-in member. Returns 'ok', the message of a P0001 error, or
-- the SQLSTATE of any other error.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute v_sql;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- One value read as the database owner.
create function pg_temp.val(p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  execute pg_temp.expand(p_sql) into v_value;
  return v_value;
end;
$$;

select plan(16);

-- a super admin · b moderator · d admin · f org_admin of `one` · 2 org_manager · 3
-- volunteer_manager · 4 org_volunteer · 5 org_treasurer · 6 org_accountant · 7
-- operators_manager · 8 operator · c org_employee, all of `one` · 9 org_admin of `two` ·
-- 1 a member who becomes a second org_admin of `one`.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(string_to_array('a,b,c,d,f,1,2,3,4,5,6,7,8,9', ',')) x;
insert into public.organizations (slug, name) values ('one', 'Org One'), ('two', 'Org Two');
insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000a', 'super_admin');

select is(pg_temp.act('a', $$select public.admin_grant_role(@b, 'moderator')$$)
  || pg_temp.act('a', $$select public.admin_grant_role(@d, 'admin')$$)
  || pg_temp.act('a', $$select public.admin_grant_role(@f, 'org_admin', &one)$$)
  || pg_temp.act('a', $$select public.admin_grant_role(@9, 'org_admin', &two)$$)
  || pg_temp.act('f', $$select public.admin_grant_role(@2, 'org_manager', &one)$$)
  || pg_temp.act('2', $$select public.admin_grant_role(@3, 'volunteer_manager', &one)$$)
  || pg_temp.act('3', $$select public.admin_grant_role(@4, 'org_volunteer', &one)$$)
  || pg_temp.act('f', $$select public.admin_grant_role(@5, 'org_treasurer', &one)$$)
  || pg_temp.act('5', $$select public.admin_grant_role(@6, 'org_accountant', &one)$$)
  || pg_temp.act('f', $$select public.admin_grant_role(@7, 'operators_manager', &one)$$)
  || pg_temp.act('7', $$select public.admin_grant_role(@8, 'operator', &one)$$)
  || pg_temp.act('f', $$select public.admin_grant_role(@c, 'org_employee', &one)$$),
  'okokokokokokokokokokokok', 'the teams are granted down their reporting lines');

-- ── Direct manager ──────────────────────────────────────────────────────────
select is(pg_temp.act('f', 'select public.admin_set_manager(~7/operators_manager, gen_random_uuid())') || '|'
  || pg_temp.act('f', 'select public.admin_set_manager(~8/operator, ~9/org_admin)') || '|'
  || pg_temp.act('a', 'select public.admin_set_manager(~b/moderator, ~f/org_admin)') || '|'
  || pg_temp.act('f', 'select public.admin_set_manager(~7/operators_manager, ~8/operator)') || '|'
  || pg_temp.act('f', 'select public.admin_set_manager(~3/volunteer_manager, ~7/operators_manager)') || '|'
  || pg_temp.act('f', 'select public.admin_set_manager(~3/volunteer_manager, ~9/org_admin)'),
  'manager_not_found|manager_other_org|manager_other_org|manager_cycle|manager_rank|manager_other_org',
  'a refused move names the rule it breaks');
select is(pg_temp.act('7', 'select public.admin_set_manager(~8/operator, ~f/org_admin)') || '|'
  || pg_temp.act('f', 'select public.admin_set_manager(~7/operators_manager, null)') || '|'
  || pg_temp.act('f', 'select public.admin_set_manager(~f/org_admin, ~a/super_admin)') || '|'
  || pg_temp.act('a', 'select public.admin_set_manager(~a/super_admin, null)'),
  '42501|42501|42501|42501',
  'nobody moves a grant outside their subtree, detaches without being super admin, or moves themselves or the super admin');
select is(pg_temp.act('a', 'select public.admin_set_manager(~3/volunteer_manager, ~7/operators_manager)')
  || pg_temp.val('select (manager_grant_id = ~7/operators_manager)::text from public.admin_role_grants where id = ~3/volunteer_manager'),
  'oktrue', 'the super admin skips the seniority rule');
select is(pg_temp.act('a', 'select public.admin_set_manager(~2/org_manager)')
  || pg_temp.val('select coalesce(manager_grant_id::text, ''root'') from public.admin_role_grants where id = ~2/org_manager'),
  'okroot', 'the super admin detaches a grant to the top of its tree');
select is(pg_temp.act('f', 'select public.admin_set_manager(~2/org_manager, ~f/org_admin)')
  || pg_temp.act('a', 'select public.admin_set_manager(~2/org_manager, ~f/org_admin)'), '42501ok',
  'a detached grant leaves the subtree of its former managers until the super admin places it again');
select is(pg_temp.act('f', 'select public.admin_set_manager(~5/org_treasurer, (select id from public.admin_role_grants where revoked_at is not null limit 1))'),
  '42501', 'a move is checked against the caller before the new manager');

-- ── Revoke and change need the right to grant the role ──────────────────────
-- The super admin places the employee under the treasurer, who manages it by position but
-- may grant accountants only.
select is(pg_temp.act('a', 'select public.admin_set_manager(~c/org_employee, ~5/org_treasurer)')
  || pg_temp.act('5', 'select public.admin_revoke_role(~c/org_employee)')
  || pg_temp.act('5', $$select public.admin_change_role(~c/org_employee, 'org_accountant')$$),
  'ok4250142501', 'a senior grant that may not grant a role neither revokes nor changes it');
select is(pg_temp.act('5', 'select public.admin_revoke_role(~6/org_accountant)')
  || pg_temp.act('5', $$select public.admin_change_role(~5/org_treasurer, 'org_accountant')$$),
  'ok42501', 'a treasurer revokes an accountant below them, and never changes their own grant');

-- ── The last organization administrator ─────────────────────────────────────
select is(pg_temp.act('a', 'select public.admin_revoke_role(~f/org_admin)') || '|'
  || pg_temp.act('a', $$select public.admin_change_role(~f/org_admin, 'org_manager')$$) || '|'
  || pg_temp.val('select count(*) from public.admin_role_grants where user_id = @f and revoked_at is null'),
  'org_last_admin|org_last_admin|1', 'an organization keeps its last administrator');

-- ── The super admin's own grants ────────────────────────────────────────────
select is(pg_temp.act('a', $$select public.admin_grant_role(@a, 'org_admin', &two)$$)
  || pg_temp.act('a', 'select public.admin_revoke_role(~a/org_admin)')
  || pg_temp.act('a', 'select public.admin_revoke_role(~a/super_admin)')
  || pg_temp.act('d', 'select public.admin_revoke_role(~d/admin)'),
  'okok4250142501', 'the super admin revokes their own organization role, never the super admin grant; others never their own');

-- ── Linked audit rows ───────────────────────────────────────────────────────
select is(pg_temp.act('a', $$select public.admin_grant_role(@1, 'org_admin', &one)$$)
  || pg_temp.act('a', 'select public.admin_revoke_role(~f/org_admin)'), 'okok',
  'a second administrator lets the first be revoked');
select is(pg_temp.val($$
  select (e.metadata -> 'reparented_grant_ids') @> to_jsonb(array[
           (select id from public.admin_role_grants where user_id = @2 and role = 'org_manager'),
           (select id from public.admin_role_grants where user_id = @5 and role = 'org_treasurer'),
           (select id from public.admin_role_grants where user_id = @7 and role = 'operators_manager')])
         and e.metadata ->> 'reparented_to' = ~a/super_admin::text
    from audit.events e
   where e.action = 'admin_role_revoke'
     and e.metadata ->> 'grant_id' = (select id::text from public.admin_role_grants where user_id = @f)$$),
  'true', 'the revoke event lists the reports it moved and where they went');
select is(pg_temp.val($$
  select count(*) from audit.events e
   where e.action = 'admin_role_set_manager'
     and e.metadata ->> 'reparented_from' = (select id::text from public.admin_role_grants where user_id = @f)$$),
  '3', 'each moved report names the grant it left');
select is(pg_temp.act('a', $$select public.admin_change_role(~b/moderator, 'support')$$)
  || pg_temp.val($$
       select string_agg(e.action, ',' order by e.action) from audit.events e
        where e.metadata ->> 'change_of' = (select id::text from public.admin_role_grants
                                              where user_id = @b and role = 'moderator')$$),
  'okadmin_role_grant,admin_role_revoke', 'the two rows of a role change are linked by change_of');
select is(pg_temp.val($$select count(*) from audit.events e
   where e.action = 'admin_role_grant' and e.metadata ? 'change_of'
     and e.metadata ->> 'grant_id' = ~1/org_admin::text$$),
  '0', 'a later grant carries no link of an earlier action');

select * from finish();
rollback;
