-- supabase/tests/0550_challenges.sql | 0550 (docs/spec/10_challenges.md, 05 §5.12, 07 §7.6):
-- the challenge engine. Covers opening and joining, one report per cycle, goal evaluation,
-- cadence-aware streaks that break on a skipped cycle, the late-report window, karma tiers and
-- caps, the participants-only leaderboard (no karma), leaving, ending and block filtering.

begin;

create temp table personas as
select kc_test.create_user('chal_creator') as creator,
       kc_test.create_user('chal_member') as member,
       kc_test.create_user('chal_outsider') as outsider;

create temp table ids (name text primary key, id uuid);

-- ── Access ───────────────────────────────────────────────────────────────────
do $$
begin
  perform kc_test.assert_true(
    not has_function_privilege('anon', 'public.list_challenges(text, int, int)', 'execute'),
    'anon cannot list challenges');
  perform kc_test.assert_true(
    has_function_privilege('authenticated', 'public.report_challenge_progress(uuid, numeric, text, date)', 'execute'),
    'a member can report progress');
  perform kc_test.assert_true(
    not has_function_privilege('authenticated', 'public.challenge_summary_rows(uuid)', 'execute'),
    'the internal summary function is not a client RPC');
  perform kc_test.assert_true(
    not has_function_privilege('authenticated', 'public.challenge_grant_karma_once(uuid, text, text, text, int)', 'execute'),
    'a member cannot grant themselves karma');
end $$;

-- ── Pure helpers ─────────────────────────────────────────────────────────────
do $$
begin
  -- 2026-11-04 is a Wednesday; the Israeli week opened on Sunday 2026-11-01.
  perform kc_test.assert_eq(public.challenge_cycle_start(date '2026-11-04', 'weekly'), date '2026-11-01',
    'a weekly report snaps to the Sunday of its week');
  perform kc_test.assert_eq(public.challenge_cycle_start(date '2026-11-01', 'weekly'), date '2026-11-01',
    'Sunday opens its own week');
  perform kc_test.assert_eq(public.challenge_cycle_start(date '2026-11-04', 'daily'), date '2026-11-04',
    'a daily report is its own cycle');
  perform kc_test.assert_true(public.challenge_goal_met('count', 10, 'at_least', 10), 'at least: boundary met');
  perform kc_test.assert_true(not public.challenge_goal_met('count', 10, 'at_least', 9.99), 'at least: below fails');
  perform kc_test.assert_true(public.challenge_goal_met('count', 5, 'at_most', 0), 'at most: zero is within the goal');
  perform kc_test.assert_true(not public.challenge_goal_met('count', 5, 'at_most', 6), 'at most: above fails');
  perform kc_test.assert_true(not public.challenge_goal_met('yes_no', null, null, 0), 'yes/no: a "no" is not a success');
  perform kc_test.assert_true(public.challenge_goal_met('duration_minutes', null, null, 0), 'no goal: any report counts');
  perform kc_test.assert_eq(public.challenge_karma_points('challenge_report', 'community', 49), 2, 'community report');
  perform kc_test.assert_eq(public.challenge_karma_points('challenge_report', 'community', 50), 3, 'large community report');
  perform kc_test.assert_eq(public.challenge_karma_points('challenge_completion', 'personal', 1), 10, 'private completion');
end $$;

-- ── Opening ──────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_id uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.creator);

  v_id := public.create_challenge(p_title => '10 pages a day', p_scope => 'community', p_measurement => 'count',
                                  p_cadence => 'daily', p_description => 'Read daily', p_goal_value => 10,
                                  p_goal_direction => 'at_least', p_difficulty => 'easy',
                                  p_topic_label => 'learning', p_target_cycles => 2);
  insert into ids values ('daily', v_id);

  perform kc_test.assert_eq((select participants_count from public.challenges where challenge_id = v_id), 1,
    'the creator is the first participant');
  perform kc_test.assert_eq((select coalesce(sum(points_delta), 0)::int from public.karma_ledger where user_id = p.creator and event_type like 'challenge\_%'), 3,
    'opening a community challenge earns 3 karma');

  perform kc_test.assert_raises(
    format('select public.create_challenge(%L, %L, %L, %L, p_goal_value => 5)',
           'Bad goal', 'community', 'count', 'daily'),
    'new row for relation "challenges" violates check constraint "challenges_goal_shape"',
    'a goal needs a direction');
  perform kc_test.assert_raises(
    format('select public.create_challenge(%L, %L, %L, %L, p_ends_at => now() - interval ''1 day'')',
           'Past end', 'community', 'yes_no', 'daily'),
    'ends_at_invalid', 'a challenge cannot end in the past');

  perform kc_test.act_as_anon();
  perform kc_test.assert_raises(
    format('select public.create_challenge(%L, %L, %L, %L)', 'Anon', 'community', 'yes_no', 'daily'),
    'auth_required', 'anonymous callers cannot open challenges');
end $$;

-- Karma for opening is capped at two a day. (Counts challenge events only: signup karma is not ours.)
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform kc_test.act_as(p.outsider);
  perform public.create_challenge('First', 'personal', 'yes_no', 'daily');
  perform public.create_challenge('Second', 'personal', 'yes_no', 'daily');
  perform public.create_challenge('Third', 'personal', 'yes_no', 'daily');
  perform kc_test.assert_eq((select coalesce(sum(points_delta), 0)::int from public.karma_ledger where user_id = p.outsider and event_type like 'challenge\_%'), 4,
    'only the first two challenges opened in a day earn karma (2 + 2)');
end $$;

-- ── Joining ──────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_daily uuid;
  v_personal uuid;
begin
  select * into p from personas;
  select id into v_daily from ids where name = 'daily';

  perform kc_test.act_as(p.member);
  perform public.join_challenge(v_daily);
  perform kc_test.assert_eq((select participants_count from public.challenges where challenge_id = v_daily), 2,
    'joining raises the participant count');
  perform kc_test.assert_raises(format('select public.join_challenge(%L)', v_daily),
    'already_joined', 'joining twice is rejected');

  select challenge_id into v_personal from public.challenges where title = 'First';
  perform kc_test.assert_raises(format('select public.join_challenge(%L)', v_personal),
    'challenge_not_found', 'a personal challenge cannot be joined');
  perform kc_test.assert_row_count(
    format('select 1 from public.get_challenge(%L)', v_personal), 0,
    'a personal challenge is invisible to others');
end $$;

-- ── Reporting: goal, one report per cycle, streak, karma, completion ─────────
do $$
declare
  p personas;
  v_daily uuid;
  v_result jsonb;
begin
  select * into p from personas;
  select id into v_daily from ids where name = 'daily';
  perform kc_test.act_as(p.member);

  v_result := public.report_challenge_progress(v_daily, 12, 'done');
  perform kc_test.assert_eq((v_result->>'goal_met')::boolean, true, '12 pages meets the goal of 10');
  perform kc_test.assert_eq((v_result->>'current_streak')::int, 1, 'first success starts a streak');
  perform kc_test.assert_eq((v_result->>'karma_points')::int, 2, 'a community report earns 2');

  v_result := public.report_challenge_progress(v_daily, 14, 'edited');
  perform kc_test.assert_eq((v_result->>'karma_points')::int, 0, 'editing a cycle''s report earns no second karma');
  perform kc_test.assert_eq(
    (select count(*)::int from public.challenge_progress_entries where challenge_id = v_daily and user_id = p.member),
    1, 'one report per cycle');

  v_result := public.report_challenge_progress(v_daily, 3);
  perform kc_test.assert_eq((v_result->>'goal_met')::boolean, false, 'overwriting with 3 pages misses the goal');
  perform kc_test.assert_eq((v_result->>'current_streak')::int, 0, 'a missed goal holds no streak');

  v_result := public.report_challenge_progress(v_daily, 12);
  v_result := public.report_challenge_progress(v_daily, 10, null, public.challenge_today() - 1);
  perform kc_test.assert_eq((v_result->>'current_streak')::int, 2, 'yesterday + today are a streak of 2');
  perform kc_test.assert_eq((v_result->>'completed')::boolean, true, 'two successful cycles reach the target of 2');
  -- Opening was 0 for the member; reports 2 + 2, completion 15 for a community challenge.
  perform kc_test.assert_eq((select coalesce(sum(points_delta), 0)::int from public.karma_ledger where user_id = p.member and event_type like 'challenge\_%'), 19,
    'two report cycles (2 + 2) and the completion bonus (15)');

  perform kc_test.assert_raises(
    format('select public.report_challenge_progress(%L, 5, null, %L)', v_daily, public.challenge_today() - 3),
    'report_date_out_of_window', 'a report older than the grace window is rejected');
  perform kc_test.assert_raises(
    format('select public.report_challenge_progress(%L, 5, null, %L)', v_daily, public.challenge_today() + 1),
    'report_date_out_of_window', 'a report for the future is rejected');

  perform kc_test.act_as(p.outsider);
  perform kc_test.assert_raises(format('select public.report_challenge_progress(%L, 5)', v_daily),
    'not_participant', 'only participants may report');
end $$;

-- ── Streaks break on a skipped cycle ─────────────────────────────────────────
do $$
declare
  p personas;
  v_daily uuid;
  v_result jsonb;
begin
  select * into p from personas;
  select id into v_daily from ids where name = 'daily';

  perform kc_test.act_as(p.creator);
  v_result := public.report_challenge_progress(v_daily, 11, null, public.challenge_today() - 2);
  perform kc_test.assert_eq((v_result->>'current_streak')::int, 0,
    'a success two days ago is no longer a live streak (yesterday was skipped)');
  perform kc_test.assert_eq((select best_streak from public.challenge_participations
                              where challenge_id = v_daily and user_id = p.creator), 1,
    'the best streak is remembered');
  v_result := public.report_challenge_progress(v_daily, 11);
  perform kc_test.assert_eq((v_result->>'current_streak')::int, 1,
    'after the gap the streak restarts at 1, not 2');
  perform kc_test.assert_eq((select my_current_streak from public.get_challenge(v_daily)), 1,
    'the summary shows the live streak');
end $$;

-- Weekly cadence counts weeks: three consecutive weeks are a streak of 3, a lone older week is not joined.
do $$
declare
  p personas;
  v_weekly uuid;
  v_week date;
  v_streaks record;
begin
  select * into p from personas;
  perform kc_test.act_as(p.creator);
  v_weekly := public.create_challenge('Weekly run', 'community', 'yes_no', 'weekly');
  v_week := public.challenge_cycle_start(public.challenge_today(), 'weekly');

  insert into public.challenge_progress_entries (challenge_id, user_id, cycle_start, value, goal_met)
  select v_weekly, p.creator, v_week - (7 * n), 1, true from unnest(array[0, 1, 2, 4]) as n;

  select * into v_streaks from public.challenge_compute_streaks(v_weekly, p.creator);
  perform kc_test.assert_eq(v_streaks.current_streak, 3, 'three consecutive weeks');
  perform kc_test.assert_eq(v_streaks.best_streak, 3, 'best run is the three weeks');
  perform kc_test.assert_eq(v_streaks.successful_cycles, 4, 'four successful weeks in all');

  perform public.report_challenge_progress(v_weekly, 1);
  perform kc_test.assert_eq(
    (select count(*)::int from public.challenge_progress_entries
      where challenge_id = v_weekly and user_id = p.creator and cycle_start = v_week),
    1, 'a second report in the same week overwrites the weekly cycle');
  perform kc_test.assert_raises(format('select public.report_challenge_progress(%L, 2)', v_weekly),
    'value_invalid', 'a yes/no report is 0 or 1');
end $$;

-- ── Leaderboard: participants only, no karma ─────────────────────────────────
do $$
declare
  p personas;
  v_daily uuid;
begin
  select * into p from personas;
  select id into v_daily from ids where name = 'daily';

  perform kc_test.act_as(p.member);
  perform kc_test.assert_row_count(format('select 1 from public.list_challenge_leaderboard(%L)', v_daily), 2,
    'a participant sees both participants');
  perform kc_test.assert_eq(
    (select display_name from public.list_challenge_leaderboard(v_daily) where is_me), 'Test chal_member',
    'the viewer is flagged');
  perform kc_test.assert_true(
    not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'challenge_participations'
                   and column_name like '%karma%'),
    'no karma is stored on a participation');

  perform kc_test.act_as(p.outsider);
  perform kc_test.assert_row_count(format('select 1 from public.list_challenge_leaderboard(%L)', v_daily), 0,
    'a non-participant sees no leaderboard');
end $$;

-- ── Lists and blocking ───────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_daily uuid;
begin
  select * into p from personas;
  select id into v_daily from ids where name = 'daily';

  perform kc_test.act_as(p.outsider);
  perform kc_test.assert_true(
    exists (select 1 from public.list_challenges('discover') where challenge_id = v_daily),
    'an open community challenge is discoverable');
  perform kc_test.assert_true(
    not exists (select 1 from public.list_challenges('discover') where scope = 'personal'),
    'personal challenges are never discoverable');
  perform kc_test.assert_row_count('select 1 from public.list_challenges(''created'')', 3, 'my created list');
  perform kc_test.assert_row_count('select 1 from public.list_challenges(''joined'')', 3, 'my joined list');
  perform kc_test.assert_raises('select * from public.list_challenges(''bogus'')', 'invalid_view', 'unknown view');

  insert into public.blocks (blocker_id, blocked_id) values (p.outsider, p.creator);
  perform kc_test.assert_true(
    not exists (select 1 from public.list_challenges('discover') where challenge_id = v_daily),
    'a blocked creator''s challenge disappears');
  perform kc_test.assert_raises(format('select public.join_challenge(%L)', v_daily),
    'challenge_not_found', 'a blocked pair cannot join');
  delete from public.blocks where blocker_id = p.outsider;
end $$;

-- ── Leaving and ending ───────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_daily uuid;
begin
  select * into p from personas;
  select id into v_daily from ids where name = 'daily';

  perform kc_test.act_as(p.creator);
  perform kc_test.assert_raises(format('select public.leave_challenge(%L)', v_daily),
    'creator_cannot_leave', 'the creator ends a challenge instead of leaving');

  perform kc_test.act_as(p.member);
  perform public.leave_challenge(v_daily);
  perform kc_test.assert_eq((select participants_count from public.challenges where challenge_id = v_daily), 1,
    'leaving lowers the participant count');
  perform kc_test.assert_eq(
    (select count(*)::int from public.challenge_progress_entries where challenge_id = v_daily and user_id = p.member),
    0, 'leaving withdraws the member''s reports');
  perform kc_test.assert_raises(format('select public.end_challenge(%L)', v_daily),
    'not_challenge_creator', 'only the creator ends a challenge');

  perform kc_test.act_as(p.creator);
  perform public.end_challenge(v_daily);
  perform kc_test.assert_raises(format('select public.report_challenge_progress(%L, 12)', v_daily),
    'challenge_not_active', 'an ended challenge takes no reports');
  perform kc_test.assert_true(
    not exists (select 1 from public.list_challenges('discover') where challenge_id = v_daily),
    'an ended challenge leaves the discover list');
end $$;

rollback;

\echo '✓ 0550_challenges.sql passed'
