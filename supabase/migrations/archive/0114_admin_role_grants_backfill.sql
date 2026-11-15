-- Migration: backfill admin_role_grants from users.is_super_admin and add
-- bidirectional sync trigger.
-- Mapped to spec: FR-ADMIN-010 AC3, AC4.

insert into public.admin_role_grants (user_id, role, granted_by, granted_at)
select u.user_id, 'super_admin', null, now()
from public.users u
where u.is_super_admin = true
on conflict do nothing;

create or replace function public._sync_users_is_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_active  boolean;
begin
  v_user_id := coalesce(new.user_id, old.user_id);
  if v_user_id is null then
    return null;
  end if;

  if (tg_op = 'INSERT'  and new.role <> 'super_admin')
  or (tg_op = 'DELETE'  and old.role <> 'super_admin')
  or (tg_op = 'UPDATE'  and old.role <> 'super_admin' and new.role <> 'super_admin') then
    return null;
  end if;

  select exists (
    select 1
    from public.admin_role_grants
    where user_id = v_user_id
      and role = 'super_admin'
      and revoked_at is null
  ) into v_active;

  update public.users
     set is_super_admin = v_active
   where user_id = v_user_id
     and is_super_admin is distinct from v_active;

  return null;
end;
$$;

drop trigger if exists admin_role_grants_sync_users on public.admin_role_grants;
create trigger admin_role_grants_sync_users
  after insert or update or delete on public.admin_role_grants
  for each row execute function public._sync_users_is_super_admin();

create or replace function public._sync_admin_role_grants_from_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_super_admin = true and (old.is_super_admin is distinct from true) then
    insert into public.admin_role_grants (user_id, role, granted_by, granted_at)
    values (new.user_id, 'super_admin', null, now())
    on conflict do nothing;
  elsif new.is_super_admin = false and old.is_super_admin = true then
    update public.admin_role_grants
       set revoked_at = now(), revoked_by = null
     where user_id = new.user_id
       and role = 'super_admin'
       and revoked_at is null;
  end if;
  return null;
end;
$$;

drop trigger if exists users_sync_admin_role_grants on public.users;
create trigger users_sync_admin_role_grants
  after update of is_super_admin on public.users
  for each row execute function public._sync_admin_role_grants_from_users();
