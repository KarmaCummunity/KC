-- 0235_about_team_partners | About team roster: founder and technology partner
-- FR-SETTINGS About.
-- Expose user_id on about_team_profiles for profile deep-links; seed the founder
-- and the technology partner. Email linkage stays in seed SQL only.
-- user_id is appended (not inserted mid-list) so CREATE OR REPLACE VIEW stays compatible.

create or replace view public.about_team_profiles as
select
  m.role_key,
  m.sort_order,
  u.display_name,
  u.avatar_url,
  u.share_handle,
  m.user_id
from public.about_team_members m
inner join public.users u on u.user_id = m.user_id
where m.is_active = true
  and u.account_status = 'active'
order by m.sort_order asc, m.role_key asc;

grant select on public.about_team_profiles to anon, authenticated;

-- Deactivate any prior active roster rows outside the two partner roles
-- (e.g. a previous founder → navesarussi@gmail.com kept under another key).
update public.about_team_members
set is_active = false
where is_active = true
  and role_key not in ('founder', 'tech_partner');

-- Founder & CEO — michal.foux97@gmail.com
insert into public.about_team_members (role_key, user_id, sort_order, is_active)
select 'founder', u.user_id, 0, true
from public.users u
inner join auth.users au on au.id = u.user_id
where lower(au.email) = lower('michal.foux97@gmail.com')
on conflict (role_key) do update
  set user_id = excluded.user_id,
      sort_order = excluded.sort_order,
      is_active = true;

-- Technology partner — karmacommunity2.0@gmail.com
insert into public.about_team_members (role_key, user_id, sort_order, is_active)
select 'tech_partner', u.user_id, 1, true
from public.users u
inner join auth.users au on au.id = u.user_id
where lower(au.email) = lower('karmacommunity2.0@gmail.com')
on conflict (role_key) do update
  set user_id = excluded.user_id,
      sort_order = excluded.sort_order,
      is_active = true;
