-- Moderation · hierarchy census and the first super admin (FR-ADMIN-028 AC3/AC4,
-- FR-ADMIN-006 AC2, FR-ADMIN-017)
--
-- The layers view of the staff hierarchy stands on a masked base: how many community
-- members there are, how many of them hold a role, and, per organization the caller may
-- read, how many members declared an affiliation with it without holding a role there.
-- Counts only, never identities. Community members are the accounts that are active or
-- suspended (D84): a suspended member stays a member until staff decide; banned, deleted
-- and unverified accounts are not members.
--
-- The super admin grant is never handed out by an RPC (FR-ADMIN-016). A new database has
-- none, so nobody could grant anything: the operator creates the first one once, with the
-- service-role function below (docs/db/cutover-runbook.md, "First super admin").

-- Account statuses that count as community members (D84).
create function kc_private.is_community_member(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_account a
                  where a.user_id = p_user_id
                    and a.status in ('active', 'suspended_admin', 'suspended_for_false_reports'));
$$;
comment on function kc_private.is_community_member(uuid) is
  'The member''s account is active or suspended (D84 community membership).';

-- The census of the layers view, as one JSON object:
--   community_total   community members
--   role_holder_total community members holding at least one active grant
--   orgs              the organizations the caller may read (admin_org_tree visibility), the
--                     platform organization first, each with its page slug, its verification and the
--                     number of members affiliated with it (user_profile_fields) who hold
--                     no active grant in it
-- Callers must be community members holding an active grant (forbidden, 42501).
create function public.admin_hierarchy_census()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_caller();
  v_platform_org constant uuid := (select o.id from public.organizations o where o.is_platform);
  v_org_ids uuid[];
  v_result json;
begin
  if not kc_private.is_community_member(v_actor)
     or not exists (select 1 from public.admin_role_grants g where g.user_id = v_actor and g.revoked_at is null) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- The roster rule decides the organizations; it reads active accounts only, so a
  -- suspended grant holder sees the organizations their own grants reach.
  if kc_access.has_admin_role('admin') then
    v_org_ids := null;
  else
    select array_agg(distinct coalesce(g.scope_org_id, v_platform_org)) into v_org_ids
      from public.admin_role_grants g where g.user_id = v_actor and g.revoked_at is null;
  end if;

  with members as (
    select a.user_id from public.user_account a
     where a.status in ('active', 'suspended_admin', 'suspended_for_false_reports')),
  holders as (
    select distinct g.user_id, coalesce(g.scope_org_id, v_platform_org) as org_id
      from public.admin_role_grants g
      join members m on m.user_id = g.user_id
     where g.revoked_at is null),
  visible_orgs as (
    select o.id, o.slug, o.name, o.is_platform, o.verified_at, o.is_verified_nonprofit
      from public.organizations o
     where v_org_ids is null or o.id = any (v_org_ids)),
  affiliated as (
    select f.affiliated_org_id as org_id, count(*)::integer as cnt
      from public.user_profile_fields f
      join members m on m.user_id = f.user_id
      join visible_orgs vo on vo.id = f.affiliated_org_id
     where f.field_key = 'affiliated_org'
       and not exists (select 1 from holders h where h.user_id = f.user_id and h.org_id = f.affiliated_org_id)
     group by f.affiliated_org_id)
  select json_build_object(
    'community_total', (select count(*)::integer from members),
    'role_holder_total', (select count(distinct h.user_id)::integer from holders h),
    'orgs', coalesce((
      select json_agg(json_build_object(
               'org_id', vo.id, 'slug', vo.slug, 'name', vo.name, 'is_platform', vo.is_platform,
               'is_verified', vo.verified_at is not null or vo.is_verified_nonprofit,
               'affiliated_count', coalesce(a.cnt, 0))
             order by vo.is_platform desc, vo.name)
        from visible_orgs vo
        left join affiliated a on a.org_id = vo.id), '[]'::json))
    into v_result;
  return v_result;
end;
$$;
comment on function public.admin_hierarchy_census() is
  'Masked census of the layers view: community and role-holder totals, affiliates per visible organization (FR-ADMIN-028).';
grant execute on function public.admin_hierarchy_census() to authenticated;

-- Creates the first super admin grant for an active member and returns its id. Refuses
-- (super_admin_exists) while an active super admin exists, and (target_not_active) for a
-- member who is not active. The grant trigger audits it. Run by the operator as the
-- database owner or the service role; never reachable from a device.
create function kc_private.bootstrap_super_admin(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
begin
  -- Serializes two bootstraps started together; the unique index is the last word.
  lock table public.admin_role_grants in share row exclusive mode;
  if exists (select 1 from public.admin_role_grants g where g.role = 'super_admin' and g.revoked_at is null) then
    raise exception 'super_admin_exists' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.users u where u.id = p_user_id and u.is_active) then
    raise exception 'target_not_active' using errcode = 'P0001';
  end if;
  insert into public.admin_role_grants (user_id, role) values (p_user_id, 'super_admin')
  returning id into v_grant_id;
  return v_grant_id;
end;
$$;
comment on function kc_private.bootstrap_super_admin(uuid) is
  'Operator only (database owner or service role): creates the first super admin grant; refuses while one exists.';
revoke execute on function kc_private.bootstrap_super_admin(uuid) from public, anon, authenticated;
grant execute on function kc_private.bootstrap_super_admin(uuid) to service_role;
