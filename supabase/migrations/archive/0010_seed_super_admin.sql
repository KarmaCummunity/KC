-- 0010_seed_super_admin | P0.5 — auto-promote canonical super-admin email
-- FR-CHAT-007 AC1.
--
-- We cannot insert into public.users directly without a corresponding
-- auth.users row (FK). Instead, this trigger sets is_super_admin=true
-- whenever the public.users insert corresponds to the canonical email.
-- Plus a backfill for the case where the super admin already signed up.

create or replace function public.users_auto_promote_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if exists (
    select 1 from auth.users au
    where au.id = new.user_id
      and au.email = 'karmacommunity2.0@gmail.com'
  ) then
    new.is_super_admin := true;
  end if;
  return new;
end;
$$;

drop trigger if exists users_before_insert_super_admin_flag on public.users;
create trigger users_before_insert_super_admin_flag
  before insert on public.users
  for each row execute function public.users_auto_promote_super_admin();

-- Idempotent backfill.
update public.users u
set is_super_admin = true
from auth.users au
where au.id = u.user_id
  and au.email = 'karmacommunity2.0@gmail.com'
  and u.is_super_admin = false;
