-- 0088_profile_closed_posts_list_mode.sql
-- FR-PROFILE-001 AC4: owner main Closed tab excludes posts.visibility = OnlyMe;
-- Hidden screen uses p_list_mode = 'owner_only_me'.

set search_path = public;

drop function if exists public.profile_closed_posts(uuid, uuid, int, timestamptz);

create or replace function public.profile_closed_posts(
  p_profile_user_id uuid,
  p_viewer_user_id  uuid,
  p_limit           int          default 30,
  p_cursor          timestamptz  default null,
  p_list_mode       text         default 'standard'
)
returns table (
  post_id        uuid,
  identity_role  text,
  closed_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_list_mode not in ('standard', 'owner_only_me') then
    raise exception 'invalid_list_mode' using errcode = '22023';
  end if;

  if p_list_mode = 'owner_only_me'
     and p_viewer_user_id is distinct from p_profile_user_id
  then
    return;
  end if;

  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and p_viewer_user_id is not null
     and p_viewer_user_id is distinct from auth.uid()
  then
    raise exception 'forbidden_viewer_mismatch' using errcode = '42501';
  end if;

  return query
  with safe_limit as (
    select greatest(1, least(coalesce(p_limit, 30), 100))::int as n
  ),
  unioned as (
    select
      p.post_id,
      'publisher'::text                    as identity_role,
      p.owner_id                           as role_actor_id,
      coalesce(r.marked_at, p.updated_at)  as closed_at
    from public.posts p
    left join public.recipients r on r.post_id = p.post_id
    where p.owner_id = p_profile_user_id
      and p.status in ('closed_delivered', 'deleted_no_recipient')

    union all

    select
      p.post_id,
      'respondent'::text   as identity_role,
      r.recipient_user_id  as role_actor_id,
      r.marked_at          as closed_at
    from public.posts p
    join public.recipients r on r.post_id = p.post_id
    where r.recipient_user_id = p_profile_user_id
      and p.status = 'closed_delivered'
      and p.owner_id <> p_profile_user_id
  )
  select u.post_id, u.identity_role, u.closed_at
  from unioned u
  join public.posts p on p.post_id = u.post_id
  left join public.recipients r2 on r2.post_id = p.post_id
  where
    not public.is_blocked(p_viewer_user_id, p.owner_id)
    and not exists (
      select 1 from public.reporter_hides h
      where h.reporter_id = p_viewer_user_id
        and h.target_type = 'post'
        and h.target_id   = p.post_id
    )
    and (
      case
        when p_list_mode = 'owner_only_me' then
          p.visibility = 'OnlyMe'
        else
          not (
            p_viewer_user_id is not distinct from p_profile_user_id
            and p.visibility = 'OnlyMe'
          )
      end
    )
    and (
      case
        when p.status = 'deleted_no_recipient' then
          p.owner_id = p_viewer_user_id
        when p.status = 'closed_delivered' then
          p.owner_id            = p_viewer_user_id
          or r2.recipient_user_id = p_viewer_user_id
          or public.participant_closed_surface_visible(p, u.role_actor_id, p_viewer_user_id)
        else false
      end
    )
    and (p_cursor is null or u.closed_at < p_cursor)
  order by u.closed_at desc
  limit (select n from safe_limit);
end;
$$;

grant execute on function public.profile_closed_posts(uuid, uuid, int, timestamptz, text)
  to authenticated, anon;
