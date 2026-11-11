-- Worlds · ride_series (a recurring ride, D103, FR-RIDE-046)
--
-- A series is a schedule plus the template of its rides. The scheduler publishes one
-- ordinary ride post per matching day, 30 days ahead (070_ride_series_rpcs.sql), so feed,
-- bookings, alerts and the emergency call treat an occurrence like any other ride. Table
-- and access only; the series RPCs come after the ride details they create.

insert into kc_private.fsm_state (machine_id, status) values
  ('ride_series', 'active'), ('ride_series', 'paused'), ('ride_series', 'cancelled');

-- Cancelling is terminal: a cancelled series is never resumed (publish a new one).
insert into kc_private.fsm_edge (machine_id, from_status, to_status) values
  ('ride_series', 'active', 'paused'),
  ('ride_series', 'paused', 'active'),
  ('ride_series', 'active', 'cancelled'),
  ('ride_series', 'paused', 'cancelled');

create table public.ride_series (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.users (id) on delete cascade,
  -- The two payloads of public.create_post_with_details for one occurrence, without its
  -- times: the post (kind, direction, title, city, audience) and the ride (route, seats,
  -- flags). Checked by publishing the first occurrence when the series is created.
  post_template    jsonb not null check (jsonb_typeof(post_template) = 'object'),
  ride_template    jsonb not null check (jsonb_typeof(ride_template) = 'object'),
  -- Departure time of every occurrence, Israel local time.
  depart_time      time not null,
  -- Days the ride runs, as a bit set: bit 0 = Sunday … bit 6 = Saturday.
  weekdays         smallint not null check (weekdays between 1 and 127),
  -- Estimated length of the ride; null = no estimated end.
  duration_minutes integer check (duration_minutes between 1 and 1440),
  starts_on        date not null default ((now() at time zone 'Asia/Jerusalem')::date),
  ends_on          date,
  -- Machine `ride_series`. Never written by a device.
  status           text not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ride_series_dates_chk check (ends_on >= starts_on)
);
comment on table public.ride_series is
  'Recurring ride: weekdays, departure time and the template of its occurrences. Written only by server code.';

-- "My recurring rides", oldest first; covers the owner foreign key.
create index ride_series_owner_idx on public.ride_series (owner_id, created_at);
-- Materialisation sweep: the active series, oldest first.
create index ride_series_active_idx on public.ride_series (created_at) where status = 'active';

create trigger ride_series_status_fsm
  before insert or update of status on public.ride_series
  for each row execute function kc_private.fsm_guard_status('ride_series', 'status');

create trigger ride_series_set_updated_at
  before update on public.ride_series
  for each row execute function kc_private.set_updated_at();

alter table public.ride_series enable row level security;
alter table public.ride_series force row level security;

-- A series is its owner's alone; others see its occurrences, which are ordinary posts.
create policy ride_series_select_owner on public.ride_series
  for select to authenticated
  using (owner_id = (select auth.uid()));

grant select on public.ride_series to authenticated;

-- The schedule of a series as the readers of its occurrences see it (FR-RIDE-046): days,
-- departure time (Israel time) and last day, while the series is not cancelled. The row
-- itself stays its owner's; this is released only through rides_feed and
-- ride_occurrence_schedules, which reach a series through an occurrence the caller can read.
create function kc_access.ride_series_schedule(p_series_id uuid)
returns table (weekdays smallint, depart_time time, ends_on date)
language sql
stable
security definer
set search_path = ''
as $$
  select s.weekdays, s.depart_time, s.ends_on
    from public.ride_series s
   where s.id = p_series_id and s.status <> 'cancelled';
$$;
comment on function kc_access.ride_series_schedule(uuid) is
  'Weekdays, departure time and last day of a running series; released through readable occurrences only.';
grant execute on function kc_access.ride_series_schedule(uuid) to authenticated;
