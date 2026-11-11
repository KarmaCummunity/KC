-- 0465_admin_team_management — FR-ADMIN-030 end-to-end team management.
--
-- Two changes that let every organisation run its own team from the admin
-- portal (project book D86) while permissions stay role-derived (D85):
--
--   1. `admin_list_admins` is scoped like `admin_org_tree` (migration 0203):
--      super_admin sees every grant; anyone else sees only grants in the orgs
--      their own active grants reach (platform-scoped grants resolve to the
--      platform org). Before this, any grant holder read the full roster and
--      the UI was the only filter.
--
--   2. `admin_change_role(p_grant_id, p_new_role)` replaces one grant's role in
--      a single transaction: the old grant is revoked, a new grant with the same
--      user, scope and direct manager is inserted, and every active report of
--      the old grant is re-pointed to the new one, so the person keeps their
--      place in the reporting chain. The caller needs the revoke authority over
--      the grant (`can_manage_grant`, FR-ADMIN-027) and may grant both the old
--      and the new role in that scope (`can_grant_role`).
--
-- Mapped to spec: FR-ADMIN-030 (docs/SSOT/spec/12_super_admin.md §18).
-- Decisions: D-197; project book D85, D86.

-- ── 1. admin_list_admins: org-scoped roster ─────────────────────────────────
create or replace function public.admin_list_admins(p_include_revoked boolean default false)
returns table (
  grant_id                uuid,
  user_id                 uuid,
  display_name            text,
  avatar_url              text,
  role                    text,
  scope_org_id            uuid,
  granted_at              timestamptz,
  granted_by              uuid,
  granted_by_display_name text,
  revoked_at              timestamptz,
  revoked_by              uuid,
  last_seen_at            timestamptz
)
language plpgsql
stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_actor        uuid := auth.uid();
  v_is_super     boolean;
  v_platform_org uuid;
begin
  -- Any active grant may read the roster (unchanged gate).
  if v_actor is null
     or not exists (
       select 1 from public.admin_role_grants arg
       where arg.user_id = v_actor and arg.revoked_at is null
     ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_is_super := public.has_admin_role(v_actor, 'super_admin', null);
  select o.org_id into v_platform_org
    from public.organizations o where o.is_platform limit 1;

  return query
  with my_orgs as (
    -- Orgs the caller's own active grants reach, platform grants resolved to
    -- the platform org — the same visibility rule as admin_org_tree.
    select distinct coalesce(mg.scope_org_id, v_platform_org) as eff_org
      from public.admin_role_grants mg
     where mg.user_id = v_actor and mg.revoked_at is null
  )
  select
    g.grant_id,
    g.user_id,
    u.display_name,
    u.avatar_url,
    g.role,
    g.scope_org_id,
    g.granted_at,
    g.granted_by,
    gby.display_name as granted_by_display_name,
    g.revoked_at,
    g.revoked_by,
    (
      select max(d.last_seen_at)
        from public.devices d
        where d.user_id = g.user_id
    ) as last_seen_at
  from public.admin_role_grants g
  join public.users u   on u.user_id   = g.user_id
  left join public.users gby on gby.user_id = g.granted_by
  where (p_include_revoked or g.revoked_at is null)
    and (
      v_is_super
      or coalesce(g.scope_org_id, v_platform_org) in (select eff_org from my_orgs)
    )
  order by
    case g.role
      when 'super_admin'        then 0
      when 'admin'              then 1
      when 'moderator'          then 2
      when 'support'            then 3
      when 'operators_manager'  then 4
      when 'operator'           then 5
      when 'org_admin'          then 6
      when 'org_manager'        then 7
      when 'volunteer_manager'  then 8
      when 'org_employee'       then 9
      when 'org_volunteer'      then 10
      else 99
    end,
    g.scope_org_id nulls first,
    g.granted_at desc;
end;
$$;

revoke execute on function public.admin_list_admins(boolean) from public, anon;
grant  execute on function public.admin_list_admins(boolean) to authenticated;

-- ── 2. admin_change_role: atomic role replacement ───────────────────────────
create or replace function public.admin_change_role(
  p_grant_id uuid,
  p_new_role text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor          uuid := auth.uid();
  v_user           uuid;
  v_old_role       text;
  v_scope          uuid;
  v_manager        uuid;
  v_revoked        timestamptz;
  v_new_grant      uuid;
  -- Same grantable enum and scope shapes as admin_grant_role (migration 0173).
  v_allowed_roles  text[] := array[
    'admin','moderator','support',
    'operator','operators_manager',
    'org_admin','org_manager','org_employee',
    'volunteer_manager','org_volunteer'
  ];
  v_platform_roles text[] := array['admin','moderator','support'];
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_grant_id is null or p_new_role is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not (p_new_role = any (v_allowed_roles)) then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  -- Lock the grant so a concurrent revoke/change cannot interleave.
  select user_id, role, scope_org_id, manager_grant_id, revoked_at
    into v_user, v_old_role, v_scope, v_manager, v_revoked
    from public.admin_role_grants
   where grant_id = p_grant_id
     for update;
  if v_user is null then
    raise exception 'grant_not_found' using errcode = 'P0002';
  end if;
  if v_revoked is not null then
    raise exception 'grant_already_revoked' using errcode = '23514';
  end if;
  if v_old_role = p_new_role then
    raise exception 'role_already_active' using errcode = '23505';
  end if;

  -- The new role must fit the grant's scope: a change never moves a person
  -- between the platform and an org (that is a revoke plus a new grant).
  if (p_new_role = any (v_platform_roles)) <> (v_scope is null) then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;

  -- Authority as for a revoke plus a grant (FR-ADMIN-027, migration 0442): the
  -- caller manages the grant by position (an ancestor holding a more senior
  -- role; super_admin always), and may grant both the old and the new role in
  -- this scope (role matrix + strictly lower rank). super_admin is never
  -- grantable, so the super_admin grant can never be changed here.
  if not public.can_manage_grant(v_actor, p_grant_id)
     or not public.can_grant_role(v_actor, v_old_role, v_scope)
     or not public.can_grant_role(v_actor, p_new_role, v_scope) then
    raise exception 'forbidden_grant' using errcode = '42501';
  end if;

  update public.admin_role_grants
     set revoked_at = now(), revoked_by = v_actor
   where grant_id = p_grant_id;

  begin
    insert into public.admin_role_grants (user_id, role, scope_org_id, granted_by, manager_grant_id)
    values (v_user, p_new_role, v_scope, v_actor, v_manager)
    returning grant_id into v_new_grant;
  exception when unique_violation then
    -- The person already holds the new role in this scope; the whole change
    -- (including the revoke above) rolls back with this exception.
    raise exception 'role_already_active' using errcode = '23505';
  end;

  -- Keep the subtree attached: reports of the old grant now report to the new one.
  update public.admin_role_grants
     set manager_grant_id = v_new_grant
   where manager_grant_id = p_grant_id
     and revoked_at is null;

  -- Audited as the revoke + grant pair it is, with the existing actions (so the
  -- audit viewer needs no new type); `change_of` links the two rows.
  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values
    (v_actor, 'admin_role_revoke', 'user', v_user,
     jsonb_build_object('role', v_old_role, 'grant_id', p_grant_id,
                        'scope_org_id', v_scope, 'change_of', p_grant_id)),
    (v_actor, 'admin_role_grant', 'user', v_user,
     jsonb_build_object('role', p_new_role, 'grant_id', v_new_grant,
                        'scope_org_id', v_scope, 'change_of', p_grant_id));

  return v_new_grant;
end;
$$;

revoke all on function public.admin_change_role(uuid, text) from public, anon;
grant execute on function public.admin_change_role(uuid, text) to authenticated;
