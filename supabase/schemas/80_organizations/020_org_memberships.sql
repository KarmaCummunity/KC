-- Organizations · memberships and the organization predicates
--
-- Who belongs to which organization, and in which roles. The roles themselves have one
-- writer: the organization-scoped grants of public.admin_role_grants (hierarchy, granting
-- rules and audit live there — FR-ADMIN-016, D85, D86). This table is their projection,
-- one row per member and organization, kept by trigger: it is what policies and RPCs read,
-- and it carries the one membership setting that is not a role (`can_post`).
--
-- Roles and what they allow (requirements/20 § Roles, requirements/19 § Roles):
--   manage the organization — edit its profile, edit and delete its posts (design §12.1):
--       org_admin, org_manager
--   publish in its name: org_admin, org_manager, org_employee, volunteer_manager, and an
--       org_volunteer whose `can_post` is on
--   finance: org_admin and org_treasurer keep the books, org_accountant reads them

-- Finance roles of an organization (FR-FIN-002). A holder grants only roles below their
-- own rank (FR-ADMIN-027), so a treasurer grants accountants, not other treasurers.
insert into kc_private.admin_roles (role, rank, is_platform, grantable_roles) values
  ('org_treasurer', 60, false, array['org_accountant']),
  ('org_accountant', 35, false, '{}');
update kc_private.admin_roles
   set grantable_roles = grantable_roles || array['org_treasurer', 'org_accountant']
 where role in ('super_admin', 'admin', 'org_admin');

-- The open foreign key of the grants table (see 60_moderation/010_admin_roles.sql; its
-- index is admin_role_grants_scope_idx). A grant has no meaning without its organization.
alter table public.admin_role_grants
  add constraint admin_role_grants_scope_org_fk
  foreign key (scope_org_id) references public.organizations (id) on delete cascade;

create table public.org_memberships (
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  -- Active organization roles of the member, most senior first. Written by trigger only.
  roles      text[] not null check (cardinality(roles) >= 1),
  -- Lets a volunteer publish in the organization's name (FR-ORG roles table).
  can_post   boolean not null default false,
  joined_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
comment on table public.org_memberships is
  'Members of an organization with their active roles; a projection of the organization-scoped role grants.';

-- "My organizations" and every predicate below; covers the member foreign key.
create index org_memberships_user_idx on public.org_memberships (user_id);

create trigger org_memberships_set_updated_at
  before update on public.org_memberships
  for each row execute function kc_private.set_updated_at();

-- Rebuilds the membership of one member in one organization from their active grants.
create function kc_private.org_membership_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant constant public.admin_role_grants := case when tg_op = 'DELETE' then old else new end;
  v_roles text[];
begin
  select array_agg(g.role order by r.rank desc, g.role) into v_roles
    from public.admin_role_grants g
    join kc_private.admin_roles r on r.role = g.role
   where g.user_id = v_grant.user_id and g.scope_org_id = v_grant.scope_org_id and g.revoked_at is null;

  if v_roles is null then
    delete from public.org_memberships m where m.org_id = v_grant.scope_org_id and m.user_id = v_grant.user_id;
  -- A cascade from a removed organization or member must not re-create the row.
  elsif exists (select 1 from public.organizations o where o.id = v_grant.scope_org_id)
        and exists (select 1 from public.users u where u.id = v_grant.user_id) then
    insert into public.org_memberships (org_id, user_id, roles)
    values (v_grant.scope_org_id, v_grant.user_id, v_roles)
    on conflict (org_id, user_id) do update set roles = excluded.roles;
  end if;
  return null;
end;
$$;

create trigger admin_role_grants_sync_membership
  after insert or delete or update of revoked_at on public.admin_role_grants
  for each row execute function kc_private.org_membership_sync();

-- ── Predicates ──────────────────────────────────────────────────────────────
-- Each returns the caller's organizations as an array, so a policy compares a column with
-- one value computed once per statement. Definer rights: they are evaluated inside
-- policies of tables the caller cannot read freely. An inactive account holds nothing.

create function kc_access.member_org_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.org_id), '{}')
    from public.org_memberships m
    join public.users u on u.id = m.user_id and u.is_active
   where m.user_id = (select auth.uid());
$$;
comment on function kc_access.member_org_ids() is 'Policy predicate: organizations the caller is a member of.';
grant execute on function kc_access.member_org_ids() to authenticated;

create function kc_access.managed_org_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.org_id), '{}')
    from public.org_memberships m
    join public.users u on u.id = m.user_id and u.is_active
   where m.user_id = (select auth.uid())
     and m.roles && array['org_admin', 'org_manager'];
$$;
comment on function kc_access.managed_org_ids() is
  'Policy predicate: organizations the caller administers (org_admin or org_manager).';
grant execute on function kc_access.managed_org_ids() to authenticated;

-- May the caller publish in the organization's name (`org.act_as`)? The organization must
-- be active.
create function kc_private.can_act_as_org(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.org_memberships m
      join public.users u on u.id = m.user_id and u.is_active
      join public.organizations o on o.id = m.org_id and o.status = 'active'
     where m.org_id = p_org_id and m.user_id = (select auth.uid())
       and (m.roles && array['org_admin', 'org_manager', 'org_employee', 'volunteer_manager']
            or (m.can_post and 'org_volunteer' = any (m.roles))));
$$;
comment on function kc_private.can_act_as_org(uuid) is
  'The caller may publish in the name of this active organization.';

-- ── Access ──────────────────────────────────────────────────────────────────
alter table public.org_memberships enable row level security;
alter table public.org_memberships force row level security;

-- A member reads their own memberships; the administrators of an organization and
-- platform staff read its roster. Other members never see who belongs to an organization.
create policy org_memberships_select_own on public.org_memberships
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy org_memberships_select_managers on public.org_memberships
  for select to authenticated
  using (org_id = any ((select kc_access.managed_org_ids())::uuid[]) or (select kc_access.is_admin()));
-- The administrators switch a volunteer's publishing right; the column grant allows nothing else.
create policy org_memberships_update_managers on public.org_memberships
  for update to authenticated
  using (org_id = any ((select kc_access.managed_org_ids())::uuid[]))
  with check (org_id = any ((select kc_access.managed_org_ids())::uuid[]));

grant select on public.org_memberships to authenticated;
grant update (can_post) on public.org_memberships to authenticated;

-- Organizations: members and platform staff also read a suspended organization; the
-- administrators and platform admins edit the profile texts (`org.profile.edit`).
create policy organizations_select_member_or_staff on public.organizations
  for select to authenticated
  using (id = any ((select kc_access.member_org_ids())::uuid[]) or (select kc_access.is_admin()));
create policy organizations_update_managers on public.organizations
  for update to authenticated
  using (id = any ((select kc_access.managed_org_ids())::uuid[]) or (select kc_access.has_admin_role('admin')))
  with check (id = any ((select kc_access.managed_org_ids())::uuid[]) or (select kc_access.has_admin_role('admin')));
