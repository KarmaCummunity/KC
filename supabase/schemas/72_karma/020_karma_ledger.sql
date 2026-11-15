-- Karma · ledger (FR-KARMA-001, spec 07 §7.6)
--
-- Every point a member holds is a row here: the ledger is append-only and
-- `user_stats.karma_points` is its running sum, never below zero. A row names what the
-- points are for (`subject`) and the event that wrote it (`reference`); the pair is unique
-- per member, so performing the same event twice writes nothing. Undoing an award (a handoff
-- taken back, a challenge left) appends a negative row for the same subject (S20).

create table public.karma_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.users (id) on delete cascade,
  -- The rewarded event (a karma_values.event_type), or `reversal`.
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  points     integer not null check (points <> 0),
  -- What the points are for, e.g. `handoff:<id>:giver`, `challenge:<id>:report:2026-11-08`.
  subject    text not null check (char_length(subject) between 1 and 200),
  -- The event that wrote the row, e.g. `event:<outbox id>`.
  reference  text not null check (char_length(reference) between 1 and 100),
  created_at timestamptz not null default now(),
  -- Idempotency of the consumer, and the lookup of what a subject currently holds.
  constraint karma_ledger_once_key unique (user_id, subject, reference)
);
comment on table public.karma_ledger is
  'Append-only karma entries; user_stats.karma_points is their sum. Written only by server code.';

-- "My karma history" newest first (keyset on created_at, id) and the daily-cap count of an
-- event type; covers the member foreign key.
create index karma_ledger_user_recent_idx on public.karma_ledger (user_id, created_at desc, id desc);

-- No update at all; a delete only as part of removing the member (the cascade runs after
-- the profile row is gone, a direct delete does not).
create function kc_private.karma_ledger_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.users u where u.id = old.user_id) then
    return old;
  end if;
  raise exception 'append_only' using errcode = 'P0001', detail = 'karma_ledger';
end;
$$;

create trigger karma_ledger_append_only
  before update or delete on public.karma_ledger
  for each row execute function kc_private.karma_ledger_append_only();

alter table public.karma_ledger enable row level security;
alter table public.karma_ledger force row level security;

-- Karma is private: a member reads only their own entries (FR-KARMA-008, D29).
create policy karma_ledger_select_own on public.karma_ledger
  for select to authenticated
  using (user_id = (select auth.uid()));
-- The main admin sees everyone's karma (D29).
create policy karma_ledger_select_super_admin on public.karma_ledger
  for select to authenticated
  using ((select kc_access.has_admin_role('super_admin')));

grant select on public.karma_ledger to authenticated;

-- The karma total is its owner's alone (FR-KARMA-008 AC1): the identity module's column
-- grant on user_stats let every member read it on any visible profile. It is withdrawn here
-- and the owner reads the total through my_karma_points().
revoke select (karma_points) on public.user_stats from authenticated;

create function public.my_karma_points()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select s.karma_points from public.user_stats s where s.user_id = (select auth.uid());
$$;
comment on function public.my_karma_points() is 'The caller''s karma total (FR-KARMA-007).';
grant execute on function public.my_karma_points() to authenticated;

-- Appends one entry and moves the member's total. The counter row is the per-member lock.
-- A penalty never takes the total below zero: the entry records what was actually taken.
-- Returns the points applied; 0 when the same subject and reference were already written,
-- or when the member no longer exists.
create function kc_private.karma_apply(
  p_user_id uuid, p_event_type text, p_points integer, p_subject text, p_reference text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_points integer;
begin
  select s.karma_points into v_total from public.user_stats s where s.user_id = p_user_id for update;
  if not found then
    return 0;
  end if;
  v_points := greatest(p_points, -v_total);
  if v_points = 0 then
    return 0;
  end if;

  insert into public.karma_ledger (user_id, event_type, points, subject, reference)
  values (p_user_id, p_event_type, v_points, p_subject, p_reference)
  on conflict on constraint karma_ledger_once_key do nothing;
  if not found then
    return 0;
  end if;
  update public.user_stats s set karma_points = s.karma_points + v_points where s.user_id = p_user_id;
  return v_points;
end;
$$;
comment on function kc_private.karma_apply(uuid, text, integer, text, text) is
  'Appends a karma entry once per (member, subject, reference) and updates the member''s total.';

-- Awards an event at its configured value. Nothing is paid when the event has no value, the
-- subject already holds points, or the member reached the event's daily cap.
--   p_quantity   what the emitter measured, by unit: { "night": 3 } — the value's own unit
--                picks the number, capped at max_units; a value of unit `once` ignores it
create function kc_private.karma_award(
  p_user_id uuid, p_event_type text, p_context text, p_subject text, p_reference text,
  p_quantity jsonb default '{}'::jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value constant kc_private.karma_values := kc_private.karma_value(p_event_type, p_context);
  v_units integer := 1;
  -- Start of the current Israel calendar day.
  v_day_start constant timestamptz :=
    date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem';
begin
  if v_value.points is null or p_user_id is null then
    return 0;
  end if;
  if v_value.unit <> 'once' then
    v_units := least(coalesce((p_quantity ->> v_value.unit)::integer, 0), v_value.max_units);
    if v_units < 1 then
      return 0;
    end if;
  end if;

  -- Serialises the checks below with every other award of this member.
  perform 1 from public.user_stats s where s.user_id = p_user_id for update;
  if (select coalesce(sum(l.points), 0) from public.karma_ledger l
       where l.user_id = p_user_id and l.subject = p_subject) > 0 then
    return 0;
  end if;
  if v_value.daily_cap is not null
     and (select count(*) from public.karma_ledger l
           where l.user_id = p_user_id and l.created_at >= v_day_start
             and l.event_type = p_event_type and l.points > 0) >= v_value.daily_cap then
    return 0;
  end if;
  return kc_private.karma_apply(p_user_id, p_event_type, v_value.points * v_units, p_subject, p_reference);
end;
$$;
comment on function kc_private.karma_award(uuid, text, text, text, text, jsonb) is
  'Awards a karma event at its configured value, once per subject and within the daily cap.';

-- Takes back whatever the member still holds for every subject starting with the prefix
-- (S20: undo reverses the points). Returns the points taken, as a negative number.
create function kc_private.karma_revoke(p_user_id uuid, p_subject_prefix text, p_reference text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_held record;
  v_taken integer := 0;
begin
  perform 1 from public.user_stats s where s.user_id = p_user_id for update;
  for v_held in
    select l.subject, sum(l.points)::integer as points
      from public.karma_ledger l
     where l.user_id = p_user_id and starts_with(l.subject, p_subject_prefix)
     group by l.subject
    having sum(l.points) > 0
  loop
    v_taken := v_taken + kc_private.karma_apply(
      p_user_id, 'reversal', -v_held.points, v_held.subject, p_reference);
  end loop;
  return v_taken;
end;
$$;
comment on function kc_private.karma_revoke(uuid, text, text) is
  'Reverses the points a member holds for the subjects under a prefix.';
