-- Worlds · post_series (a recurring event, FR-POST-024, issue #2086)
--
-- Regular volunteering and a recurring organization event are published once as a series:
-- a schedule plus the template of its events. The scheduler publishes one ordinary event
-- post per matching day, 30 days ahead, so registration, the waiting list, attendance,
-- reminders and expiry treat a date like any other event (a volunteering shift is an event,
-- 70_worlds/120). The series RPCs are in 0022_post_series_rpcs.sql.
--
-- Differences from a recurring ride (ride_series, D103), both PM decisions of 2026-11-11:
--   * a series has its own time zone, and a clock change never loses or doubles a date;
--   * a date the owner cancels is remembered, so the scheduler never publishes it again.

insert into kc_private.fsm_state (machine_id, status) values
  ('post_series', 'active'), ('post_series', 'paused'), ('post_series', 'ended');

-- Ending is terminal: an ended series is never resumed (publish a new one).
insert into kc_private.fsm_edge (machine_id, from_status, to_status) values
  ('post_series', 'active', 'paused'),
  ('post_series', 'paused', 'active'),
  ('post_series', 'active', 'ended'),
  ('post_series', 'paused', 'ended');

create table public.post_series (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.users (id) on delete cascade,
  -- The organization every date is published for (D31); null = the owner's own
  -- volunteering. Dates are published only while the owner may act for it.
  beneficiary_org_id uuid references public.organizations (id) on delete set null,
  -- The two payloads of public.create_post_with_details for one date, without its times:
  -- the post (kind, title, city, audience) and the event (capacity, policy, address).
  -- Checked by publishing the first date when the series is created.
  post_template    jsonb not null check (jsonb_typeof(post_template) = 'object'),
  event_template   jsonb not null check (jsonb_typeof(event_template) = 'object'),
  -- Start of every date, as local time in `time_zone`.
  start_time       time not null,
  -- Length of every date.
  duration_minutes integer not null check (duration_minutes between 15 and 1440),
  -- Days the event runs, as a bit set: bit 0 = Sunday … bit 6 = Saturday.
  weekdays         smallint not null check (weekdays between 1 and 127),
  -- IANA zone the start time is read in (checked on write by post_series_prepare).
  time_zone        text not null default 'Asia/Jerusalem',
  starts_on        date not null default ((now() at time zone 'Asia/Jerusalem')::date),
  ends_on          date,
  -- Machine `post_series`. Never written by a device.
  status           text not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint post_series_dates_chk check (ends_on >= starts_on)
);
comment on table public.post_series is
  'Recurring event: weekdays, local start time, length and the template of its dates. Written only by server code.';

-- "My recurring events", oldest first; covers the owner foreign key.
create index post_series_owner_idx on public.post_series (owner_id, created_at);
-- Materialisation sweep: the active series, oldest first.
create index post_series_active_idx on public.post_series (created_at) where status = 'active';
-- Covers the organization foreign key.
create index post_series_beneficiary_org_idx on public.post_series (beneficiary_org_id)
  where beneficiary_org_id is not null;

-- A series names a real time zone; anything else would make every date fail later.
create function kc_private.post_series_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.time_zone) then
    raise exception 'post_series_schedule_invalid' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
comment on function kc_private.post_series_prepare() is 'Refuses a recurring event whose time zone does not exist.';

create trigger post_series_prepare
  before insert or update of time_zone on public.post_series
  for each row execute function kc_private.post_series_prepare();

create trigger post_series_status_fsm
  before insert or update of status on public.post_series
  for each row execute function kc_private.fsm_guard_status('post_series', 'status');

create trigger post_series_set_updated_at
  before update on public.post_series
  for each row execute function kc_private.set_updated_at();

alter table public.post_series enable row level security;
alter table public.post_series force row level security;

-- A series is its owner's alone; others see its dates, which are ordinary posts.
create policy post_series_select_owner on public.post_series
  for select to authenticated
  using (owner_id = (select auth.uid()));

grant select on public.post_series to authenticated;

-- A date of a recurring event: its series and the local day it stands for. Not writable
-- by a device (the column grants of post_event_details do not include them).
alter table public.post_event_details
  add column series_id uuid references public.post_series (id) on delete set null,
  add column series_on date,
  add constraint post_event_details_series_chk check ((series_id is null) or (series_on is not null)),
  -- One date per series and day; also covers the series foreign key.
  add constraint post_event_details_series_day_key unique (series_id, series_on);

-- Days of a series the owner cancelled. The date's post is purged a week after it is
-- deleted; this row is what keeps the scheduler from publishing the day again.
create table kc_private.post_series_skipped_days (
  series_id  uuid not null references public.post_series (id) on delete cascade,
  skipped_on date not null,
  created_at timestamptz not null default now(),
  primary key (series_id, skipped_on)
);
comment on table kc_private.post_series_skipped_days is
  'Days of a recurring event its owner cancelled; never published again.';

alter table kc_private.post_series_skipped_days enable row level security;
alter table kc_private.post_series_skipped_days force row level security;

-- May this member publish in the name of this active organization? The rule of
-- kc_private.can_act_as_org for a named member, so the scheduler (no session) can ask it.
create function kc_private.member_can_act_as_org(p_user_id uuid, p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.org_memberships m
      join public.users u on u.id = m.user_id and u.is_active
      join public.organizations o on o.id = m.org_id and o.status = 'active'
     where m.org_id = p_org_id and m.user_id = p_user_id
       and (m.roles && array['org_admin', 'org_manager', 'org_employee', 'volunteer_manager']
            or (m.can_post and 'org_volunteer' = any (m.roles))));
$$;
comment on function kc_private.member_can_act_as_org(uuid, uuid) is
  'The member may publish in the name of this active organization.';

-- A local day and time in a zone, as an instant. PostgreSQL reads a time inside a
-- spring-forward gap as moved forward by the gap (02:30 → 03:30) and a time that occurs
-- twice as its second instant; a series takes the first, so the event is never an hour late.
create function kc_private.series_local_instant(p_on date, p_at time, p_time_zone text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local constant timestamp := p_on + p_at;
  v_at constant timestamptz := v_local at time zone p_time_zone;
  v_shift interval;
begin
  -- If an earlier instant shows the same wall-clock time, that is the first of the two.
  foreach v_shift in array array[interval '1 hour', interval '30 minutes'] loop
    if ((v_at - v_shift) at time zone p_time_zone) = v_local then
      return v_at - v_shift;
    end if;
  end loop;
  return v_at;
end;
$$;
comment on function kc_private.series_local_instant(date, time, text) is
  'A local day and time as an instant: a spring-forward gap moves forward by the gap, a repeated hour takes its first instant.';

-- Publishes the date of a series on one day, unless that day is not an event day, its start
-- already passed, the owner cancelled it, or the date exists. Returns the number created.
create function kc_private.post_series_materialize_day(p_series public.post_series, p_on date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starts constant timestamptz := kc_private.series_local_instant(p_on, p_series.start_time, p_series.time_zone);
  v_post_id uuid;
begin
  if (p_series.weekdays & (1 << extract(dow from p_on)::integer)) = 0 or v_starts <= now()
     or exists (select 1 from kc_private.post_series_skipped_days k
                 where k.series_id = p_series.id and k.skipped_on = p_on)
     or exists (select 1 from public.post_event_details e
                 where e.series_id = p_series.id and e.series_on = p_on) then
    return 0;
  end if;
  -- The dates of a series are one member action, not one post each (95_platform).
  perform set_config('kc.rate_limit_exempt', 'on', true);
  v_post_id := kc_private.post_create(
    p_series.owner_id,
    p_series.post_template || jsonb_build_object('post_type', 'event'),
    p_series.event_template || jsonb_build_object(
      'starts_at', v_starts,
      'ends_at', v_starts + make_interval(mins => p_series.duration_minutes)),
    'system');
  -- Only the scheduler links a date to its series (post_create does not take the link).
  update public.post_event_details e
     set series_id = p_series.id, series_on = p_on
   where e.post_id = v_post_id;
  if p_series.beneficiary_org_id is not null then
    update public.posts p set beneficiary_org_id = p_series.beneficiary_org_id where p.id = v_post_id;
  end if;
  return 1;
exception when unique_violation then
  return 0;  -- a concurrent run published this day first; its own post is rolled back
end;
$$;
comment on function kc_private.post_series_materialize_day(public.post_series, date) is
  'Publishes one date of a recurring event; idempotent per series and day.';

-- Publishes the missing dates of active series — one series, or all of them — from today
-- to 30 days ahead (dates in the series'' zone), and ends a series whose last day passed.
-- A series is skipped while its owner's account is not active, or while the owner may no
-- longer publish for its organization. Run by the scheduler and by the series RPCs.
create function kc_private.post_series_materialize(p_series_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series public.post_series;
  v_today date;
  v_count integer := 0;
begin
  for v_series in
    select s.* from public.post_series s
      join public.users u on u.id = s.owner_id and u.is_active
     where s.status = 'active' and (p_series_id is null or s.id = p_series_id)
       and (s.beneficiary_org_id is null
            or kc_private.member_can_act_as_org(s.owner_id, s.beneficiary_org_id))
     order by s.created_at
     -- The series row is locked, so the scheduler and an owner's pause, edit or end never
     -- interleave: a date is always published from the schedule that is committed.
     for update of s
  loop
    v_today := (now() at time zone v_series.time_zone)::date;
    if v_series.ends_on < v_today then
      update public.post_series s set status = 'ended' where s.id = v_series.id;
      continue;
    end if;
    select v_count + coalesce(sum(kc_private.post_series_materialize_day(v_series, d.day::date)), 0)
      into v_count
      from generate_series(greatest(v_series.starts_on, v_today),
                           least(coalesce(v_series.ends_on, v_today + 30), v_today + 30),
                           interval '1 day') as d (day);
  end loop;
  return v_count;
end;
$$;
comment on function kc_private.post_series_materialize(uuid) is
  'Publishes the missing dates of active recurring events for the next 30 days and ends a series past its last day; returns how many dates.';

insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description) values
  ('post_series_materialize', '15 2 * * *', 'select kc_private.post_series_materialize()',
   interval '10 minutes', interval '36 hours', 'Publishes the next 30 days of every active recurring event.');
