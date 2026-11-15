-- Migration: RBAC predicate functions for admin portal (A0).
-- Mapped to spec: FR-ADMIN-010 AC2.

create or replace function public.has_admin_role(uid uuid, role_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when uid is null or role_name is null then false
    else exists (
      select 1
      from public.admin_role_grants
      where user_id = uid
        and role = role_name
        and revoked_at is null
    )
  end;
$$;

comment on function public.has_admin_role(uuid, text) is
  'Returns true iff the user holds an active grant for the given role.';

create or replace function public.admin_assert_role(uid uuid, allowed text[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_match boolean;
begin
  if uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if allowed is null or array_length(allowed, 1) is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.admin_role_grants
    where user_id = uid
      and role = any (allowed)
      and revoked_at is null
  ) into v_match;

  if not v_match then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

comment on function public.admin_assert_role(uuid, text[]) is
  'Raises SQLSTATE 42501 unless the user holds an active grant for any of allowed roles.';

revoke execute on function public.has_admin_role(uuid, text) from public;
grant  execute on function public.has_admin_role(uuid, text) to anon, authenticated;

revoke execute on function public.admin_assert_role(uuid, text[]) from public;
grant  execute on function public.admin_assert_role(uuid, text[]) to authenticated;
