-- Migration: admin_role_grants — extensible RBAC for admin portal (A0).
-- Mapped to spec: docs/SSOT/spec/12_super_admin.md FR-ADMIN-010.
-- Closes TD-95: enforces single-active-super_admin invariant at the DB level.

create table public.admin_role_grants (
  grant_id    uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(user_id) on delete cascade,
  role        text not null
                check (role in (
                  -- Platform-level (in use as of A0):
                  'super_admin', 'moderator', 'support',
                  -- PRD V2 reserved (no rows yet; future migrations add UI/RPCs):
                  'operator', 'operators_manager',
                  'org_admin', 'org_manager', 'org_employee',
                  'volunteer_manager', 'org_volunteer'
                )),
  granted_by  uuid references public.users(user_id) on delete set null,
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references public.users(user_id) on delete set null
);

comment on table public.admin_role_grants is
  'RBAC for admin/operational roles. revoked_at IS NULL ⇔ active. Role enum is intentionally wide for PRD V2 forward-compat.';

create unique index admin_role_grants_active_user_role_uniq
  on public.admin_role_grants (user_id, role)
  where revoked_at is null;

-- TD-95: at most one active super_admin in the entire system.
create unique index admin_role_grants_single_super_admin_uniq
  on public.admin_role_grants (role)
  where role = 'super_admin' and revoked_at is null;

create index admin_role_grants_user_active_idx
  on public.admin_role_grants (user_id)
  where revoked_at is null;
create index admin_role_grants_role_active_idx
  on public.admin_role_grants (role)
  where revoked_at is null;

alter table public.admin_role_grants enable row level security;

create policy admin_role_grants_self_read
  on public.admin_role_grants for select
  using (user_id = auth.uid());

create policy admin_role_grants_super_admin_read_all
  on public.admin_role_grants for select
  using (public.is_admin(auth.uid()));

revoke insert, update, delete on public.admin_role_grants from anon, authenticated;
grant select on public.admin_role_grants to authenticated;
