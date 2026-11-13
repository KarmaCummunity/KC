-- Challenges · tables (spec 10_challenges, D43, D46, D52, D100)
--
-- A challenge is a post of `post_type = 'challenge'` in the `challenges` giving world plus
-- the row here: opening one is "giving" in that world, joining is "taking". The post carries
-- what every post has (title, description, audience, feed, comments, reports, moderation);
-- this module adds the rules of the challenge, who takes part and their reports. Writes
-- happen only through the RPCs of this module.

-- Lifecycle, machine `challenge`: active ─► ended. Ending is final.
--   manager   whoever may manage the challenge's post (its owner; design §12.1)
--   admin     a moderator
insert into kc_private.fsm_state (machine_id, status) values
  ('challenge', 'active'),
  ('challenge', 'ended');
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('challenge', 'active', 'ended', 'manager'),
  ('challenge', 'active', 'ended', 'admin');

create table public.challenges (
  id                 uuid primary key default gen_random_uuid(),
  -- The challenge's post; removing the post removes the challenge.
  post_id            uuid not null unique references public.posts (id) on delete cascade,
  creator_id         uuid not null references public.users (id) on delete cascade,
  -- personal: only the creator sees and joins it; community: anyone may join. The
  -- invite-only `group` scope of the spec is not built.
  scope              text not null check (scope in ('personal', 'community')),
  measurement        text not null check (measurement in ('yes_no', 'count', 'duration_minutes')),
  -- weekly = Sunday-to-Saturday Israel week; flexible keeps no streak.
  cadence            text not null check (cadence in ('daily', 'weekly', 'flexible')),
  goal_value         numeric(10, 2) check (goal_value >= 0),
  goal_direction     text check (goal_direction in ('at_least', 'at_most')),
  difficulty         text check (difficulty in ('easy', 'medium', 'hard', 'expert')),
  -- Free-text subject of the challenge; not a giving world and not a post type.
  topic_label        text check (char_length(topic_label) between 1 and 50),
  -- Deadline; a challenge past it reads as ended and takes no more reports.
  ends_at            timestamptz,
  -- Successful cycles that complete the challenge for a participant.
  target_cycles      integer check (target_cycles between 1 and 366),
  -- Lifecycle, machine `challenge`. Never written by a device.
  status             text not null default 'active',
  participants_count integer not null default 0 check (participants_count >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- A yes/no challenge has no numeric goal; a numeric goal is a value with a direction.
  constraint challenges_goal_shape_chk check (
    (measurement = 'yes_no' and goal_value is null and goal_direction is null)
    or (measurement <> 'yes_no' and (goal_value is null) = (goal_direction is null)))
);
comment on table public.challenges is 'Rules and state of a challenge; its title and audience live on its post.';

-- Discover list: open community challenges, most joined first (keyset on the three columns).
create index challenges_discover_idx on public.challenges (participants_count desc, created_at desc, id desc)
  where scope = 'community' and status = 'active';
-- "Challenges I opened", newest first; covers the creator foreign key.
create index challenges_creator_recent_idx on public.challenges (creator_id, created_at desc, id desc);

create trigger challenges_status_fsm
  before insert or update of status on public.challenges
  for each row execute function kc_private.fsm_guard_status('challenge', 'status');
create trigger challenges_set_updated_at
  before update on public.challenges
  for each row execute function kc_private.set_updated_at();

create table public.challenge_participations (
  challenge_id       uuid not null references public.challenges (id) on delete cascade,
  user_id            uuid not null references public.users (id) on delete cascade,
  joined_at          timestamptz not null default now(),
  -- Streak as of `last_success_cycle`; readers apply challenge_live_streak() for today.
  current_streak     integer not null default 0 check (current_streak >= 0),
  best_streak        integer not null default 0 check (best_streak >= 0),
  successful_cycles  integer not null default 0 check (successful_cycles >= 0),
  last_success_cycle date,
  -- Set when the successful cycles reach the challenge's target.
  completed_at       timestamptz,
  primary key (challenge_id, user_id)
);
comment on table public.challenge_participations is 'Who takes part in a challenge, with their streak and progress.';

-- "Challenges I joined", newest first; covers the member foreign key.
create index challenge_participations_user_recent_idx
  on public.challenge_participations (user_id, joined_at desc, challenge_id desc);

create table public.challenge_progress_entries (
  challenge_id uuid not null,
  user_id      uuid not null,
  -- First day of the reported cycle: the day itself, or the Sunday that opened its week.
  cycle_start  date not null,
  value        numeric(10, 2) not null check (value >= 0),
  note         text check (char_length(note) between 1 and 500),
  goal_met     boolean not null,
  reported_at  timestamptz not null default now(),
  -- One report per participant per cycle; filing again overwrites it.
  primary key (challenge_id, user_id, cycle_start),
  -- Leaving a challenge withdraws the member's reports.
  constraint challenge_progress_entries_participation_fk foreign key (challenge_id, user_id)
    references public.challenge_participations (challenge_id, user_id) on delete cascade
);
comment on table public.challenge_progress_entries is 'One self-report per participant per cycle of a challenge.';

alter table public.challenges enable row level security;
alter table public.challenges force row level security;
alter table public.challenge_participations enable row level security;
alter table public.challenge_participations force row level security;
alter table public.challenge_progress_entries enable row level security;
alter table public.challenge_progress_entries force row level security;

-- A community challenge is readable exactly when its post is: the subquery runs under the
-- caller's own access to `posts` (audience, blocks, moderation). A creator always reads
-- their own. Participants of a challenge that left the feed read it through get_challenge.
create policy challenges_select_visible on public.challenges
  for select to authenticated
  using (creator_id = (select auth.uid())
         or exists (select 1 from public.posts p where p.id = challenges.post_id));
-- Progress is personal: a member reads their own participation and reports; standings of
-- others come from the leaderboard RPC only.
create policy challenge_participations_select_own on public.challenge_participations
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy challenge_progress_entries_select_own on public.challenge_progress_entries
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.challenges to authenticated;
grant select on public.challenge_participations to authenticated;
grant select on public.challenge_progress_entries to authenticated;

-- Keeps challenges.participants_count in step with the participation rows.
create function kc_private.challenge_participations_sync_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.challenges c
     set participants_count = greatest(c.participants_count + case tg_op when 'INSERT' then 1 else -1 end, 0)
   where c.id = case tg_op when 'INSERT' then new.challenge_id else old.challenge_id end;
  return null;
end;
$$;
comment on function kc_private.challenge_participations_sync_count() is
  'AFTER INSERT OR DELETE on challenge_participations: maintains the participant counter.';

create trigger challenge_participations_sync_count
  after insert or delete on public.challenge_participations
  for each row execute function kc_private.challenge_participations_sync_count();

-- A challenge post never exists without its challenge. Checked at commit, so the RPC can
-- write the two in either order; a bare insert of such a post from a device fails.
create function kc_private.posts_require_challenge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.posts p where p.id = new.id)
     and not exists (select 1 from public.challenges c where c.post_id = new.id) then
    raise exception 'post_details_required' using errcode = 'P0001';
  end if;
  return null;
end;
$$;
comment on function kc_private.posts_require_challenge() is
  'Deferred check: a challenge post has its challenge row when the transaction commits.';

create constraint trigger posts_require_challenge
  after insert on public.posts
  deferrable initially deferred
  for each row
  when (new.post_type = 'challenge')
  execute function kc_private.posts_require_challenge();
