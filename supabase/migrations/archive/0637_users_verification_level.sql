-- 0637_users_verification_level | FR-VERIFY-001, FR-VERIFY-012 (D, PM 2026-11-07)
--
-- Verification level 0..3 per member:
--   1 = complete profile (display_name, city, date_of_birth, avatar, street + number, contact phone)
--   2 = ID verified (verified_at set via provider / manual)
--   3 = recognised organization (FR-ORG-019; no account type yet, so never returned today)
--
-- user_verification_level(uid) is the single source (FR-VERIFY-001 AC1). A BEFORE trigger
-- stores its result in users.verification_level so read paths get the number through the
-- existing public column grants without seeing the private fields behind it (AC4).

set search_path = public;

create or replace function public.verification_level_of(u public.users)
returns smallint
language sql
immutable
set search_path = public
as $$
  select case
    when u.verified_at is not null and u.verification_method in ('provider', 'manual') then 2
    when nullif(btrim(u.display_name), '') is not null
     and nullif(btrim(u.city), '') is not null
     and u.date_of_birth is not null
     and nullif(btrim(u.avatar_url), '') is not null
     and nullif(btrim(u.profile_street), '') is not null
     and nullif(btrim(u.profile_street_number), '') is not null
     and nullif(btrim(u.contact_phone), '') is not null then 1
    else 0
  end::smallint;
$$;

create or replace function public.user_verification_level(uid uuid)
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select public.verification_level_of(u) from public.users u where u.user_id = uid), 0::smallint);
$$;

revoke all on function public.verification_level_of(public.users) from public, anon, authenticated;
revoke all on function public.user_verification_level(uuid) from public;
grant execute on function public.user_verification_level(uuid) to anon, authenticated;

alter table public.users
  add column if not exists verification_level smallint not null default 0
  check (verification_level between 0 and 3);

comment on column public.users.verification_level is
  'Derived by trigger from verification_level_of(row); never written by clients. FR-VERIFY-001.';

create or replace function public.users_set_verification_level()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.verification_level := public.verification_level_of(new);
  return new;
end;
$$;

drop trigger if exists users_set_verification_level on public.users;
create trigger users_set_verification_level
  before insert or update on public.users
  for each row execute function public.users_set_verification_level();

update public.users u
set verification_level = public.verification_level_of(u)
where u.verification_level is distinct from public.verification_level_of(u);

grant select (verification_level) on table public.users to anon, authenticated;

-- Follow suggestions carry the badge level (FR-VERIFY-001 AC2). Return type changes,
-- so the 0285 function is dropped and recreated with the same body plus the column.
drop function if exists public.rpc_follow_suggestions(integer);

create function public.rpc_follow_suggestions(p_limit integer default 15)
returns table (
  user_id uuid,
  display_name text,
  share_handle text,
  avatar_url text,
  city_name text,
  followers_count integer,
  reason text,
  score double precision,
  verification_level smallint
)
language sql
stable
security invoker
set search_path = public
as $$
  with viewer as (
    select u.user_id, u.city
      from public.users u
     where u.user_id = (select auth.uid())
  ),
  candidates as (
    select
      u.user_id,
      u.display_name,
      u.share_handle,
      u.avatar_url,
      u.city_name,
      u.followers_count,
      u.verification_level,
      case
        when u.city = v.city then 'same_city'
        when exists (
          select 1 from public.follow_edges fe1
          join public.follow_edges fe2
            on fe2.follower_id = fe1.followed_id
           and fe2.followed_id = u.user_id
         where fe1.follower_id = v.user_id
        ) then 'mutual_follow'
        when exists (
          select 1
            from public.post_reactions pr1
            join public.post_reactions pr2 on pr2.post_id = pr1.post_id
           where pr1.user_id = v.user_id and pr2.user_id = u.user_id
           limit 1
        ) then 'co_engagement'
        else 'popular_nearby'
      end as reason,
      (
        case when u.city = v.city then 3.0 else 0.0 end
        + case when exists (
            select 1 from public.follow_edges fe1
            join public.follow_edges fe2
              on fe2.follower_id = fe1.followed_id
             and fe2.followed_id = u.user_id
           where fe1.follower_id = v.user_id
          ) then 4.0 else 0.0 end
        + ln(1 + u.followers_count::double precision)
      ) as score
    from public.users u
    cross join viewer v
    where u.account_status = 'active'
      and u.onboarding_state = 'completed'
      and u.privacy_mode = 'Public'
      and u.user_id <> v.user_id
      and not exists (
        select 1 from public.follow_edges fe
         where fe.follower_id = v.user_id and fe.followed_id = u.user_id
      )
      and not public.is_blocked(v.user_id, u.user_id)
  )
  select c.user_id, c.display_name, c.share_handle, c.avatar_url, c.city_name,
         c.followers_count, c.reason, c.score, c.verification_level
    from candidates c
   order by c.score desc, c.followers_count desc
   limit greatest(1, least(coalesce(p_limit, 15), 30));
$$;

revoke all on function public.rpc_follow_suggestions(integer) from public;
grant execute on function public.rpc_follow_suggestions(integer) to authenticated;
