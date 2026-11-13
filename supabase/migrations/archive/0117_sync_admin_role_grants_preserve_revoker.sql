-- Migration: preserve revoker identity in the users→admin_role_grants sync trigger.
-- Mapped to spec: FR-ADMIN-010.

create or replace function public._sync_admin_role_grants_from_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_super_admin = true and (old.is_super_admin is distinct from true) then
    insert into public.admin_role_grants (user_id, role, granted_by, granted_at)
    values (new.user_id, 'super_admin', auth.uid(), now())
    on conflict do nothing;
  elsif new.is_super_admin = false and old.is_super_admin = true then
    update public.admin_role_grants
       set revoked_at = now(),
           revoked_by = auth.uid()
     where user_id = new.user_id
       and role = 'super_admin'
       and revoked_at is null;
  end if;
  return null;
end;
$$;
