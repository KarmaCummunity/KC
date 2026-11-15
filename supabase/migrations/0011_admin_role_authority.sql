-- Moderation · grant authority of the role functions (FR-ADMIN-016 AC4, FR-ADMIN-027, FR-ADMIN-030)
--
-- Restores the grant-authority rules of the old role functions on top of the baseline
-- (60_moderation/010_admin_roles.sql, 020_admin_role_rpcs.sql):
--   • revoking or changing a grant needs, besides the position over it, the right to grant
--     the role it carries in its scope (FR-ADMIN-016 AC4, FR-ADMIN-030 AC5 / AC7);
--   • an organization never loses its last administrator through these functions (the
--     rule `org_remove_member` already applies);
--   • the super admin manages their own grants too, except the super admin grant itself
--     (FR-ADMIN-027 AC3);
--   • `admin_set_manager` takes an optional manager: only the super admin detaches a grant
--     to a tree root or places it under a grant that is not more senior (FR-ADMIN-027 AC5,
--     FR-ADMIN-030 AC10), and each refusal has its own error again (FR-ADMIN-030 AC9);
--   • the audit rows of one action are linked: a revoke lists the reports it moved
--     (FR-ADMIN-027 AC4) and the two rows of a role change carry `change_of`
--     (FR-ADMIN-030 AC5).
-- Errors added: org_last_admin (P0001); forbidden_manage (42501); manager_not_found,
-- manager_revoked, manager_other_org, manager_cycle, manager_rank (P0001).

-- ── Linked audit rows ───────────────────────────────────────────────────────
-- The grant triggers write the audit rows; an RPC that performs several writes as one
-- action states what links them in the transaction-local setting `kc.admin_role_audit`,
-- which the trigger merges into the metadata of every row it writes until it is cleared.

-- Sets (or, with null, clears) the link metadata of the following grant writes.
create function kc_private.admin_role_audit_link(p_link jsonb)
returns void
language sql
set search_path = ''
as $$
  select set_config('kc.admin_role_audit', coalesce(p_link::text, ''), true);
$$;
comment on function kc_private.admin_role_audit_link(jsonb) is
  'Sets the metadata that links the audit rows of the grant writes that follow, in this transaction.';

-- Same rows as the baseline trigger, plus the link metadata of the running action.
create or replace function kc_private.audit_admin_role_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- '' and an unset setting both mean "no link".
  v_link constant jsonb := nullif(current_setting('kc.admin_role_audit', true), '')::jsonb;
begin
  perform kc_private.audit_record(
    case
      when tg_op = 'INSERT' then 'admin_role_grant'
      when new.revoked_at is not null and old.revoked_at is null then 'admin_role_revoke'
      else 'admin_role_set_manager'
    end,
    'user', new.user_id,
    jsonb_build_object('grant_id', new.id, 'role', new.role, 'scope_org_id', new.scope_org_id,
                       'manager_grant_id', new.manager_grant_id) || coalesce(v_link, '{}'::jsonb));
  return null;
end;
$$;

-- ── Authority helpers ───────────────────────────────────────────────────────

-- True when the actor may revoke, change or move the grant: the super admin any grant but
-- the super admin grant (rank 100 is never below another rank), their own grants included;
-- anyone else a grant of someone else below a more senior grant of theirs.
create or replace function kc_private.admin_can_manage_grant(p_actor uuid, p_grant_id uuid)
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
       and ar.rank > tr.rank
       and (a.role = 'super_admin'
            or (t.user_id <> p_actor and kc_private.admin_grant_is_above(a.id, t.id))));
$$;

-- Refuses to end the last active administrator grant of an organization (org_last_admin),
-- as org_remove_member does. Other grants pass.
create function kc_private.admin_assert_not_last_org_admin(p_grant public.admin_role_grants)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_grant.role = 'org_admin'
     and not exists (select 1
                       from public.admin_role_grants g
                      where g.scope_org_id = p_grant.scope_org_id and g.role = 'org_admin'
                        and g.revoked_at is null and g.id <> p_grant.id) then
    raise exception 'org_last_admin' using errcode = 'P0001';
  end if;
end;
$$;
comment on function kc_private.admin_assert_not_last_org_admin(public.admin_role_grants) is
  'Raises org_last_admin when the grant is the last active org_admin grant of its organization.';

-- ── Revoke ──────────────────────────────────────────────────────────────────

-- Ends a grant the caller manages and whose role they may grant in its scope. Its direct
-- reports move, as a group, to the grant it reported to; the revoke event lists them.
create or replace function public.admin_revoke_role(p_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_active_caller();
  v_grant constant public.admin_role_grants := kc_private.admin_lock_managed_grant(v_actor, p_grant_id);
  v_moved uuid[];
begin
  if kc_private.admin_granting_grant(v_actor, v_grant.role, v_grant.scope_org_id) is null then
    raise exception 'forbidden_revoke' using errcode = '42501';
  end if;
  perform kc_private.admin_assert_not_last_org_admin(v_grant);

  -- The reports move first, while the grant they leave is still the one they name.
  perform kc_private.admin_role_audit_link(jsonb_build_object('reparented_from', p_grant_id));
  with moved as (
    update public.admin_role_grants g
       set manager_grant_id = v_grant.manager_grant_id
     where g.manager_grant_id = p_grant_id
    returning g.id)
  select coalesce(array_agg(m.id), '{}') into v_moved from moved m;

  perform kc_private.admin_role_audit_link(jsonb_build_object(
    'reparented_to', v_grant.manager_grant_id, 'reparented_grant_ids', to_jsonb(v_moved)));
  update public.admin_role_grants g set revoked_at = now(), revoked_by = v_actor where g.id = p_grant_id;
  perform kc_private.admin_role_audit_link(null);
end;
$$;
comment on function public.admin_revoke_role(uuid) is
  'Revokes a grant below the caller whose role the caller may grant, and re-parents its direct reports.';

-- ── Change ──────────────────────────────────────────────────────────────────

-- Replaces the role of a grant in one step: the member keeps their scope, their manager
-- and their active reports. The caller must manage the grant and be entitled to give both
-- the old and the new role in its scope; a change never moves a member between the
-- platform and an organization, and never leaves an organization without an administrator.
-- Both audit rows (and those of the re-pointed reports) carry `change_of` = the old grant.
create or replace function public.admin_change_role(p_grant_id uuid, p_new_role text)
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
  if kc_private.admin_granting_grant(v_actor, v_grant.role, v_grant.scope_org_id) is null
     or kc_private.admin_granting_grant(v_actor, p_new_role, v_grant.scope_org_id) is null then
    raise exception 'forbidden_grant' using errcode = '42501';
  end if;
  perform kc_private.admin_assert_not_last_org_admin(v_grant);

  perform kc_private.admin_role_audit_link(jsonb_build_object('change_of', p_grant_id));
  update public.admin_role_grants g set revoked_at = now(), revoked_by = v_actor where g.id = p_grant_id;
  begin
    insert into public.admin_role_grants (user_id, role, scope_org_id, granted_by, manager_grant_id)
    values (v_grant.user_id, p_new_role, v_grant.scope_org_id, v_actor, v_grant.manager_grant_id)
    returning id into v_new_grant_id;
  exception when unique_violation then
    -- The member already holds the new role there; the whole change rolls back.
    raise exception 'role_already_active' using errcode = 'P0001';
  end;
  update public.admin_role_grants g
     set manager_grant_id = v_new_grant_id
   where g.manager_grant_id = p_grant_id and g.revoked_at is null;
  perform kc_private.admin_role_audit_link(null);
  return v_new_grant_id;
end;
$$;
comment on function public.admin_change_role(uuid, text) is
  'Swaps the role of a grant, keeping its scope, manager and reports; returns the new grant id.';

-- ── Direct manager ──────────────────────────────────────────────────────────

-- Locks the active grant the caller moves and checks that they manage it (forbidden_manage).
create function kc_private.admin_lock_moved_grant(p_actor uuid, p_grant_id uuid)
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
    raise exception 'forbidden_manage' using errcode = '42501';
  end if;
  return v_grant;
end;
$$;

-- Checks the new manager of a grant, raising the error that names the first broken rule:
-- it exists and is active, sits in the same organization or on the platform (a platform
-- grant reports to a platform grant only), is not below the moved grant, and, unless the
-- caller is the super admin, is the caller's own grant or one they manage and strictly more
-- senior than the moved grant.
create function kc_private.admin_assert_manager(
  p_actor uuid, p_is_super boolean, p_grant public.admin_role_grants, p_manager_grant_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_manager public.admin_role_grants;
begin
  select g.* into v_manager from public.admin_role_grants g where g.id = p_manager_grant_id;
  if not found then
    raise exception 'manager_not_found' using errcode = 'P0001';
  end if;
  if v_manager.revoked_at is not null then
    raise exception 'manager_revoked' using errcode = 'P0001';
  end if;
  if v_manager.scope_org_id is distinct from p_grant.scope_org_id and v_manager.scope_org_id is not null then
    raise exception 'manager_other_org' using errcode = 'P0001';
  end if;
  -- A grant never reports to itself or to a grant below it.
  if v_manager.id = p_grant.id or kc_private.admin_grant_is_above(p_grant.id, v_manager.id) then
    raise exception 'manager_cycle' using errcode = 'P0001';
  end if;
  if p_is_super then
    return;
  end if;
  if not (v_manager.user_id = p_actor or kc_private.admin_can_manage_grant(p_actor, v_manager.id)) then
    raise exception 'forbidden_manage' using errcode = '42501';
  end if;
  if (select r.rank from kc_private.admin_roles r where r.role = v_manager.role)
     <= (select r.rank from kc_private.admin_roles r where r.role = p_grant.role) then
    raise exception 'manager_rank' using errcode = 'P0001';
  end if;
end;
$$;

-- Moves a grant the caller manages under another grant, or (super admin only, null
-- manager) detaches it to the top of its tree.
-- Adding the default keeps the function, its grant and its callers.
create or replace function public.admin_set_manager(p_grant_id uuid, p_manager_grant_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_active_caller();
  v_is_super constant boolean := kc_access.has_admin_role('super_admin');
  v_grant constant public.admin_role_grants := kc_private.admin_lock_moved_grant(v_actor, p_grant_id);
begin
  if p_manager_grant_id is null and not v_is_super then
    raise exception 'forbidden_manage' using errcode = '42501';
  end if;
  if p_manager_grant_id is not null then
    perform kc_private.admin_assert_manager(v_actor, v_is_super, v_grant, p_manager_grant_id);
  end if;
  update public.admin_role_grants g set manager_grant_id = p_manager_grant_id where g.id = p_grant_id;
end;
$$;
comment on function public.admin_set_manager(uuid, uuid) is
  'Moves a grant the caller manages under another grant; a null manager (super admin only) detaches it.';
