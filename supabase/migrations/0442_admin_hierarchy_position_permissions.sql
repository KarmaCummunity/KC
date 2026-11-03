-- 0442_admin_hierarchy_position_permissions — hierarchy-based permissions per spec
-- (FR-ADMIN-027, P3.A-Tree.4 Phase 1).
--
-- Management authority now follows the position in the org tree
-- (admin_role_grants.manager_grant_id, migration 0203):
--   • role_rank(role)                — total order of PRD V2 roles (higher = more senior).
--   • actor_scope_rank(actor, scope) — the actor's most senior active rank that applies
--                                      to a scope (own-scope grants + platform super_admin/admin).
--   • can_manage_grant(actor, grant) — super_admin, or the actor holds an active grant that is
--                                      an ancestor of the target AND strictly more senior.
--   • can_grant_role                 — existing role matrix AND strictly lower rank than the actor.
--   • admin_grant_role               — a new grant is placed under the granting actor's grant.
--   • admin_revoke_role              — actor must manage the grant; direct reports are re-parented
--                                      as a group to the revoked grant's manager; audited.
--   • admin_set_manager              — target must be managed by the actor and the new manager must
--                                      be the actor or inside the actor's subtree and strictly more
--                                      senior than the target. super_admin bypasses rank/position.
--   • Restores the PRD V2 `admin` role in the role allow-list.
--
-- Mapped to spec: FR-ADMIN-027 (docs/SSOT/spec/12_super_admin.md §16), PRD_V2 02_Personas_Roles §2.1.

-- ── 1. Role allow-list: restore `admin` (PRD V2 §2.1) ──────────────────────
alter table public.admin_role_grants
  drop constraint if exists admin_role_grants_role_check;
alter table public.admin_role_grants
  add constraint admin_role_grants_role_check check (role in (
    'super_admin', 'admin', 'moderator', 'support',
    'operator', 'operators_manager',
    'org_admin', 'org_manager', 'org_employee',
    'volunteer', 'volunteer_manager', 'org_volunteer'
  ));

-- ── 2. role_rank ───────────────────────────────────────────────────────────
create or replace function public.role_rank(p_role text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_role
    when 'super_admin'       then 100
    when 'admin'             then 90
    when 'org_admin'         then 80
    when 'org_manager'       then 70
    when 'moderator'         then 60
    when 'operators_manager' then 60
    when 'volunteer_manager' then 60
    when 'support'           then 50
    when 'org_employee'      then 40
    when 'operator'          then 40
    when 'org_volunteer'     then 30
    when 'volunteer'         then 20
    else 0
  end;
$$;
grant execute on function public.role_rank(text) to authenticated;

-- ── 3. actor_scope_rank ────────────────────────────────────────────────────
create or replace function public.actor_scope_rank(p_actor uuid, p_scope uuid)
returns integer
language sql
stable security definer
set search_path = public
as $$
  select coalesce(max(public.role_rank(g.role)), 0)
    from public.admin_role_grants g
   where g.user_id = p_actor
     and g.revoked_at is null
     and (g.scope_org_id is not distinct from p_scope
          or g.role in ('super_admin', 'admin'));
$$;
revoke execute on function public.actor_scope_rank(uuid, uuid) from public;
grant  execute on function public.actor_scope_rank(uuid, uuid) to authenticated;

-- ── 4. can_manage_grant ────────────────────────────────────────────────────
create or replace function public.can_manage_grant(p_actor uuid, p_grant_id uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select case
    when p_actor is null or p_grant_id is null then false
    when public.has_admin_role(p_actor, 'super_admin', null) then true
    else exists (
      select 1
        from public.admin_role_grants a
        join public.admin_role_grants t on t.grant_id = p_grant_id
       where a.user_id = p_actor
         and a.revoked_at is null
         and a.grant_id <> t.grant_id
         and t.user_id <> p_actor
         and public.role_rank(a.role) > public.role_rank(t.role)
         and public.is_ancestor(a.grant_id, t.grant_id)
    )
  end;
$$;
revoke execute on function public.can_manage_grant(uuid, uuid) from public;
grant  execute on function public.can_manage_grant(uuid, uuid) to authenticated;

-- ── 5. can_grant_role: role matrix AND strictly lower rank ─────────────────
create or replace function public.can_grant_role(
  granter_uid uuid,
  target_role text,
  target_scope uuid
)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select case
    when target_role = 'super_admin' then false
    when public.has_admin_role(granter_uid, 'super_admin', null) then true
    when public.role_rank(target_role)
         >= public.actor_scope_rank(granter_uid, target_scope) then false
    when public.has_admin_role(granter_uid, 'admin', null)
      then target_role in (
        'admin','moderator','support',
        'operator','operators_manager',
        'org_admin','org_manager','org_employee',
        'volunteer_manager','org_volunteer'
      )
    when target_scope is not null
         and public.has_admin_role(granter_uid, 'org_admin', target_scope)
      then target_role in (
        'org_manager','operators_manager','volunteer_manager',
        'org_employee','org_volunteer','operator'
      )
    when target_scope is not null
         and public.has_admin_role(granter_uid, 'org_manager', target_scope)
      then target_role in (
        'org_manager','operators_manager','volunteer_manager',
        'org_employee','org_volunteer','operator'
      )
    when target_scope is not null
         and public.has_admin_role(granter_uid, 'volunteer_manager', target_scope)
      then target_role in ('volunteer_manager','org_volunteer')
    when target_scope is not null
         and public.has_admin_role(granter_uid, 'operators_manager', target_scope)
      then target_role = 'operator'
    else false
  end;
$$;
revoke execute on function public.can_grant_role(uuid, text, uuid) from public;
grant  execute on function public.can_grant_role(uuid, text, uuid) to authenticated;

-- ── 6. admin_grant_role: place the new grant under the actor ───────────────
create or replace function public.admin_grant_role(
  p_target_user_id uuid,
  p_role text,
  p_scope_org_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor          uuid := auth.uid();
  v_grant_id       uuid;
  v_manager_grant  uuid;
  v_target_status  text;
  v_allowed_roles  text[] := array[
    'admin','moderator','support',
    'operator','operators_manager',
    'org_admin','org_manager','org_employee',
    'volunteer_manager','org_volunteer'
  ];
  v_platform_roles text[] := array['admin','moderator','support'];
  v_org_roles      text[] := array[
    'operator','operators_manager',
    'org_admin','org_manager','org_employee',
    'volunteer_manager','org_volunteer'
  ];
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_target_user_id is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_role is null or not (p_role = any (v_allowed_roles)) then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if p_role = any (v_platform_roles) and p_scope_org_id is not null then
    raise exception 'invalid_scope' using errcode = '22023',
      detail = 'platform roles must have null scope_org_id';
  end if;
  if p_role = any (v_org_roles) and p_scope_org_id is null then
    raise exception 'invalid_scope' using errcode = '22023',
      detail = 'org roles require non-null scope_org_id';
  end if;
  if not public.can_grant_role(v_actor, p_role, p_scope_org_id) then
    raise exception 'forbidden_grant' using errcode = '42501';
  end if;

  select account_status into v_target_status
    from public.users where user_id = p_target_user_id;
  if v_target_status is null then
    raise exception 'target_not_found' using errcode = 'P0002';
  end if;
  if v_target_status <> 'active' then
    raise exception 'target_not_active' using errcode = '23514';
  end if;

  -- The new grant reports to the actor's most senior applicable grant.
  -- Org grants may sit under an own-org or platform grant; platform grants
  -- only under platform grants (same rule as admin_set_manager).
  select g.grant_id into v_manager_grant
    from public.admin_role_grants g
   where g.user_id = v_actor
     and g.revoked_at is null
     and (
       g.scope_org_id is null
       or (p_scope_org_id is not null and g.scope_org_id = p_scope_org_id)
     )
   order by public.role_rank(g.role) desc,
            (g.scope_org_id is not distinct from p_scope_org_id) desc
   limit 1;

  begin
    insert into public.admin_role_grants (user_id, role, scope_org_id, granted_by, manager_grant_id)
    values (p_target_user_id, p_role, p_scope_org_id, v_actor, v_manager_grant)
    returning grant_id into v_grant_id;
  exception when unique_violation then
    raise exception 'role_already_active' using errcode = '23505';
  end;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_role_grant', 'user', p_target_user_id,
          jsonb_build_object('role', p_role, 'grant_id', v_grant_id,
                             'scope_org_id', p_scope_org_id,
                             'manager_grant_id', v_manager_grant));
  return v_grant_id;
end;
$$;
revoke execute on function public.admin_grant_role(uuid, text, uuid) from public;
grant  execute on function public.admin_grant_role(uuid, text, uuid) to authenticated;

-- ── 7. admin_revoke_role: position gate + group re-parent ──────────────────
create or replace function public.admin_revoke_role(p_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor       uuid := auth.uid();
  v_user_id     uuid;
  v_role        text;
  v_scope       uuid;
  v_revoked_at  timestamptz;
  v_parent      uuid;
  v_super_count int;
  v_moved       uuid[];
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_grant_id is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select user_id, role, scope_org_id, revoked_at, manager_grant_id
    into v_user_id, v_role, v_scope, v_revoked_at, v_parent
    from public.admin_role_grants
   where grant_id = p_grant_id
   for update;
  if v_user_id is null then
    raise exception 'grant_not_found' using errcode = 'P0002';
  end if;
  if v_revoked_at is not null then
    raise exception 'grant_already_revoked' using errcode = '23514';
  end if;

  if v_role = 'super_admin' then
    if not public.has_admin_role(v_actor, 'super_admin', null) then
      raise exception 'forbidden_revoke' using errcode = '42501';
    end if;
    select count(*) into v_super_count
      from public.admin_role_grants
     where role = 'super_admin' and revoked_at is null;
    if v_super_count <= 1 then
      raise exception 'cannot_revoke_last_super_admin' using errcode = 'P0001';
    end if;
  elsif not (
    public.can_manage_grant(v_actor, p_grant_id)
    and public.can_grant_role(v_actor, v_role, v_scope)
  ) then
    raise exception 'forbidden_revoke' using errcode = '42501';
  end if;

  update public.admin_role_grants
     set revoked_at = now(), revoked_by = v_actor
   where grant_id = p_grant_id;

  -- Direct reports move as a group to the revoked grant's manager.
  with moved as (
    update public.admin_role_grants
       set manager_grant_id = v_parent
     where manager_grant_id = p_grant_id
    returning grant_id
  )
  select coalesce(array_agg(grant_id), '{}') into v_moved from moved;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_role_revoke', 'user', v_user_id,
          jsonb_build_object('role', v_role, 'grant_id', p_grant_id,
                             'scope_org_id', v_scope,
                             'reparented_to', v_parent,
                             'reparented_grant_ids', to_jsonb(v_moved)));
end;
$$;
revoke execute on function public.admin_revoke_role(uuid) from public;
grant  execute on function public.admin_revoke_role(uuid) to authenticated;

-- ── 8. admin_set_manager: position + rank gates ────────────────────────────
create or replace function public.admin_set_manager(
  p_grant_id uuid,
  p_manager_grant_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_is_super   boolean;
  v_g_role     text;
  v_g_scope    uuid;
  v_g_revoked  timestamptz;
  v_m_role     text;
  v_m_user     uuid;
  v_m_scope    uuid;
  v_m_revoked  timestamptz;
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_grant_id is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_is_super := public.has_admin_role(v_actor, 'super_admin', null);

  select role, scope_org_id, revoked_at
    into v_g_role, v_g_scope, v_g_revoked
    from public.admin_role_grants
   where grant_id = p_grant_id
   for update;
  if v_g_role is null then
    raise exception 'grant_not_found' using errcode = 'P0002';
  end if;
  if v_g_revoked is not null then
    raise exception 'grant_already_revoked' using errcode = '23514';
  end if;

  if not v_is_super and not public.can_manage_grant(v_actor, p_grant_id) then
    raise exception 'forbidden_manage' using errcode = '42501';
  end if;

  if p_manager_grant_id is null then
    -- Detaching to a root would leave the actor's subtree: super_admin only.
    if not v_is_super then
      raise exception 'forbidden_manage' using errcode = '42501';
    end if;
    update public.admin_role_grants set manager_grant_id = null where grant_id = p_grant_id;
    insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
    values (v_actor, 'admin_set_manager', 'user',
            (select user_id from public.admin_role_grants where grant_id = p_grant_id),
            jsonb_build_object('grant_id', p_grant_id, 'manager_grant_id', null));
    return;
  end if;

  if p_manager_grant_id = p_grant_id then
    raise exception 'invalid_manager' using errcode = '22023',
      detail = 'a grant cannot manage itself';
  end if;

  select role, user_id, scope_org_id, revoked_at
    into v_m_role, v_m_user, v_m_scope, v_m_revoked
    from public.admin_role_grants
   where grant_id = p_manager_grant_id;
  if not found then
    raise exception 'manager_not_found' using errcode = 'P0002';
  end if;
  if v_m_revoked is not null then
    raise exception 'manager_revoked' using errcode = '23514';
  end if;

  if v_g_scope is null then
    if v_m_scope is not null then
      raise exception 'manager_other_org' using errcode = '22023';
    end if;
  elsif v_m_scope is not null and v_m_scope <> v_g_scope then
    raise exception 'manager_other_org' using errcode = '22023';
  end if;

  if public.is_ancestor(p_grant_id, p_manager_grant_id) then
    raise exception 'manager_cycle' using errcode = 'P0001';
  end if;

  if not v_is_super then
    -- The new manager must be the actor or inside the actor's subtree.
    if not (v_m_user = v_actor or public.can_manage_grant(v_actor, p_manager_grant_id)) then
      raise exception 'forbidden_manage' using errcode = '42501';
    end if;
    -- A report must be strictly junior to its manager.
    if public.role_rank(v_g_role) >= public.role_rank(v_m_role) then
      raise exception 'manager_rank' using errcode = '22023';
    end if;
  end if;

  update public.admin_role_grants
     set manager_grant_id = p_manager_grant_id
   where grant_id = p_grant_id;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_set_manager', 'user',
          (select user_id from public.admin_role_grants where grant_id = p_grant_id),
          jsonb_build_object('grant_id', p_grant_id,
                             'manager_grant_id', p_manager_grant_id,
                             'role', v_g_role,
                             'scope_org_id', v_g_scope));
end;
$$;
revoke execute on function public.admin_set_manager(uuid, uuid) from public;
grant  execute on function public.admin_set_manager(uuid, uuid) to authenticated;
