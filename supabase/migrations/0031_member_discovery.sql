-- Social · discovery reads lost at the cut-over (map rows M03, M04, M05, M08)
--
--   rpc_follow_suggestions     members worth following (M03, KC#871)
--   rpc_profile_completeness   the caller's profile completeness nudge (M04)
--   search_organizations       organizations by name (M05)
--   search_hashtags            #tags used in the posts the caller can read (M05)
--   search_suggested_queries   the most used tags of the last 30 days (M05)
--   about_team_profiles        the About screen's team roster (M08, FR-ADMIN-026)
-- Every read returns public profile fields only. A suggestion never names a member the caller
-- follows, has a block with, or who keeps a private profile.

-- Suggestions: active members with a public profile whom the caller does not follow, ranked by
-- shared city, followers of the people the caller follows, and their own followers.
create function public.rpc_follow_suggestions(p_limit integer default 15)
returns table (
  user_id uuid, display_name text, share_handle text, avatar_url text, city_name text,
  followers_count integer, reason text, score double precision, verification_level smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select u.id, u.city_id from public.users u where u.id = kc_private.require_caller()),
  candidates as (
    select u.id, u.display_name, u.share_handle, u.avatar_url, c.name_he as city_name,
           coalesce(s.followers_count, 0) as followers_count, u.verification_level,
           u.city_id is not distinct from v.city_id and u.city_id is not null as same_city,
           exists (select 1 from public.follows f1
                     join public.follows f2 on f2.follower_id = f1.followed_id and f2.followed_id = u.id
                    where f1.follower_id = v.id) as mutual
      from viewer v
      join public.users u on u.id <> v.id and u.is_active and u.privacy_mode = 'Public'
      left join public.user_stats s on s.user_id = u.id
      left join public.cities c on c.city_id = u.city_id
     where not exists (select 1 from public.follows f where f.follower_id = v.id and f.followed_id = u.id)
       and not kc_access.is_blocked_between(v.id, u.id))
  select c.id, c.display_name, c.share_handle, c.avatar_url, c.city_name, c.followers_count,
         case when c.mutual then 'mutual_follow' when c.same_city then 'same_city' else 'popular_nearby' end,
         (case when c.same_city then 3.0 else 0.0 end + case when c.mutual then 4.0 else 0.0 end
          + ln(1 + c.followers_count::double precision))::double precision as score,
         c.verification_level
    from candidates c
   order by score desc, c.followers_count desc, c.id
   limit least(greatest(coalesce(p_limit, 15), 1), 30);
$$;
comment on function public.rpc_follow_suggestions(integer) is
  'Members with a public profile the caller may want to follow; never followed, blocked or private ones.';
grant execute on function public.rpc_follow_suggestions(integer) to authenticated;

-- Completeness of the caller's own profile: 100 points over the onboarding, a photo, a
-- biography of at least 20 characters, a city and at least one connection.
create function public.rpc_profile_completeness(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_user public.users;
  v_onboarded boolean;
  v_connections integer;
  v_score integer := 0;
  v_missing text[] := '{}';
begin
  if p_user_id is not null and p_user_id <> v_user_id then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select u.* into v_user from public.users u where u.id = v_user_id;
  select a.onboarding_state = 'completed' into v_onboarded from public.user_account a where a.user_id = v_user_id;
  select coalesce(s.followers_count + s.following_count, 0) into v_connections
    from public.user_stats s where s.user_id = v_user_id;

  if coalesce(v_onboarded, false) then v_score := v_score + 25; else v_missing := array_append(v_missing, 'onboarding'); end if;
  if nullif(btrim(v_user.avatar_url), '') is not null then v_score := v_score + 25; else v_missing := array_append(v_missing, 'avatar'); end if;
  if char_length(btrim(coalesce(v_user.biography, ''))) >= 20 then v_score := v_score + 20;
  else v_missing := array_append(v_missing, 'biography'); end if;
  if v_user.city_id is not null then v_score := v_score + 15; else v_missing := array_append(v_missing, 'city'); end if;
  if coalesce(v_connections, 0) > 0 then v_score := v_score + 15; else v_missing := array_append(v_missing, 'connections'); end if;

  return jsonb_build_object('score', v_score, 'missing', to_jsonb(v_missing),
    'verified', v_user.verification_level >= 1, 'showVerifiedBadge', v_user.verification_level >= 1);
end;
$$;
comment on function public.rpc_profile_completeness(uuid) is
  'Score (0-100) and missing parts of the caller''s own profile, for the completeness nudge.';
grant execute on function public.rpc_profile_completeness(uuid) to authenticated;

-- Active organizations whose name or slug contains the text.
create function public.search_organizations(p_query text, p_limit integer default 10)
returns table (org_id uuid, name text, slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.slug
    from public.organizations o
   where o.status = 'active' and not o.is_platform
     and char_length(btrim(coalesce(p_query, ''))) >= 2
     and (o.name ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or o.slug ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by o.is_verified_nonprofit desc, o.name, o.id
   limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;
comment on function public.search_organizations(text, integer) is 'Active organizations matching a name or slug fragment.';
grant execute on function public.search_organizations(text, integer) to authenticated;

-- #tags of the open posts the caller can read (row security on `posts` decides which), starting
-- with the text (without its #), most used first.
create function public.search_hashtags(p_query text, p_limit integer default 10)
returns table (tag text, use_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select lower(m[1]) as tag, count(distinct p.id)
    from public.posts p
    cross join lateral regexp_matches(p.title || ' ' || coalesce(p.description, ''), '#([[:alnum:]_]{2,40})', 'g') m
   where p.status = 'open'
     and lower(m[1]) like lower(ltrim(btrim(coalesce(p_query, '')), '#')) || '%'
   group by 1
   order by 2 desc, 1
   limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;
comment on function public.search_hashtags(text, integer) is '#tags of the open posts the caller can read, by prefix, most used first.';
grant execute on function public.search_hashtags(text, integer) to authenticated;

-- Suggested searches: the most used tags of posts the caller can read, published in 30 days.
create function public.search_suggested_queries(p_limit integer default 8)
returns setof text
language sql
stable
security invoker
set search_path = ''
as $$
  select '#' || t.tag
    from (select lower(m[1]) as tag, count(distinct p.id) as uses
            from public.posts p
            cross join lateral regexp_matches(p.title || ' ' || coalesce(p.description, ''), '#([[:alnum:]_]{2,40})', 'g') m
           where p.status = 'open' and p.published_at > now() - interval '30 days'
           group by 1) t
   order by t.uses desc, t.tag
   limit least(greatest(coalesce(p_limit, 8), 1), 20);
$$;
comment on function public.search_suggested_queries(integer) is 'Most used #tags of the last 30 days, as suggested searches.';
grant execute on function public.search_suggested_queries(integer) to authenticated;

-- The About screen's team: a curated roster keyed by the role the About copy describes. Written
-- by the service role only; the profile fields come from the linked member while they are active.
create table public.about_team_members (
  role_key   text primary key check (role_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  user_id    uuid not null references public.users (id) on delete cascade,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.about_team_members is 'Team roster of the About screen; written by the service role only.';
create index about_team_members_user_idx on public.about_team_members (user_id);
alter table public.about_team_members enable row level security;
alter table public.about_team_members force row level security;

create function public.about_team_profiles()
returns table (role_key text, sort_order integer, display_name text, avatar_url text, share_handle text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.role_key, m.sort_order, coalesce(u.display_name, u.share_handle), u.avatar_url, u.share_handle
    from public.about_team_members m
    join public.users u on u.id = m.user_id and u.is_active
   where m.is_active
   order by m.sort_order, m.role_key;
$$;
comment on function public.about_team_profiles() is 'The About screen''s team: role and public profile fields of each active member.';
grant execute on function public.about_team_profiles() to authenticated;
