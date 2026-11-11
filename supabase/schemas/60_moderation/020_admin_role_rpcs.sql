-- Moderation · managing staff roles (FR-ADMIN-015/016, FR-ADMIN-027, FR-ADMIN-030)
--
-- Authority follows rank and position: a member grants only roles their own role lists
-- (always strictly junior), an organization role only inside its own organization, and
-- revokes or moves only grants that sit below one of their own in the reporting tree.
-- The super admin manages everything except the super admin grant itself.
-- Errors: forbidden / forbidden_grant / forbidden_revoke (42501); P0001 — invalid_role,
-- invalid_scope, target_not_found, target_not_active, role_already_active, grant_not_found,
-- grant_already_revoked, invalid_manager.

-- True when grant p_ancestor is above grant p_node in the reporting tree. UNION (not UNION
-- ALL) ends the walk even if the data ever contained a loop.
create function kc_private.admin_grant_is_above(p_ancestor uuid, p_node uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  with recursive chain as (
    select g.manager_grant_id as id from public.admin_role_grants g where g.id = p_node
    union
    select g.manager_grant_id from public.admin_role_grants g join chain c on g.id = c.id)
  select exists (select 1 from chain c where c.id = p_ancestor);
$$;

-- The actor's active grant that entitles them to hand out p_role in p_scope, most senior
-- first; null when they may not. A new grant reports to it.
create function kc_private.admin_granting_grant(p_actor uuid, p_role text, p_scope uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select g.id
    from public.admin_role_grants g
    join kc_private.admin_roles mine on mine.role = g.role
    join kc_private.admin_roles target on target.role = p_role
   where g.user_id = p_actor
     and g.revoked_at is null
     and p_role = any (mine.grantable_roles)
     and target.rank < mine.rank
     and target.is_platform = (p_scope is null)
     and (mine.is_platform or g.scope_org_id = p_scope)
   order by mine.rank desc
   limit 1;
$$;
comment on function kc_private.admin_granting_grant(uuid, text, uuid) is
  'The grant under which the actor may give a role in a scope; null when not entitled.';

-- True when the actor may revoke, change or move the grant: the super admin always (except
-- their own grant), anyone else when a more senior grant of theirs is above it.
create function kc_private.admin_can_manage_grant(p_actor uuid, p_grant_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.admin_role_grants t
      join kc_private.admin_roles tr on tr.role = t.role
      join public.admin_role_grants a on a.user_id = p_actor and a.revoked_at is null
      join kc_private.admin_roles ar on ar.role = a.role
     where t.id = p_grant_id
       and t.user_id <> p_actor
       and ar.rank > tr.rank
       and (a.role = 'super_admin' or kc_private.admin_grant_is_above(a.id, t.id)));
$$;

-- Locks an active grant the caller may manage and returns it.
create function kc_private.admin_lock_managed_grant(p_actor uuid, p_grant_id uuid)
returns public.admin_role_grants
language plpgsql
set search_path = ''
as $$
declare
  v_grant public.admin_role_grants;
begin
  select g.* into v_grant from public.admin_role_grants g where g.id = p_grant_id for update;
  if not found then
    raise exception 'grant_not_found' using errcode = 'P0001';
  end if;
  if v_grant.revoked_at is not null then
    raise exception 'grant_already_revoked' using errcode = 'P0001';
  end if;
  if not kc_private.admin_can_manage_grant(p_actor, p_grant_id) then
    raise exception 'forbidden_revoke' using errcode = '42501';
  end if;
  return v_grant;
end;
$$;

-- Gives a member a role. The new grant reports to the caller's grant that allowed it.
create function public.admin_grant_role(p_target_user_id uuid, p_role text, p_scope_org_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_active_caller();
  v_role kc_private.admin_roles;
  v_manager_grant_id uuid;
  v_grant_id uuid;
begin
  select r.* into v_role from kc_private.admin_roles r where r.role = p_role;
  if not found then
    raise exception 'invalid_role' using errcode = 'P0001';
  end if;
  if v_role.is_platform <> (p_scope_org_id is null) then
    raise exception 'invalid_scope' using errcode = 'P0001';
  end if;
  v_manager_grant_id := kc_private.admin_granting_grant(v_actor, p_role, p_scope_org_id);
  if v_manager_grant_id is null then
    raise exception 'forbidden_grant' using errcode = '42501';
  end if;
  if not exists (select 1 from public.users u where u.id = p_target_user_id) then
    raise exception 'target_not_found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.users u where u.id = p_target_user_id and u.is_active) then
    raise exception 'target_not_active' using errcode = 'P0001';
  end if;

  begin
    insert into public.admin_role_grants (user_id, role, scope_org_id, granted_by, manager_grant_id)
    values (p_target_user_id, p_role, p_scope_org_id, v_actor, v_manager_grant_id)
    returning id into v_grant_id;
  exception when unique_violation then
    raise exception 'role_already_active' using errcode = 'P0001';
  end;
  return v_grant_id;
end;
$$;
comment on function public.admin_grant_role(uuid, text, uuid) is
  'Grants a staff role the caller is entitled to hand out; returns the grant id.';
grant execute on function public.admin_grant_role(uuid, text, uuid) to authenticated;

-- Ends a grant. Its direct reports move, as a group, to the grant it reported to.
create function public.admin_revoke_role(p_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_active_caller();
  v_grant constant public.admin_role_grants := kc_private.admin_lock_managed_grant(v_actor, p_grant_id);
begin
  update public.admin_role_grants g set revoked_at = now(), revoked_by = v_actor where g.id = p_grant_id;
  update public.admin_role_grants g
     set manager_grant_id = v_grant.manager_grant_id
   where g.manager_grant_id = p_grant_id;
end;
$$;
comment on function public.admin_revoke_role(uuid) is 'Revokes a grant below the caller and re-parents its direct reports.';
grant execute on function public.admin_revoke_role(uuid) to authenticated;

-- Replaces the role of a grant in one step: the member keeps their scope, their manager
-- and their reports. The caller must manage the grant and be entitled to give the new role;
-- a change never moves a member between the platform and an organization.
create function public.admin_change_role(p_grant_id uuid, p_new_role text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_active_caller();
  v_grant constant public.admin_role_grants := kc_private.admin_lock_managed_grant(v_actor, p_grant_id);
  v_new_grant_id uuid;
begin
  if not exists (select 1 from kc_private.admin_roles r where r.role = p_new_role) then
    raise exception 'invalid_role' using errcode = 'P0001';
  end if;
  if v_grant.role = p_new_role then
    raise exception 'role_already_active' using errcode = 'P0001';
  end if;
  if not exists (select 1 from kc_private.admin_roles r
                  where r.role = p_new_role and r.is_platform = v_grant.is_platform) then
    raise exception 'invalid_scope' using errcode = 'P0001';
  end if;
  if kc_private.admin_granting_grant(v_actor, p_new_role, v_grant.scope_org_id) is null then
    raise exception 'forbidden_grant' using errcode = '42501';
  end if;

  update public.admin_role_grants g set revoked_at = now(), revoked_by = v_actor where g.id = p_grant_id;
  begin
    insert into public.admin_role_grants (user_id, role, scope_org_id, granted_by, manager_grant_id)
    values (v_grant.user_id, p_new_role, v_grant.scope_org_id, v_actor, v_grant.manager_grant_id)
    returning id into v_new_grant_id;
  exception when unique_violation then
    raise exception 'role_already_active' using errcode = 'P0001';
  end;
  update public.admin_role_grants g set manager_grant_id = v_new_grant_id where g.manager_grant_id = p_grant_id;
  return v_new_grant_id;
end;
$$;
comment on function public.admin_change_role(uuid, text) is
  'Swaps the role of a grant, keeping its scope, manager and reports; returns the new grant id.';
grant execute on function public.admin_change_role(uuid, text) to authenticated;

-- Moves a grant under another manager. The new manager must be an active grant that is
-- more senior than the moved one, in the same organization or on the platform, not below
-- the moved grant (no loops), and either the caller's own grant or one the caller manages.
create function public.admin_set_manager(p_grant_id uuid, p_manager_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_active_caller();
  v_grant constant public.admin_role_grants := kc_private.admin_lock_managed_grant(v_actor, p_grant_id);
begin
  if not exists (
       select 1
         from public.admin_role_grants m
         join kc_private.admin_roles mr on mr.role = m.role
         join kc_private.admin_roles tr on tr.role = v_grant.role
        where m.id = p_manager_grant_id
          and m.revoked_at is null
          and mr.rank > tr.rank
          and (m.scope_org_id is null or m.scope_org_id = v_grant.scope_org_id)
          and not kc_private.admin_grant_is_above(p_grant_id, m.id)
          and (m.user_id = v_actor or kc_private.admin_can_manage_grant(v_actor, m.id))) then
    raise exception 'invalid_manager' using errcode = 'P0001';
  end if;
  update public.admin_role_grants g set manager_grant_id = p_manager_grant_id where g.id = p_grant_id;
end;
$$;
comment on function public.admin_set_manager(uuid, uuid) is 'Moves a grant the caller manages under another, more senior grant.';
grant execute on function public.admin_set_manager(uuid, uuid) to authenticated;
