-- Challenges · cycles, goals and streaks (mirrored by challengeCycles.ts in @kc/domain)
--
-- A report belongs to a cycle: a day, or a Sunday-to-Saturday week. All dates are Israel
-- calendar dates decided by the server, whatever the device or session time zone says.

-- Today in Israel.
create function kc_private.challenge_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Jerusalem')::date;
$$;
comment on function kc_private.challenge_today() is 'The current Israel calendar date.';

-- First day of the cycle a date belongs to: itself, or the Sunday that opened its week.
create function kc_private.challenge_cycle_start(p_date date, p_cadence text)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_cadence when 'weekly' then p_date - extract(dow from p_date)::integer else p_date end;
$$;
comment on function kc_private.challenge_cycle_start(date, text) is
  'First day of the cycle of a date: the day, or the Sunday of its week for a weekly challenge.';

-- Whether one reported value is a success for its cycle. Yes/no: 1 = done. A numeric
-- challenge without a goal succeeds by being reported.
create function kc_private.challenge_goal_met(p_challenge public.challenges, p_value numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_challenge.measurement = 'yes_no' then p_value >= 1
    when p_challenge.goal_value is null then true
    when p_challenge.goal_direction = 'at_least' then p_value >= p_challenge.goal_value
    else p_value <= p_challenge.goal_value
  end;
$$;
comment on function kc_private.challenge_goal_met(public.challenges, numeric) is
  'A reported value meets the goal of the challenge.';

-- The streak a member still holds today: the stored one while the last success is in the
-- current or the previous cycle, zero once a full cycle was skipped. Flexible challenges
-- keep no streak.
create function kc_private.challenge_live_streak(p_streak integer, p_last_success date, p_cadence text)
returns integer
language sql
stable
set search_path = ''
as $$
  select case
    when p_cadence = 'flexible' or p_last_success is null then 0
    when p_last_success >= kc_private.challenge_cycle_start(kc_private.challenge_today(), p_cadence)
                           - case p_cadence when 'weekly' then 7 else 1 end then p_streak
    else 0
  end;
$$;
comment on function kc_private.challenge_live_streak(integer, date, text) is
  'The streak as it stands today: the stored streak, or zero after a skipped cycle.';

-- Streaks of one participant from their stored reports. Successful cycles are grouped into
-- runs of consecutive cycles (gaps and islands over the cycle index, counted from a
-- Sunday); the current streak is the run that holds the latest success.
create function kc_private.challenge_compute_streaks(p_challenge public.challenges, p_user_id uuid)
returns table (current_streak integer, best_streak integer, successful_cycles integer, last_success_cycle date)
language sql
stable
security definer
set search_path = ''
as $$
  with wins as (
    select e.cycle_start,
           (e.cycle_start - date '2000-01-02') / case p_challenge.cadence when 'weekly' then 7 else 1 end as idx
      from public.challenge_progress_entries e
     where e.challenge_id = p_challenge.id and e.user_id = p_user_id and e.goal_met
  ),
  runs as (
    select count(*)::integer as len, max(i.cycle_start) as last_cycle
      from (select w.cycle_start, w.idx - row_number() over (order by w.idx) as grp from wins w) i
     group by i.grp
  )
  select case p_challenge.cadence when 'flexible' then 0
           else coalesce((select r.len from runs r order by r.last_cycle desc limit 1), 0) end,
         case p_challenge.cadence when 'flexible' then 0
           else coalesce((select max(r.len) from runs r), 0) end,
         (select count(*)::integer from wins),
         (select max(w.cycle_start) from wins w);
$$;
comment on function kc_private.challenge_compute_streaks(public.challenges, uuid) is
  'Current and best streak, successful cycles and last success of a participant, from their reports.';

-- May the member see the challenge? Its creator always; anyone else only while the creator
-- is an active member not in a blocked pair with them, and then a participant always and
-- everyone else while the challenge is a community one whose post is on the air.
create function kc_private.challenge_visible_to(p_challenge public.challenges, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_challenge.creator_id = p_user_id
      or (exists (select 1 from public.users u where u.id = p_challenge.creator_id and u.is_active)
          and not kc_access.is_blocked_between(p_user_id, p_challenge.creator_id)
          and (exists (select 1 from public.challenge_participations cp
                        where cp.challenge_id = p_challenge.id and cp.user_id = p_user_id)
               or (p_challenge.scope = 'community'
                   and exists (select 1 from public.posts p
                                where p.id = p_challenge.post_id and p.status = 'open'))));
$$;
comment on function kc_private.challenge_visible_to(public.challenges, uuid) is
  'Visibility of a challenge to a member inside the definer RPCs of this module.';
