-- Challenges · write RPCs (spec 10_challenges "Behaviour")
--
-- Every action runs as the signed-in caller; no function takes a member id. Karma is never
-- computed here: each rewarded step records an `award` event on outbox topic `karma`
-- (72_karma/030), whose values and caps are configuration (spec 07 §7.6, D52).

-- Records the karma event of a challenge step for the caller's subject under the challenge.
create function kc_private.challenge_award(
  p_user_id uuid, p_event_type text, p_challenge public.challenges, p_subject_suffix text)
returns void
language sql
security definer
set search_path = ''
as $$
  select kc_private.outbox_enqueue('karma', jsonb_build_object(
    'kind', 'award', 'event_type', p_event_type, 'user_id', p_user_id,
    -- "Large" is 50 participants or more.
    'context', case when p_challenge.scope = 'personal' then 'personal'
                    when p_challenge.participants_count >= 50 then 'community_large'
                    else 'community' end,
    'subject', 'challenge:' || p_challenge.id || ':' || p_subject_suffix));
$$;
comment on function kc_private.challenge_award(uuid, text, public.challenges, text) is
  'Enqueues the karma award of a challenge step (opened, report, completed).';

-- Opens a challenge: its post in the challenges world (Public for a community challenge,
-- OnlyMe for a personal one), the challenge row, and the creator as first participant.
--   invalid_input                    title outside 3–80 characters, or a deadline in the past
--   city_required                    no city given and none on the caller's profile
--   challenge_world_not_configured   the catalog has no active post kind for challenges
-- plus what the post and the challenge tables refuse (post_limit_exceeded, SQLSTATE 23514).
create function public.create_challenge(
  p_title text, p_scope text, p_measurement text, p_cadence text,
  p_description text default null, p_goal_value numeric default null, p_goal_direction text default null,
  p_difficulty text default null, p_topic_label text default null, p_ends_at timestamptz default null,
  p_target_cycles integer default null, p_city_id text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_id constant uuid := gen_random_uuid();
  v_kind_id uuid;
  v_city_id text;
  v_post_id uuid;
  v_challenge public.challenges;
begin
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 80 or p_ends_at <= now() then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  select k.id into v_kind_id
    from public.post_kinds k
   where k.world_slug = 'challenges' and k.is_active and k.direction in ('offer', 'either')
   order by k.sort_order, k.id
   limit 1;
  if not found then
    raise exception 'challenge_world_not_configured' using errcode = 'P0001';
  end if;
  v_city_id := coalesce(p_city_id, (select u.city_id from public.users u where u.id = v_user_id));
  if v_city_id is null then
    raise exception 'city_required' using errcode = 'P0001';
  end if;

  -- The rules a card shows are copied into the post's details; they never change.
  insert into public.posts (
    owner_id, world_slug, kind_id, post_type, direction, status, visibility, title, description,
    details, city_id, location_display_level, expires_at)
  values (
    v_user_id, 'challenges', v_kind_id, 'challenge', 'offer', 'draft',
    case p_scope when 'personal' then 'OnlyMe' else 'Public' end,
    btrim(p_title), nullif(btrim(p_description), ''),
    jsonb_build_object('challenge_id', v_id, 'scope', p_scope, 'measurement', p_measurement,
                       'cadence', p_cadence),
    v_city_id, 'CityOnly', p_ends_at)
  returning id into v_post_id;

  insert into public.challenges (
    id, post_id, creator_id, scope, measurement, cadence, goal_value, goal_direction, difficulty,
    topic_label, ends_at, target_cycles)
  values (
    v_id, v_post_id, v_user_id, p_scope, p_measurement, p_cadence, p_goal_value, p_goal_direction,
    p_difficulty, nullif(btrim(p_topic_label), ''), p_ends_at, p_target_cycles)
  returning * into v_challenge;
  insert into public.challenge_participations (challenge_id, user_id) values (v_id, v_user_id);

  perform kc_private.post_move(v_post_id, 'open', 'owner');
  perform kc_private.challenge_award(v_user_id, 'challenge_opened', v_challenge, 'opened');
  return v_id;
end;
$$;
comment on function public.create_challenge(text, text, text, text, text, numeric, text, text, text, timestamptz, integer, text) is
  'Opens a personal or community challenge with its post and joins the caller to it.';
grant execute on function public.create_challenge(text, text, text, text, text, numeric, text, text, text, timestamptz, integer, text) to authenticated;

-- Joins a community challenge.
--   challenge_not_found    no such challenge, a personal one, or one the caller cannot see
--   challenge_not_active   ended, or past its deadline
--   already_joined
create function public.join_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_challenge public.challenges;
begin
  select c.* into v_challenge from public.challenges c where c.id = p_challenge_id;
  if not found or v_challenge.scope <> 'community'
     or not kc_private.challenge_visible_to(v_challenge, v_user_id) then
    raise exception 'challenge_not_found' using errcode = 'P0001';
  end if;
  if v_challenge.status <> 'active' or v_challenge.ends_at <= now() then
    raise exception 'challenge_not_active' using errcode = 'P0001';
  end if;
  insert into public.challenge_participations (challenge_id, user_id)
  values (p_challenge_id, v_user_id)
  on conflict do nothing;
  if not found then
    raise exception 'already_joined' using errcode = 'P0001';
  end if;
end;
$$;
comment on function public.join_challenge(uuid) is 'The caller joins a community challenge.';
grant execute on function public.join_challenge(uuid) to authenticated;

-- Leaves a challenge: the caller's reports go with the participation and the karma they
-- earned in it is reversed (S20). The creator ends the challenge instead.
--   challenge_not_found · creator_cannot_leave · not_participant
create function public.leave_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_creator_id uuid;
begin
  select c.creator_id into v_creator_id from public.challenges c where c.id = p_challenge_id;
  if not found then
    raise exception 'challenge_not_found' using errcode = 'P0001';
  end if;
  if v_creator_id = v_user_id then
    raise exception 'creator_cannot_leave' using errcode = 'P0001';
  end if;
  delete from public.challenge_participations cp
   where cp.challenge_id = p_challenge_id and cp.user_id = v_user_id;
  if not found then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;
  perform kc_private.outbox_enqueue('karma', jsonb_build_object(
    'kind', 'revoke', 'user_id', v_user_id, 'subject_prefix', 'challenge:' || p_challenge_id || ':'));
end;
$$;
comment on function public.leave_challenge(uuid) is 'The caller leaves a challenge; their reports and its karma are withdrawn.';
grant execute on function public.leave_challenge(uuid) to authenticated;

-- Ends a challenge: no more joins or reports; participants keep their history. Its post is
-- paused, so it leaves the feed. Allowed to whoever may manage the post. Repeating is a no-op.
--   challenge_not_found   no such challenge, or not the caller's to manage
create function public.end_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.challenges;
begin
  perform kc_private.require_active_caller();
  select c.* into v_challenge from public.challenges c where c.id = p_challenge_id for update;
  if not found or not kc_private.can_manage_post(v_challenge.post_id) then
    raise exception 'challenge_not_found' using errcode = 'P0001';
  end if;
  perform set_config('kc.fsm_role', 'manager', true);
  update public.challenges c set status = 'ended' where c.id = p_challenge_id;
  perform set_config('kc.fsm_role', '', true);
  if exists (select 1 from public.posts p where p.id = v_challenge.post_id and p.status = 'open') then
    perform kc_private.post_move(v_challenge.post_id, 'paused', 'owner');
  end if;
end;
$$;
comment on function public.end_challenge(uuid) is 'Ends a challenge and pauses its post.';
grant execute on function public.end_challenge(uuid) to authenticated;

-- Files, or overwrites, the caller's report for the cycle of p_report_date (default today;
-- at most two days back, never ahead). Recomputes the streak; the first report of a cycle
-- and reaching the target number of successful cycles are rewarded.
--   challenge_not_found · not_participant · challenge_not_active (ended, past its deadline,
--   or its post off the air) · report_date_out_of_window · invalid_input (value)
-- Returns { cycle_start, goal_met, current_streak, best_streak, successful_cycles, completed }.
create function public.report_challenge_progress(
  p_challenge_id uuid, p_value numeric, p_note text default null, p_report_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_today constant date := kc_private.challenge_today();
  v_date constant date := coalesce(p_report_date, v_today);
  v_challenge public.challenges;
  v_participation public.challenge_participations;
  v_cycle date;
  v_goal_met boolean;
  v_is_new boolean;
  v_streaks record;
  v_completed boolean;
begin
  select c.* into v_challenge from public.challenges c where c.id = p_challenge_id;
  if not found then
    raise exception 'challenge_not_found' using errcode = 'P0001';
  end if;
  -- The participation row lock serialises this member's reports.
  select cp.* into v_participation from public.challenge_participations cp
   where cp.challenge_id = p_challenge_id and cp.user_id = v_user_id for update;
  if not found then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;
  if v_challenge.status <> 'active' or v_challenge.ends_at <= now()
     or not exists (select 1 from public.posts p where p.id = v_challenge.post_id and p.status = 'open') then
    raise exception 'challenge_not_active' using errcode = 'P0001';
  end if;
  if v_date > v_today or v_date < v_today - 2 then
    raise exception 'report_date_out_of_window' using errcode = 'P0001';
  end if;
  if p_value is null or p_value < 0 or p_value > 99999999.99
     or (v_challenge.measurement = 'yes_no' and p_value not in (0, 1)) then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  v_cycle := kc_private.challenge_cycle_start(v_date, v_challenge.cadence);
  v_goal_met := kc_private.challenge_goal_met(v_challenge, p_value);
  insert into public.challenge_progress_entries as e (challenge_id, user_id, cycle_start, value, note, goal_met)
  values (p_challenge_id, v_user_id, v_cycle, p_value, nullif(btrim(p_note), ''), v_goal_met)
  on conflict (challenge_id, user_id, cycle_start) do update
    set value = excluded.value, note = excluded.note, goal_met = excluded.goal_met, reported_at = now()
  returning (e.xmax = 0) into v_is_new;

  select s.* into v_streaks from kc_private.challenge_compute_streaks(v_challenge, v_user_id) s;
  v_completed := v_challenge.target_cycles is not null
    and v_streaks.successful_cycles >= v_challenge.target_cycles;
  update public.challenge_participations cp
     set current_streak = v_streaks.current_streak,
         best_streak = greatest(cp.best_streak, v_streaks.best_streak),
         successful_cycles = v_streaks.successful_cycles,
         last_success_cycle = v_streaks.last_success_cycle,
         completed_at = case when v_completed then coalesce(cp.completed_at, now()) end
   where cp.challenge_id = p_challenge_id and cp.user_id = v_user_id;

  if v_is_new then
    perform kc_private.challenge_award(v_user_id, 'challenge_report', v_challenge, 'report:' || v_cycle);
  end if;
  if v_completed and v_participation.completed_at is null then
    -- Paid once even when a corrected report completes the challenge a second time: the
    -- karma consumer skips a subject that already holds points.
    perform kc_private.challenge_award(v_user_id, 'challenge_completed', v_challenge, 'completed');
  end if;

  return jsonb_build_object(
    'cycle_start', v_cycle, 'goal_met', v_goal_met,
    'current_streak', kc_private.challenge_live_streak(
      v_streaks.current_streak, v_streaks.last_success_cycle, v_challenge.cadence),
    'best_streak', greatest(v_participation.best_streak, v_streaks.best_streak),
    'successful_cycles', v_streaks.successful_cycles, 'completed', v_completed);
end;
$$;
comment on function public.report_challenge_progress(uuid, numeric, text, date) is
  'Files the caller''s report for a cycle of a challenge and returns their updated progress.';
grant execute on function public.report_challenge_progress(uuid, numeric, text, date) to authenticated;
