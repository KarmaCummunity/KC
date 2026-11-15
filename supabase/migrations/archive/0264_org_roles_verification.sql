-- 0264_org_roles_verification | Issue #848
-- org_memberships, user/org verification, volunteer role, has_world_permission().

begin;

alter table public.admin_role_grants
  drop constraint if exists admin_role_grants_role_check;

alter table public.admin_role_grants
  add constraint admin_role_grants_role_check check (role in (
    'super_admin', 'moderator', 'support',
    'operator', 'operators_manager',
    'org_admin', 'org_manager', 'org_employee',
    'volunteer', 'volunteer_manager', 'org_volunteer'
  ));

alter table public.users
  add column if not exists verified_at timestamptz,
  add column if not exists verification_method text
    check (verification_method is null or verification_method in (
      'manual','document','provider','org_vouch'
    ));

alter table public.organizations
  add column if not exists verified_at timestamptz,
  add column if not exists verification_method text,
  add column if not exists is_verified_nonprofit boolean not null default false;

comment on column public.organizations.is_verified_nonprofit is
  'PRD V2 §7.1.1 blue-check: verified Israeli nonprofit eligible for sec. 46 receipts.';

create table public.org_memberships (
  membership_id uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(org_id) on delete cascade,
  user_id       uuid not null references public.users(user_id) on delete cascade,
  role          text not null check (role in (
    'org_admin','org_manager','org_employee','org_volunteer','volunteer'
  )),
  created_at    timestamptz not null default now(),
  constraint org_memberships_unique unique (org_id, user_id, role)
);

create index org_memberships_user_idx on public.org_memberships (user_id);

alter table public.org_memberships enable row level security;

create policy org_memberships_select on public.org_memberships
  for select to authenticated using (true);

create policy org_memberships_self_insert on public.org_memberships
  for insert to authenticated with check (user_id = auth.uid());

create or replace function public.has_world_permission(
  p_user uuid,
  p_world_slug text,
  p_action text default 'publish'
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_world public.worlds;
begin
  if p_user is null or p_world_slug is null then
    return false;
  end if;

  select * into v_world from public.worlds w where w.slug = p_world_slug and w.is_active;
  if not found then
    return false;
  end if;

  if public.is_listing_operator(p_user) or public.has_admin_role(p_user, 'super_admin') then
    return true;
  end if;

  if v_world.requires_verification then
    if not exists (
      select 1 from public.users u where u.user_id = p_user and u.verified_at is not null
    ) then
      return false;
    end if;
  end if;

  if p_world_slug = 'money' and p_action in ('receive_public', 'campaign') then
    return exists (
      select 1 from public.org_memberships m
      join public.organizations o on o.org_id = m.org_id
       where m.user_id = p_user
         and m.role in ('org_admin','org_manager','org_employee')
         and o.is_verified_nonprofit
    );
  end if;

  return true;
end;
$$;

create or replace function public.listings_require_world_permission()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.origin <> 'native' then
    return new;
  end if;
  if not public.has_world_permission(new.owner_id, new.world_slug, 'publish') then
    raise exception 'world_permission_denied' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists listings_require_world_permission on public.listings;
create trigger listings_require_world_permission
  before insert on public.listings
  for each row execute function public.listings_require_world_permission();

grant execute on function public.has_world_permission(uuid, text, text) to authenticated, service_role;

commit;
