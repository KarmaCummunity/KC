-- 0285_follow_suggestions_profile | KC#871 — suggestions + profile completeness.

create or replace function public.rpc_profile_completeness(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, (select auth.uid()));
  v_u record;
  v_score int := 0;
  v_missing text[] := '{}'::text[];
  v_verified boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if v_uid <> (select auth.uid()) and not coalesce(public.is_admin((select auth.uid())), false) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- Explicit columns: authenticated has column-scoped SELECT on users (0163).
  select u.user_id, u.onboarding_state, u.avatar_url, u.biography, u.city,
         u.followers_count, u.following_count, u.account_status
    into v_u
    from public.users u
   where u.user_id = v_uid;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;

  if v_u.onboarding_state = 'completed' then v_score := v_score + 25;
  else v_missing := array_append(v_missing, 'onboarding'); end if;

  if v_u.avatar_url is not null and length(trim(v_u.avatar_url)) > 0 then v_score := v_score + 25;
  else v_missing := array_append(v_missing, 'avatar'); end if;

  if v_u.biography is not null and length(trim(v_u.biography)) >= 20 then v_score := v_score + 20;
  else v_missing := array_append(v_missing, 'biography'); end if;

  if v_u.city is not null then v_score := v_score + 15;
  else v_missing := array_append(v_missing, 'city'); end if;

  if v_u.followers_count + v_u.following_count > 0 then v_score := v_score + 15;
  else v_missing := array_append(v_missing, 'connections'); end if;

  v_verified := v_u.account_status = 'active';

  return jsonb_build_object(
    'score', v_score,
    'missing', to_jsonb(v_missing),
    'verified', v_verified,
    'showVerifiedBadge', v_verified
  );
end;
$$;

grant execute on function public.rpc_profile_completeness(uuid) to authenticated;

create or replace function public.rpc_follow_suggestions(p_limit integer default 15)
returns table (
  user_id uuid,
  display_name text,
  share_handle text,
  avatar_url text,
  city_name text,
  followers_count integer,
  reason text,
  score double precision
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
         c.followers_count, c.reason, c.score
    from candidates c
   order by c.score desc, c.followers_count desc
   limit greatest(1, least(coalesce(p_limit, 15), 30));
$$;

grant execute on function public.rpc_follow_suggestions(integer) to authenticated;
