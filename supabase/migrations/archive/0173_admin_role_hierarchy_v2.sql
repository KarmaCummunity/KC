-- 0173_admin_role_hierarchy_v2 — A2.1: widen admin_grant_role to the full
-- PRD V2 role hierarchy (PRD_V2_NOT_FOR_MVP/02_Personas_Roles.md §2.1).
--
-- Adds:
--   • `admin` role (platform sub-super_admin) in admin_role_grants.role
--   • `scope_org_id uuid` column on admin_role_grants (nullable; required for
--     operator / operators_manager / org_admin / org_manager / org_employee /
--     volunteer_manager / org_volunteer per PRD V2 §2.1 — every role in the
--     "Org Admin" sub-tree is org-scoped; forbidden for super_admin / admin /
--     moderator / support which are platform-wide).
--   • 3-arg overload `has_admin_role(uid, role, scope)` for scoped checks.
--   • Authority helper `can_grant_role(granter, target_role, target_scope)`
--     encoding the FR-ADMIN-016 matrix.
--   • `admin_grant_role(p_target_user_id, p_role, p_scope_org_id)` widened to
--     accept any role except super_admin, with scope shape + authority gates.
--   • `admin_revoke_role(p_grant_id)` re-gated on can_grant_role of the row
--     being revoked.
--   • `admin_list_admins(p_include_revoked)` returns `scope_org_id` and orders
--     the full role list.
--
-- Mapped to spec: FR-ADMIN-016 (V2 hierarchy), FR-ADMIN-017 AC1 generalised,
-- docs/SSOT/spec/12_super_admin.md §12 A2.1.

-- ── 1. Widen role allow-list with 'admin' ──────────────────────────────────
alter table public.admin_role_grants
  drop constraint if exists admin_role_grants_role_check;

alter table public.admin_role_grants
  add constraint admin_role_grants_role_check check (role in (
    'super_admin',
    'admin',
    'moderator', 'support',
    'operator', 'operators_manager',
    'org_admin', 'org_manager', 'org_employee',
    'volunteer_manager', 'org_volunteer'
  ));

-- ── 2. scope_org_id column + scope-shape constraint ────────────────────────
alter table public.admin_role_grants
  add column if not exists scope_org_id uuid;

comment on column public.admin_role_grants.scope_org_id is
  'Org-scope for org_admin / org_manager / org_employee / volunteer_manager / org_volunteer. NULL for platform-wide roles. No FK in this slice — organizations table lands in a follow-up.';

alter table public.admin_role_grants
  drop constraint if exists admin_role_grants_scope_shape;

alter table public.admin_role_grants
  add constraint admin_role_grants_scope_shape check (
    case
      when role in ('super_admin','admin','moderator','support')
        then scope_org_id is null
      when role in (
        'operator','operators_manager',
        'org_admin','org_manager','org_employee',
        'volunteer_manager','org_volunteer'
      )
        then scope_org_id is not null
    end
  );

-- ── 3. Swap unique-active-grant index to include scope ─────────────────────
drop index if exists admin_role_grants_active_user_role_uniq;

create unique index if not exists admin_role_grants_active_user_role_scope_uniq
  on public.admin_role_grants (
    user_id, role,
    coalesce(scope_org_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where revoked_at is null;

create index if not exists admin_role_grants_scope_role_active_idx
  on public.admin_role_grants (scope_org_id, role)
  where revoked_at is null and scope_org_id is not null;

-- ── 4. has_admin_role 3-arg overload (scope-aware) ─────────────────────────
create or replace function public.has_admin_role(uid uuid, role_name text, scope uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select case
    when uid is null or role_name is null then false
    else exists (
      select 1
      from public.admin_role_grants
      where user_id = uid
        and role = role_name
        and scope_org_id is not distinct from scope
        and revoked_at is null
    )
  end;
$$;

revoke execute on function public.has_admin_role(uuid, text, uuid) from public;
grant  execute on function public.has_admin_role(uuid, text, uuid) to authenticated;

-- ── 5. Authority helper — FR-ADMIN-016 matrix ──────────────────────────────
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
    -- super_admin cannot be granted via the RPC by anyone (DB-only escalation).
    when target_role = 'super_admin' then false

    -- super_admin grants anything else (platform or any org).
    when public.has_admin_role(granter_uid, 'super_admin', null) then true

    -- admin (platform sub-super_admin): same grantable set as super_admin
    -- minus super_admin itself; can act across any org.
    when public.has_admin_role(granter_uid, 'admin', null)
      then target_role in (
        'admin','moderator','support',
        'operator','operators_manager',
        'org_admin','org_manager','org_employee',
        'volunteer_manager','org_volunteer'
      )

    -- org_admin (scoped to X): all sub-org roles within X (and recursive org_manager).
    when target_scope is not null
         and public.has_admin_role(granter_uid, 'org_admin', target_scope)
      then target_role in (
        'org_manager','operators_manager','volunteer_manager',
        'org_employee','org_volunteer','operator'
      )

    -- org_manager (scoped to X) recursive: same set as org_admin within X.
    when target_scope is not null
         and public.has_admin_role(granter_uid, 'org_manager', target_scope)
      then target_role in (
        'org_manager','operators_manager','volunteer_manager',
        'org_employee','org_volunteer','operator'
      )

    -- volunteer_manager (scoped to X) recursive: only volunteer-tier within X.
    when target_scope is not null
         and public.has_admin_role(granter_uid, 'volunteer_manager', target_scope)
      then target_role in ('volunteer_manager','org_volunteer')

    -- operators_manager (scoped to X): only operator within X.
    when target_scope is not null
         and public.has_admin_role(granter_uid, 'operators_manager', target_scope)
      then target_role = 'operator'

    else false
  end;
$$;

revoke execute on function public.can_grant_role(uuid, text, uuid) from public;
grant  execute on function public.can_grant_role(uuid, text, uuid) to authenticated;

-- ── 6. admin_grant_role widened ────────────────────────────────────────────
drop function if exists public.admin_grant_role(uuid, text);

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
  v_target_status  text;
  v_allowed_roles  text[] := array[
    'admin','moderator','support',
    'operator','operators_manager',
    'org_admin','org_manager','org_employee',
    'volunteer_manager','org_volunteer'
  ];
  v_platform_roles text[] := array[
    'admin','moderator','support'
  ];
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

  -- Role enum check (excludes super_admin entirely).
  if p_role is null or not (p_role = any (v_allowed_roles)) then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  -- Scope-shape check.
  if p_role = any (v_platform_roles) and p_scope_org_id is not null then
    raise exception 'invalid_scope'
      using errcode = '22023',
            detail  = 'platform roles must have null scope_org_id';
  end if;
  if p_role = any (v_org_roles) and p_scope_org_id is null then
    raise exception 'invalid_scope'
      using errcode = '22023',
            detail  = 'org roles require non-null scope_org_id';
  end if;

  -- Authority check.
  if not public.can_grant_role(v_actor, p_role, p_scope_org_id) then
    raise exception 'forbidden_grant' using errcode = '42501';
  end if;

  -- Target existence + active state.
  select account_status
    into v_target_status
    from public.users
    where user_id = p_target_user_id;
  if v_target_status is null then
    raise exception 'target_not_found' using errcode = 'P0002';
  end if;
  if v_target_status <> 'active' then
    raise exception 'target_not_active' using errcode = '23514';
  end if;

  begin
    insert into public.admin_role_grants (user_id, role, scope_org_id, granted_by)
    values (p_target_user_id, p_role, p_scope_org_id, v_actor)
    returning grant_id into v_grant_id;
  exception when unique_violation then
    raise exception 'role_already_active' using errcode = '23505';
  end;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'admin_role_grant',
    'user',
    p_target_user_id,
    jsonb_build_object(
      'role', p_role,
      'grant_id', v_grant_id,
      'scope_org_id', p_scope_org_id
    )
  );

  return v_grant_id;
end;
$$;

revoke execute on function public.admin_grant_role(uuid, text, uuid) from public;
grant  execute on function public.admin_grant_role(uuid, text, uuid) to authenticated;

-- ── 7. admin_revoke_role re-gated on can_grant_role + scope ────────────────
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
  v_super_count int;
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_grant_id is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select user_id, role, scope_org_id, revoked_at
    into v_user_id, v_role, v_scope, v_revoked_at
    from public.admin_role_grants
    where grant_id = p_grant_id
    for update;

  if v_user_id is null then
    raise exception 'grant_not_found' using errcode = 'P0002';
  end if;
  if v_revoked_at is not null then
    raise exception 'grant_already_revoked' using errcode = '23514';
  end if;

  -- super_admin: only a super_admin may revoke another super_admin grant, and
  -- the partial unique index plus this guard preserves the "≥1 active
  -- super_admin" invariant (FR-ADMIN-017).
  if v_role = 'super_admin' then
    if not public.has_admin_role(v_actor, 'super_admin', null) then
      raise exception 'forbidden_revoke' using errcode = '42501';
    end if;
    select count(*)
      into v_super_count
      from public.admin_role_grants
      where role = 'super_admin' and revoked_at is null;
    if v_super_count <= 1 then
      raise exception 'cannot_revoke_last_super_admin' using errcode = 'P0001';
    end if;
  else
    if not public.can_grant_role(v_actor, v_role, v_scope) then
      raise exception 'forbidden_revoke' using errcode = '42501';
    end if;
  end if;

  update public.admin_role_grants
     set revoked_at = now(),
         revoked_by = v_actor
   where grant_id = p_grant_id;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'admin_role_revoke',
    'user',
    v_user_id,
    jsonb_build_object(
      'role', v_role,
      'grant_id', p_grant_id,
      'scope_org_id', v_scope
    )
  );
end;
$$;

revoke execute on function public.admin_revoke_role(uuid) from public;
grant  execute on function public.admin_revoke_role(uuid) to authenticated;

-- ── 8. admin_list_admins — surface scope_org_id + widen visibility ─────────
drop function if exists public.admin_list_admins(boolean);

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
  v_actor uuid := auth.uid();
begin
  -- Any active admin role (any tier, any scope) can read the admin list.
  -- Stricter per-role redaction is handled in the UI; the DB returns the full
  -- roster to anyone in admin_role_grants.
  if v_actor is null
     or not exists (
       select 1 from public.admin_role_grants arg
       where arg.user_id = v_actor and arg.revoked_at is null
     ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
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
    -- last_seen_at is on public.devices, not public.users. Take the most
    -- recent device touch per user (NULL if the user has never registered a
    -- device). Fixes a latent bug in migration 0143 which referenced a
    -- non-existent `u.last_seen_at` column.
    (
      select max(d.last_seen_at)
        from public.devices d
        where d.user_id = g.user_id
    ) as last_seen_at
  from public.admin_role_grants g
  join public.users u   on u.user_id   = g.user_id
  left join public.users gby on gby.user_id = g.granted_by
  where (p_include_revoked or g.revoked_at is null)
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

revoke execute on function public.admin_list_admins(boolean) from public;
grant  execute on function public.admin_list_admins(boolean) to authenticated;
