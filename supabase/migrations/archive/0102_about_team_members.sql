-- 0102_about_team_members | About landing — team roster linked to user profiles
-- FR-SETTINGS About (team section). Email→user linkage lives in seed SQL only (not client).

create table if not exists public.about_team_members (
  role_key   text primary key,
  user_id    uuid not null references public.users(user_id) on delete cascade,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists about_team_members_user_id_idx on public.about_team_members (user_id);
create index if not exists about_team_members_active_sort_idx
  on public.about_team_members (is_active, sort_order);

alter table public.about_team_members enable row level security;
-- No client write policies — roster is managed via migrations / service role.

create or replace view public.about_team_profiles as
select
  m.role_key,
  m.sort_order,
  u.display_name,
  u.avatar_url,
  u.share_handle
from public.about_team_members m
inner join public.users u on u.user_id = m.user_id
where m.is_active = true
  and u.account_status = 'active'
order by m.sort_order asc, m.role_key asc;

grant select on public.about_team_profiles to anon, authenticated;

-- Seed founder (idempotent). Skips silently until the account exists.
insert into public.about_team_members (role_key, user_id, sort_order)
select 'founder', u.user_id, 0
from public.users u
inner join auth.users au on au.id = u.user_id
where lower(au.email) = lower('navesarussi@gmail.com')
on conflict (role_key) do update
  set user_id = excluded.user_id,
      sort_order = excluded.sort_order,
      is_active = true;
