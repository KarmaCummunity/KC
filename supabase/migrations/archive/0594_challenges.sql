-- 0550_challenges | docs/spec/10_challenges.md, 05 §5.12 (D43, D46, D52, D100)
-- The challenge engine of the challenges giving world: a creator opens a personal or community
-- challenge, members join it and file one progress report per cycle (day or week); the server
-- counts streaks and awards karma. Ported from the legacy MVP-MONOREPO "community group
-- challenges" and tightened: the caller is always auth.uid() (never a client-sent user id),
-- streaks are cadence-aware and break when a cycle is skipped, and karma follows 07 §7.6.
--
-- Writes happen only through the RPCs below (no client write policies); reads are RPCs too, so
-- the tables' SELECT policies are a backstop.

begin;

-- ── 1. Tables ────────────────────────────────────────────────────────────────

create table public.challenges (
  challenge_id       uuid primary key default gen_random_uuid(),
  creator_id         uuid not null references public.users(user_id) on delete cascade,
  title              text not null check (char_length(btrim(title)) between 3 and 120),
  description        text check (description is null or char_length(description) <= 2000),
  scope              text not null check (scope in ('personal', 'community')),
  measurement        text not null check (measurement in ('yes_no', 'count', 'duration_minutes')),
  cadence            text not null check (cadence in ('daily', 'weekly', 'flexible')),
  goal_value         numeric(10, 2) check (goal_value is null or goal_value >= 0),
  goal_direction     text check (goal_direction in ('at_least', 'at_most')),
  difficulty         text check (difficulty in ('easy', 'medium', 'hard', 'expert')),
  topic_label        text check (topic_label is null or char_length(topic_label) <= 50),
  ends_at            timestamptz,
  target_cycles      int check (target_cycles is null or target_cycles between 1 and 366),
  status             text not null default 'active' check (status in ('active', 'ended')),
  participants_count int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- A yes/no challenge has no numeric goal; a numeric goal is a value together with a direction.
  constraint challenges_goal_shape check (
    (measurement = 'yes_no' and goal_value is null and goal_direction is null)
    or (measurement <> 'yes_no' and ((goal_value is null) = (goal_direction is null)))
  )
);

create table public.challenge_participations (
  participation_id  uuid primary key default gen_random_uuid(),
  challenge_id      uuid not null references public.challenges(challenge_id) on delete cascade,
  user_id           uuid not null references public.users(user_id) on delete cascade,
  joined_at         timestamptz not null default now(),
  -- Streak as of `last_success_cycle`; readers apply challenge_live_streak() for "today".
  current_streak    int not null default 0,
  best_streak       int not null default 0,
  successful_cycles int not null default 0,
  last_success_cycle date,
  completed_at      timestamptz,
  constraint challenge_participations_unique unique (challenge_id, user_id)
);

create table public.challenge_progress_entries (
  entry_id     uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(challenge_id) on delete cascade,
  user_id      uuid not null references public.users(user_id) on delete cascade,
  -- First day of the cycle the report belongs to: the day itself, or the week's Sunday.
  cycle_start  date not null,
  value        numeric(10, 2) not null check (value >= 0),
  note         text check (note is null or char_length(note) <= 500),
  goal_met     boolean not null,
  reported_at  timestamptz not null default now(),
  constraint challenge_progress_entries_one_per_cycle unique (challenge_id, user_id, cycle_start)
);

create index challenges_discover_idx
  on public.challenges (participants_count desc, created_at desc)
  where scope = 'community' and status = 'active';
create index challenges_creator_idx on public.challenges (creator_id, created_at desc);
create index challenge_participations_user_idx on public.challenge_participations (user_id, joined_at desc);
create index challenge_progress_entries_member_idx
  on public.challenge_progress_entries (challenge_id, user_id, cycle_start desc);

create trigger challenges_set_updated_at
  before update on public.challenges
  for each row execute function public.set_updated_at();

-- ── 2. Row level security (reads only; every write goes through an RPC) ─────

alter table public.challenges enable row level security;
alter table public.challenge_participations enable row level security;
alter table public.challenge_progress_entries enable row level security;

create policy challenges_read on public.challenges
  for select to authenticated
  using (scope = 'community' or creator_id = (select auth.uid()));

create policy challenge_participations_read_own on public.challenge_participations
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy challenge_progress_entries_read_own on public.challenge_progress_entries
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ── 3. Pure helpers (mirrored in @kc/domain challengeCycles.ts) ──────────────

-- The challenge "today" is the Israel calendar date, whatever the session time zone.
create or replace function public.challenge_today()
returns date
language sql
stable
set search_path = public
as $$ select (now() at time zone 'Asia/Jerusalem')::date $$;

-- Length of one cycle in days: weekly challenges count weeks, the others count days.
create or replace function public.challenge_cycle_step(p_cadence text)
returns int
language sql
immutable
as $$ select case when p_cadence = 'weekly' then 7 else 1 end $$;

-- First day of the cycle a date belongs to: itself, or the Sunday that opened its week.
create or replace function public.challenge_cycle_start(p_date date, p_cadence text)
returns date
language sql
immutable
as $$
  select case when p_cadence = 'weekly' then p_date - extract(dow from p_date)::int else p_date end
$$;

-- Whether one reported value is a success for its cycle.
create or replace function public.challenge_goal_met(
  p_measurement text, p_goal_value numeric, p_goal_direction text, p_value numeric
)
returns boolean
language sql
immutable
as $$
  select case
    when p_measurement = 'yes_no' then p_value >= 1
    when p_goal_value is null or p_goal_direction is null then true
    when p_goal_direction = 'at_least' then p_value >= p_goal_value
    else p_value <= p_goal_value
  end
$$;

-- The streak a member still holds today: the stored one while the last success is in the current
-- or the previous cycle, 0 once a full cycle was skipped. Flexible challenges keep no streak.
create or replace function public.challenge_live_streak(p_streak int, p_last_success date, p_cadence text)
returns int
language sql
stable
set search_path = public
as $$
  select case
    when p_cadence = 'flexible' or p_last_success is null then 0
    when p_last_success >= public.challenge_cycle_start(public.challenge_today(), p_cadence)
                           - public.challenge_cycle_step(p_cadence) then p_streak
    else 0
  end
$$;

-- Karma values of 07 §7.6 (open 2/3, report 1/2/3, completion 10/15/20 for private / community /
-- large community of 50+). The database is the only awarder; the client never computes karma.
create or replace function public.challenge_karma_points(p_event text, p_scope text, p_participants int)
returns int
language sql
immutable
as $$
  select case p_event
    when 'challenge_opened' then case when p_scope = 'personal' then 2 else 3 end
    when 'challenge_report' then case
      when p_scope = 'personal' then 1 when p_participants >= 50 then 3 else 2 end
    else case
      when p_scope = 'personal' then 10 when p_participants >= 50 then 20 else 15 end
  end
$$;

-- Grants one karma event unless the same (event, ref) already paid out; the caller holds the
-- participation row lock, so concurrent reports cannot double-pay. Returns the points granted.
create or replace function public.challenge_grant_karma_once(
  p_user uuid, p_event text, p_ref_type text, p_ref_id text, p_points int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.karma_ledger
     where user_id = p_user and event_type = p_event and ref_id = p_ref_id
  ) then
    return 0;
  end if;
  perform public.karma_apply(p_user, p_event, p_ref_type, p_ref_id, p_points);
  return p_points;
end;
$$;

-- Streaks of one member from the stored reports. Successful cycles are grouped into runs of
-- consecutive cycles (gaps-and-islands over the cycle index); the current streak is the run that
-- contains the latest success.
create or replace function public.challenge_compute_streaks(p_challenge_id uuid, p_user_id uuid)
returns table (current_streak int, best_streak int, successful_cycles int, last_success_cycle date)
language sql
stable
set search_path = public
as $$
  with ch as (
    select cadence, public.challenge_cycle_step(cadence) as step
      from public.challenges where challenge_id = p_challenge_id
  ),
  wins as (
    select e.cycle_start, ((e.cycle_start - date '2000-01-02') / ch.step) as idx
      from public.challenge_progress_entries e cross join ch
     where e.challenge_id = p_challenge_id and e.user_id = p_user_id and e.goal_met
  ),
  runs as (
    select count(*)::int as len, max(cycle_start) as last_cycle
      from (select cycle_start, idx - row_number() over (order by idx) as grp from wins) islands
     group by grp
  )
  select
    case when (select cadence from ch) = 'flexible' then 0
         else coalesce((select len from runs order by last_cycle desc limit 1), 0) end,
    case when (select cadence from ch) = 'flexible' then 0
         else coalesce((select max(len) from runs), 0) end,
    (select count(*)::int from wins),
    (select max(cycle_start) from wins)
$$;

-- ── 4. Participant count upkeep ──────────────────────────────────────────────

create or replace function public.trg_challenge_participants_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.challenges set participants_count = participants_count + 1
     where challenge_id = new.challenge_id;
  else
    update public.challenges set participants_count = greatest(0, participants_count - 1)
     where challenge_id = old.challenge_id;
  end if;
  return null;
end;
$$;

create trigger challenge_participations_count
  after insert or delete on public.challenge_participations
  for each row execute function public.trg_challenge_participants_count();

-- ── 5. Write RPCs ────────────────────────────────────────────────────────────

-- Opens a challenge and joins its creator. Karma: 2 private / 3 community, at most 2 a day.
create or replace function public.create_challenge(
  p_title text,
  p_scope text,
  p_measurement text,
  p_cadence text,
  p_description text default null,
  p_goal_value numeric default null,
  p_goal_direction text default null,
  p_difficulty text default null,
  p_topic_label text default null,
  p_ends_at timestamptz default null,
  p_target_cycles int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_opened_today int;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if p_ends_at is not null and p_ends_at <= now() then
    raise exception 'ends_at_invalid' using errcode = '22023';
  end if;
  perform public.enforce_rate_limit('challenge_create:' || v_uid::text, 10, 3600);

  insert into public.challenges (
    creator_id, title, description, scope, measurement, cadence, goal_value, goal_direction,
    difficulty, topic_label, ends_at, target_cycles
  ) values (
    v_uid, btrim(p_title), nullif(btrim(p_description), ''), p_scope, p_measurement, p_cadence,
    p_goal_value, p_goal_direction, p_difficulty, nullif(btrim(p_topic_label), ''), p_ends_at,
    p_target_cycles
  ) returning challenge_id into v_id;

  insert into public.challenge_participations (challenge_id, user_id) values (v_id, v_uid);

  select count(*) into v_opened_today
    from public.karma_ledger
   where user_id = v_uid and event_type = 'challenge_opened'
     and (created_at at time zone 'Asia/Jerusalem')::date = public.challenge_today();
  if v_opened_today < 2 then
    perform public.challenge_grant_karma_once(
      v_uid, 'challenge_opened', 'challenge', v_id::text,
      public.challenge_karma_points('challenge_opened', p_scope, 1));
  end if;

  return v_id;
end;
$$;

create or replace function public.join_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c public.challenges%rowtype;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into v_c from public.challenges where challenge_id = p_challenge_id;
  if not found
     or v_c.scope <> 'community'
     or public.is_blocked(v_uid, v_c.creator_id) then
    raise exception 'challenge_not_found' using errcode = 'P0002';
  end if;
  if v_c.status <> 'active' then raise exception 'challenge_not_active' using errcode = '23514'; end if;
  if v_c.ends_at is not null and v_c.ends_at <= now() then
    raise exception 'challenge_ended' using errcode = '23514';
  end if;
  begin
    insert into public.challenge_participations (challenge_id, user_id) values (p_challenge_id, v_uid);
  exception when unique_violation then
    raise exception 'already_joined' using errcode = '23505';
  end;
end;
$$;

-- Leaves a challenge and withdraws the member's own reports; the creator ends it instead.
create or replace function public.leave_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_creator uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select creator_id into v_creator from public.challenges where challenge_id = p_challenge_id;
  if not found then raise exception 'challenge_not_found' using errcode = 'P0002'; end if;
  if v_creator = v_uid then raise exception 'creator_cannot_leave' using errcode = '23514'; end if;
  delete from public.challenge_participations where challenge_id = p_challenge_id and user_id = v_uid;
  if not found then raise exception 'not_participant' using errcode = 'P0002'; end if;
  delete from public.challenge_progress_entries where challenge_id = p_challenge_id and user_id = v_uid;
end;
$$;

-- Creator only: stops further reports. Participants keep their history.
create or replace function public.end_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  update public.challenges set status = 'ended'
   where challenge_id = p_challenge_id and creator_id = v_uid;
  if not found then raise exception 'not_challenge_creator' using errcode = '42501'; end if;
end;
$$;

-- Files (or overwrites) the caller's report for the cycle of p_report_date (default: today, at
-- most 2 days back). Karma: 1 / 2 / 3 once per cycle, plus a completion bonus when the target
-- number of successful cycles is reached.
create or replace function public.report_challenge_progress(
  p_challenge_id uuid,
  p_value numeric,
  p_note text default null,
  p_report_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c public.challenges%rowtype;
  v_today date := public.challenge_today();
  v_date date;
  v_cycle date;
  v_met boolean;
  v_new boolean;
  v_part public.challenge_participations%rowtype;
  v_streaks record;
  v_karma int := 0;
  v_completed boolean;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;

  select * into v_c from public.challenges where challenge_id = p_challenge_id;
  if not found then raise exception 'challenge_not_found' using errcode = 'P0002'; end if;
  -- The participation row lock serializes this member's reports (no double karma).
  select * into v_part from public.challenge_participations
   where challenge_id = p_challenge_id and user_id = v_uid for update;
  if not found then raise exception 'not_participant' using errcode = 'P0002'; end if;
  if v_c.status <> 'active' then raise exception 'challenge_not_active' using errcode = '23514'; end if;
  if v_c.ends_at is not null and v_c.ends_at <= now() then
    raise exception 'challenge_ended' using errcode = '23514';
  end if;

  v_date := coalesce(p_report_date, v_today);
  if v_date > v_today or v_date < v_today - 2 then
    raise exception 'report_date_out_of_window' using errcode = '22023';
  end if;
  if p_value is null or p_value < 0 or p_value > 99999999.99
     or (v_c.measurement = 'yes_no' and p_value not in (0, 1)) then
    raise exception 'value_invalid' using errcode = '22023';
  end if;
  perform public.enforce_rate_limit('challenge_report:' || v_uid::text, 120, 3600);

  v_cycle := public.challenge_cycle_start(v_date, v_c.cadence);
  v_met := public.challenge_goal_met(v_c.measurement, v_c.goal_value, v_c.goal_direction, p_value);
  v_new := not exists (
    select 1 from public.challenge_progress_entries
     where challenge_id = p_challenge_id and user_id = v_uid and cycle_start = v_cycle);

  insert into public.challenge_progress_entries (challenge_id, user_id, cycle_start, value, note, goal_met)
  values (p_challenge_id, v_uid, v_cycle, p_value, nullif(btrim(p_note), ''), v_met)
  on conflict (challenge_id, user_id, cycle_start)
  do update set value = excluded.value, note = excluded.note, goal_met = excluded.goal_met,
                reported_at = now();

  select * into v_streaks from public.challenge_compute_streaks(p_challenge_id, v_uid);
  v_completed := v_part.completed_at is not null;
  if not v_completed and v_c.target_cycles is not null
     and v_streaks.successful_cycles >= v_c.target_cycles then
    v_completed := true;
    v_karma := v_karma + public.challenge_grant_karma_once(
      v_uid, 'challenge_completion', 'challenge', v_part.participation_id::text,
      public.challenge_karma_points('challenge_completion', v_c.scope, v_c.participants_count));
  end if;
  if v_new then
    v_karma := v_karma + public.challenge_grant_karma_once(
      v_uid, 'challenge_report', 'challenge', p_challenge_id::text || ':' || v_cycle::text,
      public.challenge_karma_points('challenge_report', v_c.scope, v_c.participants_count));
  end if;

  update public.challenge_participations
     set current_streak = v_streaks.current_streak,
         best_streak = greatest(best_streak, v_streaks.best_streak),
         successful_cycles = v_streaks.successful_cycles,
         last_success_cycle = v_streaks.last_success_cycle,
         completed_at = case when v_completed then coalesce(completed_at, now()) else null end
   where participation_id = v_part.participation_id;

  return jsonb_build_object(
    'cycle_start', v_cycle,
    'goal_met', v_met,
    'current_streak', public.challenge_live_streak(
      v_streaks.current_streak, v_streaks.last_success_cycle, v_c.cadence),
    'best_streak', greatest(v_part.best_streak, v_streaks.best_streak),
    'successful_cycles', v_streaks.successful_cycles,
    'completed', v_completed,
    'karma_points', v_karma
  );
end;
$$;

-- ── 6. Read RPCs ─────────────────────────────────────────────────────────────

-- One row per challenge visible to the caller, with the caller's own participation. Internal:
-- list_challenges and get_challenge select from it.
create or replace function public.challenge_summary_rows(p_viewer uuid)
returns table (
  challenge_id uuid, creator_id uuid, creator_display_name text, title text, description text,
  scope text, measurement text, cadence text, goal_value numeric, goal_direction text,
  difficulty text, topic_label text, ends_at timestamptz, target_cycles int, status text,
  participants_count int, created_at timestamptz, joined boolean, my_current_streak int,
  my_best_streak int, my_successful_cycles int, my_completed boolean, joined_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.challenge_id, c.creator_id, u.display_name, c.title, c.description, c.scope, c.measurement,
    c.cadence, c.goal_value, c.goal_direction, c.difficulty, c.topic_label, c.ends_at,
    c.target_cycles,
    -- A challenge past its end time reads as ended without waiting for a sweep.
    case when c.status = 'active' and c.ends_at is not null and c.ends_at <= now()
         then 'ended' else c.status end,
    c.participants_count, c.created_at,
    p.participation_id is not null,
    coalesce(public.challenge_live_streak(p.current_streak, p.last_success_cycle, c.cadence), 0),
    coalesce(p.best_streak, 0),
    coalesce(p.successful_cycles, 0),
    p.completed_at is not null,
    p.joined_at
  from public.challenges c
  join public.users u on u.user_id = c.creator_id
  left join public.challenge_participations p
    on p.challenge_id = c.challenge_id and p.user_id = p_viewer
  where (c.scope = 'community' or c.creator_id = p_viewer)
    and not public.is_blocked(p_viewer, c.creator_id)
$$;

revoke all on function public.challenge_summary_rows(uuid) from public, anon, authenticated;

-- p_view: 'discover' open community challenges, most popular first; 'joined' the caller's own
-- participations, newest first; 'created' the challenges the caller opened, newest first.
create or replace function public.list_challenges(
  p_view text default 'discover', p_limit int default 30, p_offset int default 0
)
returns table (
  challenge_id uuid, creator_id uuid, creator_display_name text, title text, description text,
  scope text, measurement text, cadence text, goal_value numeric, goal_direction text,
  difficulty text, topic_label text, ends_at timestamptz, target_cycles int, status text,
  participants_count int, created_at timestamptz, joined boolean, my_current_streak int,
  my_best_streak int, my_successful_cycles int, my_completed boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if p_view not in ('discover', 'joined', 'created') then
    raise exception 'invalid_view' using errcode = '22023';
  end if;

  return query
  select s.challenge_id, s.creator_id, s.creator_display_name, s.title, s.description, s.scope,
         s.measurement, s.cadence, s.goal_value, s.goal_direction, s.difficulty, s.topic_label,
         s.ends_at, s.target_cycles, s.status, s.participants_count, s.created_at, s.joined,
         s.my_current_streak, s.my_best_streak, s.my_successful_cycles, s.my_completed
    from public.challenge_summary_rows(v_uid) s
   where case p_view
           when 'discover' then s.scope = 'community' and s.status = 'active'
           when 'joined' then s.joined
           else s.creator_id = v_uid
         end
   order by
     case when p_view = 'discover' then s.participants_count end desc nulls last,
     case when p_view = 'joined' then s.joined_at end desc nulls last,
     s.created_at desc
   limit v_limit offset v_offset;
end;
$$;

create or replace function public.get_challenge(p_challenge_id uuid)
returns table (
  challenge_id uuid, creator_id uuid, creator_display_name text, title text, description text,
  scope text, measurement text, cadence text, goal_value numeric, goal_direction text,
  difficulty text, topic_label text, ends_at timestamptz, target_cycles int, status text,
  participants_count int, created_at timestamptz, joined boolean, my_current_streak int,
  my_best_streak int, my_successful_cycles int, my_completed boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  return query
  select s.challenge_id, s.creator_id, s.creator_display_name, s.title, s.description, s.scope,
         s.measurement, s.cadence, s.goal_value, s.goal_direction, s.difficulty, s.topic_label,
         s.ends_at, s.target_cycles, s.status, s.participants_count, s.created_at, s.joined,
         s.my_current_streak, s.my_best_streak, s.my_successful_cycles, s.my_completed
    from public.challenge_summary_rows(v_uid) s
   where s.challenge_id = p_challenge_id;
end;
$$;

-- The caller's own reports in one challenge, newest cycle first.
create or replace function public.list_my_challenge_entries(p_challenge_id uuid, p_limit int default 60)
returns table (cycle_start date, value numeric, note text, goal_met boolean, reported_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select e.cycle_start, e.value, e.note, e.goal_met, e.reported_at
    from public.challenge_progress_entries e
   where e.challenge_id = p_challenge_id and e.user_id = auth.uid()
   order by e.cycle_start desc
   limit least(greatest(coalesce(p_limit, 60), 1), 400)
$$;

-- Group standing for participants only. Shows streaks and cycles, never karma (10).
create or replace function public.list_challenge_leaderboard(p_challenge_id uuid, p_limit int default 20)
returns table (
  user_id uuid, display_name text, current_streak int, best_streak int,
  successful_cycles int, completed boolean, is_me boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.user_id,
    u.display_name,
    public.challenge_live_streak(p.current_streak, p.last_success_cycle, c.cadence),
    p.best_streak,
    p.successful_cycles,
    p.completed_at is not null,
    p.user_id = auth.uid()
  from public.challenges c
  join public.challenge_participations p on p.challenge_id = c.challenge_id
  join public.users u on u.user_id = p.user_id
  where c.challenge_id = p_challenge_id
    and exists (
      select 1 from public.challenge_participations me
       where me.challenge_id = c.challenge_id and me.user_id = auth.uid())
    and not public.is_blocked(auth.uid(), p.user_id)
  order by
    public.challenge_live_streak(p.current_streak, p.last_success_cycle, c.cadence) desc,
    p.successful_cycles desc,
    p.joined_at
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

-- ── 7. Grants (ADR-002: EXECUTE is explicit) ─────────────────────────────────

revoke all on function public.create_challenge(text, text, text, text, text, numeric, text, text, text, timestamptz, int) from public;
revoke all on function public.join_challenge(uuid) from public;
revoke all on function public.leave_challenge(uuid) from public;
revoke all on function public.end_challenge(uuid) from public;
revoke all on function public.report_challenge_progress(uuid, numeric, text, date) from public;
revoke all on function public.list_challenges(text, int, int) from public;
revoke all on function public.get_challenge(uuid) from public;
revoke all on function public.list_my_challenge_entries(uuid, int) from public;
revoke all on function public.list_challenge_leaderboard(uuid, int) from public;
-- Internal helpers run inside the SECURITY DEFINER RPCs above; no client may call them.
revoke all on function public.challenge_grant_karma_once(uuid, text, text, text, int) from public, anon, authenticated;
revoke all on function public.trg_challenge_participants_count() from public, anon, authenticated;

grant execute on function public.create_challenge(text, text, text, text, text, numeric, text, text, text, timestamptz, int) to authenticated;
grant execute on function public.join_challenge(uuid) to authenticated;
grant execute on function public.leave_challenge(uuid) to authenticated;
grant execute on function public.end_challenge(uuid) to authenticated;
grant execute on function public.report_challenge_progress(uuid, numeric, text, date) to authenticated;
grant execute on function public.list_challenges(text, int, int) to authenticated;
grant execute on function public.get_challenge(uuid) to authenticated;
grant execute on function public.list_my_challenge_entries(uuid, int) to authenticated;
grant execute on function public.list_challenge_leaderboard(uuid, int) to authenticated;

comment on table public.challenges is
  'Personal and community challenges (docs/spec/10_challenges.md). Writes only through RPCs.';
comment on column public.challenges.topic_label is
  'Free-text subject of the challenge (legacy "category"); not a post type or giving world.';
comment on column public.challenge_progress_entries.cycle_start is
  'First day of the reported cycle: the day itself (daily, flexible) or the Sunday of the week (weekly).';

commit;
