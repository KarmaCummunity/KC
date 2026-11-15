-- Moderation · staff roster, organization tree and last seen (FR-ADMIN-015, FR-ADMIN-025,
-- FR-ADMIN-030 AC1)
--
-- Every organization runs its own team (D86): org_admin, org_manager, volunteer_manager and
-- operators_manager read the grants of their organization, as the platform staff read the
-- whole roster (60_moderation/010_admin_roles.sql). The team screens read the roster and the
-- tree through two functions that add what the grant rows cannot carry: the names and
-- avatars of the holder and the granter, and when the holder was last seen. Device rows stay
-- owner-only; the last-seen time leaves the database through these functions only.
--
-- Visibility of both functions (FR-ADMIN-030 AC1, FR-ADMIN-028 AC4): a platform admin or
-- the super admin sees every grant; any other active grant holder sees the grants of the
-- organizations their own active grants reach, a platform grant counting as the platform
-- organization. Anyone else is refused (forbidden, 42501).

-- ── Last seen ───────────────────────────────────────────────────────────────

-- When the member last opened the app: the latest device check-in (push registration,
-- refreshed on every app start) or, for a member without a registered device, the start of
-- the last Israel calendar day they were active on. Null when neither is known.
create function kc_private.user_last_seen(p_user_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select max(d.last_seen_at) from public.user_devices d where d.user_id = p_user_id),
    (select max(a.active_on)::timestamp at time zone 'Asia/Jerusalem'
       from kc_private.user_active_days a where a.user_id = p_user_id));
$$;
comment on function kc_private.user_last_seen(uuid) is
  'Latest app open of a member (device check-in or active day); released only through the staff roster functions.';

-- ── Who reads which grants ──────────────────────────────────────────────────

-- Organizations whose team the caller runs: those where they hold an active team-managing
-- grant (org_admin, org_manager, volunteer_manager, operators_manager) as an active member.
create function kc_access.team_org_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct g.scope_org_id), '{}')
    from public.admin_role_grants g
    join public.users u on u.id = g.user_id and u.is_active
   where g.user_id = (select auth.uid())
     and g.revoked_at is null
     and g.role in ('org_admin', 'org_manager', 'volunteer_manager', 'operators_manager');
$$;
comment on function kc_access.team_org_ids() is
  'Policy predicate: organizations whose team the caller manages (FR-ADMIN-030 AC1).';
grant execute on function kc_access.team_org_ids() to authenticated;

-- The organization-scoped read of the grants follows every team-managing role, not only
-- the administrators of the organization.
alter policy admin_role_grants_select_org_admin on public.admin_role_grants
  using (scope_org_id = any ((select kc_access.team_org_ids())::uuid[]));

-- The organizations whose grants the caller reads through the roster functions, or null
-- when they read every grant (a platform admin or the super admin). Raises forbidden unless
-- the caller is an active member with an active grant.
create function kc_private.admin_roster_org_ids(p_actor uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_platform_org constant uuid := (select o.id from public.organizations o where o.is_platform);
  v_org_ids uuid[];
begin
  select array_agg(distinct coalesce(g.scope_org_id, v_platform_org)) into v_org_ids
    from public.admin_role_grants g
    join public.users u on u.id = g.user_id and u.is_active
   where g.user_id = p_actor and g.revoked_at is null;
  if v_org_ids is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if kc_access.has_admin_role('admin') then
    return null;
  end if;
  return v_org_ids;
end;
$$;
comment on function kc_private.admin_roster_org_ids(uuid) is
  'Organizations whose grants the caller reads in the roster (null = all); forbidden without an active grant.';

-- ── Roster ──────────────────────────────────────────────────────────────────

-- The grants the caller may read (FR-ADMIN-015 AC1/AC2), most senior role first, with the
-- names, the direct manager and the holder's last-seen time. Revoked grants only on request.
create function public.admin_list_admins(p_include_revoked boolean default false)
returns table (grant_id uuid, user_id uuid, display_name text, avatar_url text, role text,
               scope_org_id uuid, manager_grant_id uuid, granted_at timestamptz, granted_by uuid,
               granted_by_display_name text, revoked_at timestamptz, revoked_by uuid,
               last_seen_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_platform_org constant uuid := (select o.id from public.organizations o where o.is_platform);
  v_org_ids constant uuid[] := kc_private.admin_roster_org_ids(kc_private.require_caller());
begin
  return query
  select g.id, g.user_id, u.display_name, u.avatar_url, g.role, g.scope_org_id, g.manager_grant_id,
         g.granted_at, g.granted_by, gb.display_name, g.revoked_at, g.revoked_by,
         kc_private.user_last_seen(g.user_id)
    from public.admin_role_grants g
    join public.users u on u.id = g.user_id
    join kc_private.admin_roles r on r.role = g.role
    left join public.users gb on gb.id = g.granted_by
   where (p_include_revoked or g.revoked_at is null)
     and (v_org_ids is null or coalesce(g.scope_org_id, v_platform_org) = any (v_org_ids))
   order by r.rank desc, g.scope_org_id nulls first, g.granted_at desc;
end;
$$;
comment on function public.admin_list_admins(boolean) is
  'Staff roster the caller may read, with names, manager and last-seen time (FR-ADMIN-015, FR-ADMIN-030 AC1).';
grant execute on function public.admin_list_admins(boolean) to authenticated;

-- ── Organization tree ───────────────────────────────────────────────────────

-- The active grants the caller may read, each with the organization it counts in (platform
-- grants count in the platform organization), for the tree and layers views (FR-ADMIN-025
-- AC3, FR-ADMIN-028 AC4). p_org_id narrows the result to one organization.
create function public.admin_org_tree(p_org_id uuid default null)
returns table (grant_id uuid, user_id uuid, display_name text, avatar_url text, role text,
               scope_org_id uuid, effective_org_id uuid, org_name text, is_platform boolean,
               manager_grant_id uuid, last_seen_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_platform_org constant uuid := (select o.id from public.organizations o where o.is_platform);
  v_org_ids constant uuid[] := kc_private.admin_roster_org_ids(kc_private.require_caller());
begin
  return query
  with effective as (
    select g.*, coalesce(g.scope_org_id, v_platform_org) as eff_org_id
      from public.admin_role_grants g
     where g.revoked_at is null)
  select e.id, e.user_id, u.display_name, u.avatar_url, e.role, e.scope_org_id, e.eff_org_id,
         o.name, coalesce(o.is_platform, e.scope_org_id is null), e.manager_grant_id,
         kc_private.user_last_seen(e.user_id)
    from effective e
    join public.users u on u.id = e.user_id
    left join public.organizations o on o.id = e.eff_org_id
   where (v_org_ids is null or e.eff_org_id = any (v_org_ids))
     and (p_org_id is null or e.eff_org_id = p_org_id)
   order by o.name nulls first, e.role, u.display_name;
end;
$$;
comment on function public.admin_org_tree(uuid) is
  'Active grants the caller may read with their organization and manager edge (FR-ADMIN-025, FR-ADMIN-028).';
grant execute on function public.admin_org_tree(uuid) to authenticated;
