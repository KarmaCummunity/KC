-- Challenges · read RPCs
--
-- One row shape for every challenge screen: the challenge, its title from its post, and the
-- caller's own progress. These run with definer rights because a participant keeps reading
-- a challenge after its post left the feed (ended = paused post), which the post's own
-- policy cannot express; each function applies kc_private.challenge_visible_to itself.
-- A member's own reports are read from challenge_progress_entries directly, under RLS.

create type public.challenge_summary as (
  id                   uuid,
  post_id              uuid,
  creator_id           uuid,
  creator_display_name text,
  title                text,
  description          text,
  scope                text,
  measurement          text,
  cadence              text,
  goal_value           numeric,
  goal_direction       text,
  difficulty           text,
  topic_label          text,
  ends_at              timestamptz,
  target_cycles        integer,
  -- `ended` also once the deadline passed, without waiting for anyone to end it.
  status               text,
  participants_count   integer,
  created_at           timestamptz,
  joined               boolean,
  my_current_streak    integer,
  my_best_streak       integer,
  my_successful_cycles integer,
  my_completed         boolean
);
comment on type public.challenge_summary is 'A challenge with the caller''s own progress, as every challenge screen shows it.';

-- The summary of one challenge for a viewer. Visibility is the caller's business.
create function kc_private.challenge_summary_of(p_challenge public.challenges, p_viewer_id uuid)
returns public.challenge_summary
language sql
stable
security definer
set search_path = ''
as $$
  select row(
    p_challenge.id, p_challenge.post_id, p_challenge.creator_id, u.display_name, p.title, p.description,
    p_challenge.scope, p_challenge.measurement, p_challenge.cadence, p_challenge.goal_value,
    p_challenge.goal_direction, p_challenge.difficulty, p_challenge.topic_label, p_challenge.ends_at,
    p_challenge.target_cycles,
    case when p_challenge.ends_at <= now() then 'ended' else p_challenge.status end,
    p_challenge.participants_count, p_challenge.created_at,
    cp.user_id is not null,
    coalesce(kc_private.challenge_live_streak(cp.current_streak, cp.last_success_cycle, p_challenge.cadence), 0),
    coalesce(cp.best_streak, 0), coalesce(cp.successful_cycles, 0),
    cp.completed_at is not null)::public.challenge_summary
    from public.posts p
    join public.users u on u.id = p_challenge.creator_id
    left join public.challenge_participations cp
      on cp.challenge_id = p_challenge.id and cp.user_id = p_viewer_id
   where p.id = p_challenge.post_id;
$$;
comment on function kc_private.challenge_summary_of(public.challenges, uuid) is
  'Builds the summary row of a challenge for a viewer.';

-- One challenge, or no row when it does not exist or the caller may not see it.
create function public.get_challenge(p_challenge_id uuid)
returns setof public.challenge_summary
language sql
stable
security definer
set search_path = ''
as $$
  select (kc_private.challenge_summary_of(c, kc_private.require_caller())).*
    from public.challenges c
   where c.id = p_challenge_id
     and kc_private.challenge_visible_to(c, kc_private.require_caller());
$$;
comment on function public.get_challenge(uuid) is 'A challenge with the caller''s progress, when the caller may see it.';
grant execute on function public.get_challenge(uuid) to authenticated;

-- One keyset page of challenges. Pass the last row's next_cursor to continue.
--   discover   open community challenges, most joined first (challenges_discover_idx)
--   joined     the caller's participations, newest first
--   created    the challenges the caller opened, newest first
create function public.list_challenges(
  p_view text default 'discover', p_cursor jsonb default null, p_limit integer default 20)
returns table (challenge public.challenge_summary, next_cursor jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_limit constant integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_t constant timestamptz := (p_cursor ->> 't')::timestamptz;
  v_id constant uuid := (p_cursor ->> 'id')::uuid;
begin
  if p_view = 'discover' then
    return query
    select kc_private.challenge_summary_of(c, v_user_id),
           jsonb_build_object('n', c.participants_count, 't', c.created_at, 'id', c.id)
      from public.challenges c
     where c.scope = 'community' and c.status = 'active' and (c.ends_at is null or c.ends_at > now())
       and kc_private.challenge_visible_to(c, v_user_id)
       and exists (select 1 from public.posts p where p.id = c.post_id and p.status = 'open')
       and (p_cursor is null
            or (c.participants_count, c.created_at, c.id) < ((p_cursor ->> 'n')::integer, v_t, v_id))
     order by c.participants_count desc, c.created_at desc, c.id desc
     limit v_limit;
  elsif p_view = 'joined' then
    return query
    select kc_private.challenge_summary_of(c, v_user_id),
           jsonb_build_object('t', cp.joined_at, 'id', c.id)
      from public.challenge_participations cp
      join public.challenges c on c.id = cp.challenge_id
     where cp.user_id = v_user_id
       and kc_private.challenge_visible_to(c, v_user_id)
       and (p_cursor is null or (cp.joined_at, cp.challenge_id) < (v_t, v_id))
     order by cp.joined_at desc, cp.challenge_id desc
     limit v_limit;
  elsif p_view = 'created' then
    return query
    select kc_private.challenge_summary_of(c, v_user_id),
           jsonb_build_object('t', c.created_at, 'id', c.id)
      from public.challenges c
     where c.creator_id = v_user_id
       and (p_cursor is null or (c.created_at, c.id) < (v_t, v_id))
     order by c.created_at desc, c.id desc
     limit v_limit;
  else
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
end;
$$;
comment on function public.list_challenges(text, jsonb, integer) is
  'One keyset page of challenges to discover, joined by the caller, or opened by the caller.';
grant execute on function public.list_challenges(text, jsonb, integer) to authenticated;

-- Standing of a challenge, for its participants only: streaks and successful cycles, never
-- karma (spec 10). Members in a blocked pair with the caller, and members whose account is
-- not active, are left out. Bounded: the top p_limit (at most 100).
create function public.list_challenge_leaderboard(p_challenge_id uuid, p_limit integer default 20)
returns table (
  user_id uuid, display_name text, avatar_url text, current_streak integer, best_streak integer,
  successful_cycles integer, completed boolean, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select cp.user_id, u.display_name, u.avatar_url,
         kc_private.challenge_live_streak(cp.current_streak, cp.last_success_cycle, c.cadence),
         cp.best_streak, cp.successful_cycles, cp.completed_at is not null,
         cp.user_id = (select auth.uid())
    from public.challenges c
    join public.challenge_participations cp on cp.challenge_id = c.id
    join public.users u on u.id = cp.user_id and u.is_active
   where c.id = p_challenge_id
     and exists (select 1 from public.challenge_participations me
                  where me.challenge_id = c.id and me.user_id = (select auth.uid()))
     and not kc_access.is_blocked_between((select auth.uid()), cp.user_id)
   order by 4 desc, cp.successful_cycles desc, cp.joined_at, cp.user_id
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;
comment on function public.list_challenge_leaderboard(uuid, integer) is
  'Top participants of a challenge by streak, visible to its participants only.';
grant execute on function public.list_challenge_leaderboard(uuid, integer) to authenticated;
