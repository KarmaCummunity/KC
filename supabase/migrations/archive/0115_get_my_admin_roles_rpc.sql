-- Migration: get_my_admin_roles() — returns active roles of auth.uid().
-- Mapped to spec: FR-ADMIN-011 AC2.

create or replace function public.get_my_admin_roles()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_agg(role order by role) filter (where role is not null),
    array[]::text[]
  )
  from public.admin_role_grants
  where user_id = auth.uid()
    and revoked_at is null;
$$;

comment on function public.get_my_admin_roles() is
  'Returns active admin roles for the current session, or empty array.';

revoke execute on function public.get_my_admin_roles() from public;
grant  execute on function public.get_my_admin_roles() to authenticated;
