-- Moderation · admin roles (FR-ADMIN-006, FR-ADMIN-010, FR-ADMIN-027)
--
-- Who holds which staff role. A grant is a row; revoking stamps it, so the history stays.
-- Roles are ranked, platform roles (no organization) or organization roles (scoped to one),
-- and each grant may name the grant it reports to. Nothing here is writable from a device:
-- grants change through the RPCs of the next file, and the first super admin is created by
-- a direct database operation (FR-ADMIN-006 AC2).

-- The role vocabulary the app uses, with the three facts every rule derives from: seniority,
-- whether the role is platform-wide, and which roles its holder may hand out. A holder never
-- grants a role at or above their own rank (FR-ADMIN-027); `super_admin` is granted by nobody.
create table kc_private.admin_roles (
  role            text primary key,
  rank            smallint not null check (rank > 0),
  is_platform     boolean not null,
  grantable_roles text[] not null default '{}',
  unique (role, is_platform)
);
comment on table kc_private.admin_roles is 'Staff role vocabulary: rank, scope kind and the roles each one may grant.';
alter table kc_private.admin_roles enable row level security;
alter table kc_private.admin_roles force row level security;

insert into kc_private.admin_roles (role, rank, is_platform, grantable_roles) values
  ('super_admin', 100, true, array['admin', 'moderator', 'support', 'org_admin', 'org_manager',
     'operators_manager', 'volunteer_manager', 'org_employee', 'operator', 'org_volunteer']),
  ('admin', 90, true, array['moderator', 'support', 'org_admin', 'org_manager',
     'operators_manager', 'volunteer_manager', 'org_employee', 'operator', 'org_volunteer']),
  ('org_admin', 80, false, array['org_manager', 'operators_manager', 'volunteer_manager',
     'org_employee', 'operator', 'org_volunteer']),
  ('org_manager', 70, false, array['operators_manager', 'volunteer_manager', 'org_employee',
     'operator', 'org_volunteer']),
  ('moderator', 60, true, '{}'),
  ('operators_manager', 60, false, array['operator']),
  ('volunteer_manager', 60, false, array['org_volunteer']),
  ('support', 50, true, '{}'),
  ('org_employee', 40, false, '{}'),
  ('operator', 40, false, '{}'),
  ('org_volunteer', 30, false, '{}'),
  ('volunteer', 20, false, '{}');

create table public.admin_role_grants (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  role             text not null,
  -- Organization the role applies to; null for a platform role. The foreign key is added by
  -- the organizations module, which creates the referenced table.
  scope_org_id     uuid,
  -- Derived, so the composite foreign key below can hold a platform role to "no
  -- organization" and an organization role to "exactly one".
  is_platform      boolean generated always as (scope_org_id is null) stored,
  -- The grant this one reports to; null at the top of a tree.
  manager_grant_id uuid references public.admin_role_grants (id) on delete set null,
  granted_by       uuid references public.users (id) on delete set null,
  granted_at       timestamptz not null default now(),
  -- Set when the grant ends; an active grant has none.
  revoked_at       timestamptz,
  revoked_by       uuid references public.users (id) on delete set null,
  constraint admin_role_grants_role_scope_fk foreign key (role, is_platform)
    references kc_private.admin_roles (role, is_platform),
  constraint admin_role_grants_not_own_manager_chk check (manager_grant_id <> id)
);
comment on table public.admin_role_grants is 'Staff role grants with their reporting line. Written only by server code.';

-- A member holds a role once per scope while it is active.
create unique index admin_role_grants_active_key on public.admin_role_grants
  (user_id, role, coalesce(scope_org_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;
-- At most one active super admin (FR-ADMIN-006 AC2).
create unique index admin_role_grants_single_super_admin_key on public.admin_role_grants (role)
  where role = 'super_admin' and revoked_at is null;
-- "Who are the moderators" (staff notifications) and the role foreign key.
create index admin_role_grants_role_idx on public.admin_role_grants (role) where revoked_at is null;
-- Direct reports of a grant (re-parenting on revoke); covers the manager foreign key.
create index admin_role_grants_manager_idx on public.admin_role_grants (manager_grant_id)
  where manager_grant_id is not null;
-- Team roster of an organization.
create index admin_role_grants_scope_idx on public.admin_role_grants (scope_org_id)
  where scope_org_id is not null;
-- Foreign keys to the members who granted and revoked.
create index admin_role_grants_granted_by_idx on public.admin_role_grants (granted_by)
  where granted_by is not null;
create index admin_role_grants_revoked_by_idx on public.admin_role_grants (revoked_by)
  where revoked_by is not null;

-- True when the caller holds, as an active member, an active platform grant of the named
-- role or of a more senior platform role. An unknown or organization role is never held.
-- Definer rights: it is evaluated inside policies of tables the caller cannot read freely.
create function kc_access.has_admin_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.admin_role_grants g
      join kc_private.admin_roles r on r.role = g.role and r.is_platform
      join public.users u on u.id = g.user_id and u.is_active
     where g.user_id = (select auth.uid())
       and g.revoked_at is null
       and r.rank >= (select t.rank from kc_private.admin_roles t where t.role = p_role and t.is_platform));
$$;
comment on function kc_access.has_admin_role(text) is
  'Policy predicate: the caller holds this platform role or a more senior one.';
grant execute on function kc_access.has_admin_role(text) to authenticated;

-- True for any platform staff member (support and above).
create function kc_access.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select kc_access.has_admin_role('support');
$$;
comment on function kc_access.is_admin() is 'Policy predicate: the caller is platform staff.';
grant execute on function kc_access.is_admin() to authenticated;

-- The signed-in caller, who must hold the role (or a more senior one). Every privileged
-- RPC starts here; FR-ADMIN-006 AC3 fixes the error.
create function kc_private.require_admin_role(p_role text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
begin
  if not kc_access.has_admin_role(p_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;
comment on function kc_private.require_admin_role(text) is
  'Returns auth.uid(); raises forbidden (42501) unless the caller holds the platform role.';

alter table public.admin_role_grants enable row level security;
alter table public.admin_role_grants force row level security;

-- A member reads their own grants; platform staff read the whole roster.
create policy admin_role_grants_select_own on public.admin_role_grants
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy admin_role_grants_select_staff on public.admin_role_grants
  for select to authenticated
  using ((select kc_access.is_admin()));

grant select on public.admin_role_grants to authenticated;

-- The caller's active roles (FR-ADMIN-011 AC2); empty for an ordinary member. Runs with the
-- caller's rights: the rows are their own.
create function public.get_my_admin_roles()
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct g.role order by g.role), '{}')
    from public.admin_role_grants g
   where g.user_id = (select auth.uid()) and g.revoked_at is null;
$$;
comment on function public.get_my_admin_roles() is 'Active staff roles of the caller, or an empty array.';
grant execute on function public.get_my_admin_roles() to authenticated;

-- Every grant, revoke and change of reporting line is audited, whoever writes the row.
create function kc_private.audit_admin_role_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.audit_record(
    case
      when tg_op = 'INSERT' then 'admin_role_grant'
      when new.revoked_at is not null and old.revoked_at is null then 'admin_role_revoke'
      else 'admin_role_set_manager'
    end,
    'user', new.user_id,
    jsonb_build_object('grant_id', new.id, 'role', new.role, 'scope_org_id', new.scope_org_id,
                       'manager_grant_id', new.manager_grant_id));
  return null;
end;
$$;

create trigger admin_role_grants_audit_insert
  after insert on public.admin_role_grants
  for each row execute function kc_private.audit_admin_role_grant();
create trigger admin_role_grants_audit_update
  after update of revoked_at, manager_grant_id on public.admin_role_grants
  for each row
  when (old.revoked_at is distinct from new.revoked_at
        or old.manager_grant_id is distinct from new.manager_grant_id)
  execute function kc_private.audit_admin_role_grant();
