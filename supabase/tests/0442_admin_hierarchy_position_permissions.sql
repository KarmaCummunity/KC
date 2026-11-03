-- supabase/tests/0442_admin_hierarchy_position_permissions.sql
-- Regression tests for migration 0442 (FR-ADMIN-027): hierarchy-based permissions.
-- Runs in a rolled-back transaction; impersonates callers via request.jwt.claims.

begin;

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

create or replace function pg_temp.act_as(p_uid uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
$$;

-- Asserts that p_sql raises an error whose message equals p_expected.
create or replace function pg_temp.expect_error(p_label text, p_sql text, p_expected text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm <> p_expected then
      raise exception 'ASSERT FAILED [%]: expected %, got %', p_label, p_expected, sqlerrm;
    end if;
    return;
  end;
  raise exception 'ASSERT FAILED [%]: expected error %, call succeeded', p_label, p_expected;
end $$;

create temp table t_ids (k text primary key, v uuid) on commit drop;

do $$
declare
  v_org_x uuid := gen_random_uuid();
  v_org_y uuid := gen_random_uuid();
  v_s uuid; v_sg uuid;
  v_a uuid := pg_temp.mk_user('t442a_' || substr(gen_random_uuid()::text, 1, 8));
  v_m1 uuid := pg_temp.mk_user('t442m1_' || substr(gen_random_uuid()::text, 1, 8));
  v_m2 uuid := pg_temp.mk_user('t442m2_' || substr(gen_random_uuid()::text, 1, 8));
  v_v uuid := pg_temp.mk_user('t442v_' || substr(gen_random_uuid()::text, 1, 8));
  v_o uuid := pg_temp.mk_user('t442o_' || substr(gen_random_uuid()::text, 1, 8));
  v_u uuid := pg_temp.mk_user('t442u_' || substr(gen_random_uuid()::text, 1, 8));
  v_ag uuid; v_m1g uuid; v_m2g uuid; v_vg uuid; v_og uuid;
begin
  insert into public.organizations (org_id, name, slug)
  values (v_org_x, 'T442 X', 't442-x-' || substr(v_org_x::text, 1, 8)),
         (v_org_y, 'T442 Y', 't442-y-' || substr(v_org_y::text, 1, 8));

  -- Reuse the single active super_admin if one exists (partial unique index).
  select user_id, grant_id into v_s, v_sg
    from public.admin_role_grants
   where role = 'super_admin' and revoked_at is null limit 1;
  if v_s is null then
    v_s := pg_temp.mk_user('t442s_' || substr(gen_random_uuid()::text, 1, 8));
    insert into public.admin_role_grants (user_id, role) values (v_s, 'super_admin')
    returning grant_id into v_sg;
  end if;

  insert into public.admin_role_grants (user_id, role, scope_org_id, manager_grant_id)
  values (v_a, 'org_admin', v_org_x, v_sg) returning grant_id into v_ag;
  insert into public.admin_role_grants (user_id, role, scope_org_id, manager_grant_id)
  values (v_m1, 'org_manager', v_org_x, v_ag) returning grant_id into v_m1g;
  insert into public.admin_role_grants (user_id, role, scope_org_id, manager_grant_id)
  values (v_m2, 'org_manager', v_org_x, v_ag) returning grant_id into v_m2g;
  insert into public.admin_role_grants (user_id, role, scope_org_id, manager_grant_id)
  values (v_v, 'org_volunteer', v_org_x, v_m1g) returning grant_id into v_vg;
  insert into public.admin_role_grants (user_id, role, scope_org_id, manager_grant_id)
  values (v_o, 'org_manager', v_org_y, v_sg) returning grant_id into v_og;

  insert into t_ids values ('org_x', v_org_x), ('org_y', v_org_y), ('s', v_s), ('sg', v_sg),
    ('a', v_a), ('ag', v_ag), ('m1', v_m1), ('m1g', v_m1g), ('m2', v_m2), ('m2g', v_m2g),
    ('v', v_v), ('vg', v_vg), ('o', v_o), ('og', v_og), ('u', v_u);
end $$;

-- ── role_rank / can_manage_grant primitives ────────────────────────────────
do $$
declare i jsonb := (select jsonb_object_agg(k, v) from t_ids);
begin
  if not (public.role_rank('super_admin') > public.role_rank('admin')
          and public.role_rank('admin') > public.role_rank('org_admin')
          and public.role_rank('org_admin') > public.role_rank('org_manager')
          and public.role_rank('org_manager') > public.role_rank('volunteer_manager')
          and public.role_rank('volunteer_manager') > public.role_rank('org_volunteer')
          and public.role_rank('nope') = 0) then
    raise exception 'ASSERT FAILED: role_rank ordering';
  end if;
  if not public.can_manage_grant((i->>'a')::uuid, (i->>'vg')::uuid) then
    raise exception 'ASSERT FAILED: org_admin should manage grandchild volunteer';
  end if;
  if public.can_manage_grant((i->>'m1')::uuid, (i->>'m2g')::uuid) then
    raise exception 'ASSERT FAILED: peer manages peer';
  end if;
  if public.can_manage_grant((i->>'m1')::uuid, (i->>'ag')::uuid) then
    raise exception 'ASSERT FAILED: report manages own manager';
  end if;
  if public.can_manage_grant((i->>'m1')::uuid, (i->>'m1g')::uuid) then
    raise exception 'ASSERT FAILED: actor manages own grant';
  end if;
  if public.can_manage_grant((i->>'o')::uuid, (i->>'vg')::uuid) then
    raise exception 'ASSERT FAILED: other-org manager manages foreign grant';
  end if;
  if public.can_manage_grant(null, (i->>'vg')::uuid) then
    raise exception 'ASSERT FAILED: null actor';
  end if;
  if not public.can_manage_grant((i->>'s')::uuid, (i->>'ag')::uuid) then
    raise exception 'ASSERT FAILED: super_admin manages everything';
  end if;
  if public.actor_scope_rank((i->>'m1')::uuid, (i->>'org_y')::uuid) <> 0 then
    raise exception 'ASSERT FAILED: scope rank leaks across orgs';
  end if;
end $$;

-- ── A peer cannot edit a peer; a report cannot edit its manager ────────────
do $$
declare i jsonb := (select jsonb_object_agg(k, v) from t_ids);
begin
  perform pg_temp.act_as((i->>'m1')::uuid);
  perform pg_temp.expect_error('peer revoke',
    format('select public.admin_revoke_role(%L)', i->>'m2g'), 'forbidden_revoke');
  perform pg_temp.expect_error('peer move',
    format('select public.admin_set_manager(%L, %L)', i->>'m2g', i->>'m1g'), 'forbidden_manage');
  perform pg_temp.expect_error('revoke own manager',
    format('select public.admin_revoke_role(%L)', i->>'ag'), 'forbidden_revoke');
  perform pg_temp.act_as((i->>'o')::uuid);
  perform pg_temp.expect_error('other org revoke',
    format('select public.admin_revoke_role(%L)', i->>'vg'), 'forbidden_revoke');
end $$;

-- ── Cannot grant an equal or higher role; lower role lands under the actor ─
do $$
declare
  i jsonb := (select jsonb_object_agg(k, v) from t_ids);
  v_new uuid; v_mgr uuid;
begin
  perform pg_temp.act_as((i->>'m1')::uuid);
  perform pg_temp.expect_error('grant equal',
    format('select public.admin_grant_role(%L, %L, %L)', i->>'u', 'org_manager', i->>'org_x'), 'forbidden_grant');
  perform pg_temp.expect_error('grant higher',
    format('select public.admin_grant_role(%L, %L, %L)', i->>'u', 'org_admin', i->>'org_x'), 'forbidden_grant');
  perform pg_temp.expect_error('grant in foreign org',
    format('select public.admin_grant_role(%L, %L, %L)', i->>'u', 'org_volunteer', i->>'org_y'), 'forbidden_grant');
  perform pg_temp.expect_error('grant super_admin',
    format('select public.admin_grant_role(%L, %L, %L)', i->>'u', 'super_admin', null), 'invalid_role');

  perform pg_temp.act_as((i->>'a')::uuid);
  perform pg_temp.expect_error('org_admin grants org_admin',
    format('select public.admin_grant_role(%L, %L, %L)', i->>'u', 'org_admin', i->>'org_x'), 'forbidden_grant');
  perform pg_temp.expect_error('org_admin grants platform admin',
    format('select public.admin_grant_role(%L, %L, %L)', i->>'u', 'admin', null), 'forbidden_grant');

  perform pg_temp.act_as((i->>'m1')::uuid);
  v_new := public.admin_grant_role((i->>'u')::uuid, 'volunteer_manager', (i->>'org_x')::uuid);
  select manager_grant_id into v_mgr from public.admin_role_grants where grant_id = v_new;
  if v_mgr is distinct from (i->>'m1g')::uuid then
    raise exception 'ASSERT FAILED: new grant should report to granting actor, got %', v_mgr;
  end if;
  if not exists (select 1 from public.audit_events
                  where action = 'admin_role_grant' and metadata->>'grant_id' = v_new::text
                    and metadata->>'manager_grant_id' = i->>'m1g') then
    raise exception 'ASSERT FAILED: grant not audited with manager';
  end if;
  insert into t_ids values ('ug', v_new);
end $$;

-- ── Cannot move someone outside your subtree ───────────────────────────────
do $$
declare i jsonb := (select jsonb_object_agg(k, v) from t_ids);
begin
  perform pg_temp.act_as((i->>'m1')::uuid);
  perform pg_temp.expect_error('move to peer subtree',
    format('select public.admin_set_manager(%L, %L)', i->>'vg', i->>'m2g'), 'forbidden_manage');
  perform pg_temp.expect_error('detach to root',
    format('select public.admin_set_manager(%L, null)', i->>'vg'), 'forbidden_manage');
  perform pg_temp.expect_error('self as manager',
    format('select public.admin_set_manager(%L, %L)', i->>'ug', i->>'ug'), 'invalid_manager');
  -- Within own subtree: volunteer moves under the new volunteer_manager.
  perform public.admin_set_manager((i->>'vg')::uuid, (i->>'ug')::uuid);
  if (select manager_grant_id from public.admin_role_grants where grant_id = (i->>'vg')::uuid)
     is distinct from (i->>'ug')::uuid then
    raise exception 'ASSERT FAILED: in-subtree move did not apply';
  end if;
  -- A manager cannot be moved under its own report.
  perform pg_temp.expect_error('move under own report',
    format('select public.admin_set_manager(%L, %L)', i->>'ug', i->>'vg'), 'manager_cycle');

  perform pg_temp.act_as((i->>'a')::uuid);
  perform pg_temp.expect_error('junior manager',
    format('select public.admin_set_manager(%L, %L)', i->>'m2g', i->>'ug'), 'manager_rank');
  perform pg_temp.expect_error('cross org manager',
    format('select public.admin_set_manager(%L, %L)', i->>'vg', i->>'og'), 'manager_other_org');
end $$;

-- ── No cycles, even for super_admin ────────────────────────────────────────
do $$
declare i jsonb := (select jsonb_object_agg(k, v) from t_ids);
begin
  perform pg_temp.act_as((i->>'s')::uuid);
  perform pg_temp.expect_error('cycle via descendant',
    format('select public.admin_set_manager(%L, %L)', i->>'ag', i->>'vg'), 'manager_cycle');
  perform pg_temp.expect_error('self manager',
    format('select public.admin_set_manager(%L, %L)', i->>'ag', i->>'ag'), 'invalid_manager');
end $$;

-- ── Removing a manager re-parents its reports as a group ───────────────────
do $$
declare
  i jsonb := (select jsonb_object_agg(k, v) from t_ids);
  v_w uuid := pg_temp.mk_user('t442w_' || substr(gen_random_uuid()::text, 1, 8));
  v_wg uuid;
begin
  insert into public.admin_role_grants (user_id, role, scope_org_id, manager_grant_id)
  values (v_w, 'org_volunteer', (i->>'org_x')::uuid, (i->>'ug')::uuid) returning grant_id into v_wg;

  perform pg_temp.act_as((i->>'a')::uuid);
  perform public.admin_revoke_role((i->>'ug')::uuid);   -- ug managed vg + w, reports to m1g

  if exists (select 1 from public.admin_role_grants
              where grant_id in ((i->>'vg')::uuid, v_wg)
                and manager_grant_id is distinct from (i->>'m1g')::uuid) then
    raise exception 'ASSERT FAILED: reports not re-parented to removed manager''s manager';
  end if;
  if not exists (select 1 from public.audit_events
                  where action = 'admin_role_revoke'
                    and metadata->>'grant_id' = i->>'ug'
                    and metadata->>'reparented_to' = i->>'m1g'
                    and jsonb_array_length(metadata->'reparented_grant_ids') = 2) then
    raise exception 'ASSERT FAILED: revoke + re-parent not audited';
  end if;
end $$;

-- ── super_admin may do everything (except create another super_admin) ──────
do $$
declare
  i jsonb := (select jsonb_object_agg(k, v) from t_ids);
  v_admin_grant uuid;
begin
  perform pg_temp.act_as((i->>'s')::uuid);
  v_admin_grant := public.admin_grant_role((i->>'u')::uuid, 'admin', null);
  if (select manager_grant_id from public.admin_role_grants where grant_id = v_admin_grant)
     is distinct from (i->>'sg')::uuid then
    raise exception 'ASSERT FAILED: platform admin should report to super_admin';
  end if;
  perform public.admin_set_manager((i->>'m2g')::uuid, (i->>'m1g')::uuid);  -- rank bypass
  perform public.admin_set_manager((i->>'m2g')::uuid, null);               -- detach allowed
  perform public.admin_revoke_role((i->>'ag')::uuid);
  if (select manager_grant_id from public.admin_role_grants where grant_id = (i->>'m1g')::uuid)
     is distinct from (i->>'sg')::uuid then
    raise exception 'ASSERT FAILED: org_admin reports should move under super_admin';
  end if;

  -- platform admin: can grant org_admin, cannot grant admin (equal).
  perform pg_temp.act_as((i->>'u')::uuid);
  perform pg_temp.expect_error('admin grants admin',
    format('select public.admin_grant_role(%L, %L, %L)', i->>'a', 'admin', null), 'forbidden_grant');
  perform public.admin_grant_role((i->>'a')::uuid, 'org_admin', (i->>'org_y')::uuid);
end $$;

rollback;

\echo '✓ 0442_admin_hierarchy_position_permissions.sql passed'
