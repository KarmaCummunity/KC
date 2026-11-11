-- 0744_post_series | Recurring time posts: a series publishes each upcoming date as an ordinary
-- post (FR-POST-024, issue #2086; PM decisions {{D:recurring-time-posts}},
-- {{D:series-end-cancels-booked}}, {{D:owner-cancel-notifies-registrants}})
--
-- First slice: an organization's recurring event (`org_event`). Each date is a real event post,
-- so registration, waitlist, the registration pushes (0731), the organizer's end bar and the
-- attendance marking all work per date with no change. A person's recurring volunteering joins
-- once a person's time post takes registrations (the next slice of #2086).
--
-- 1. `post_series` (the template and the schedule) and `post_series_occurrences` (one row per
--    series and date: the date's post, its start, and whether it was cancelled). The row is the
--    idempotency key: two overlapping runs never publish a date twice, and a cancelled date is
--    never published again.
-- 2. Machine `post_series` on the kernel: `active ⇄ paused`, either → `ended` (terminal).
-- 3. `kc_private.series_local_instant`: a date and a local time in the series' time zone. A time
--    that does not exist on a spring-forward day moves forward by the gap (02:30 → 03:30); a time
--    that occurs twice on a fall-back day takes the first.
-- 4. Publishing: a date is published through `create_marketplace_listing` acting as the series
--    owner, so it passes every check a hand-made event passes (membership, details, world rules).
--    Only the soonest upcoming date of a series reaches the main feed; the hourly sweep hands it on.
-- 5. Owner RPCs: `create_post_series`, `update_post_series` (edit all: dates nobody registered for
--    are published again; a date with registrations keeps its time), `set_post_series_status`
--    (pause / resume / end), `cancel_post_series_occurrence` (cancel one date). Ending a series
--    or cancelling a date closes its post, which cancels its registrations and tells each
--    registrant (0686). Reads: the owner reads their series; `list_post_series_occurrences`
--    lists a series' upcoming dates the caller may see.
-- 6. `post_series_sweep()`, hourly: keeps every active series published 30 days ahead, hands the
--    main-feed place on, and ends a series whose last date has passed.

-- ── 1. Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.post_series (
  series_id        uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.users(user_id) on delete cascade,
  kind_id          uuid not null references public.listing_kinds(kind_id),
  title            text not null check (char_length(title) between 1 and 80),
  summary          text check (summary is null or char_length(summary) <= 500),
  -- The details every date starts from (organization, capacity, policy, address), never the times.
  details          jsonb not null default '{}'::jsonb,
  city_id          text,
  -- Local start time in `time_zone`; weekdays bit 0 = Sunday … bit 6 = Saturday.
  start_time       time not null,
  duration_minutes integer not null check (duration_minutes between 15 and 1440),
  weekdays         smallint not null check (weekdays between 1 and 127),
  time_zone        text not null default 'Asia/Jerusalem',
  starts_on        date not null,
  ends_on          date,
  status           text not null default 'active' check (status in ('active', 'paused', 'ended')),
  -- Bumped by every edit; a date records the version it was published from.
  version          integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint post_series_window_chk check (ends_on is null or ends_on >= starts_on)
);

comment on table public.post_series is
  'FR-POST-024 (0744): a recurring time post. The template and schedule; each date is an ordinary post (post_series_occurrences).';

create index if not exists post_series_owner_idx on public.post_series (owner_id, status);
create index if not exists post_series_active_idx on public.post_series (status) where status = 'active';

create or replace trigger post_series_set_updated_at
  before update on public.post_series
  for each row execute function public.set_updated_at();

create table if not exists public.post_series_occurrences (
  series_id      uuid not null references public.post_series(series_id) on delete cascade,
  occurrence_on  date not null,
  -- Null once the date's post is gone (deleted by the owner); the row still holds the date.
  post_id        uuid references public.posts(post_id) on delete set null,
  starts_at      timestamptz not null,
  status         text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  series_version integer not null,
  -- The main-feed visibility the date's post was published with; restored when it becomes the
  -- series' soonest date (step 4).
  feed_hidden_default boolean not null default false,
  primary key (series_id, occurrence_on)
);

comment on table public.post_series_occurrences is
  'FR-POST-024 (0744): one row per series and date; the idempotency key of publishing and the tombstone of a cancelled date.';

create unique index if not exists post_series_occurrences_post_uniq
  on public.post_series_occurrences (post_id) where post_id is not null;
create index if not exists post_series_occurrences_upcoming_idx
  on public.post_series_occurrences (series_id, starts_at) where status = 'scheduled';

-- The owner reads their own series and dates; every write goes through the RPCs below.
alter table public.post_series enable row level security;
alter table public.post_series_occurrences enable row level security;

drop policy if exists post_series_select_own on public.post_series;
create policy post_series_select_own on public.post_series
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists post_series_occurrences_select_own on public.post_series_occurrences;
create policy post_series_occurrences_select_own on public.post_series_occurrences
  for select to authenticated using (exists (
    select 1 from public.post_series s
     where s.series_id = post_series_occurrences.series_id and s.owner_id = (select auth.uid())));

revoke all on public.post_series, public.post_series_occurrences from anon;
grant select on public.post_series, public.post_series_occurrences to authenticated;

-- A date's post carries `details.post_series = {id, on}` so a client shows "recurring" and finds
-- the other dates; the event kind's schema accepts it (it rejects unknown keys).
update public.listing_kinds
   set detail_schema = jsonb_set(detail_schema, '{properties,post_series}', '{
         "type":"object","additionalProperties":false,"required":["id","on"],
         "properties":{"id":{"type":"string","minLength":36,"maxLength":36},
                       "on":{"type":"string","format":"date"}}}'::jsonb)
 where world_slug = 'time' and slug = 'org_event';

-- ── 2. Machine `post_series` ───────────────────────────────────────────────────
insert into public.fsm_state (machine_id, status) values
  ('post_series', 'active'),
  ('post_series', 'paused'),
  ('post_series', 'ended');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('post_series', 'active', 'paused', ''),
  ('post_series', 'paused', 'active', ''),
  ('post_series', 'active', 'ended', ''),
  ('post_series', 'paused', 'ended', '');

drop trigger if exists post_series_status_fsm on public.post_series;
create trigger post_series_status_fsm
  before update of status on public.post_series
  for each row execute function kc_private.enforce_status_fsm(
    'post_series', 'status', 'post_series_transition_invalid');

-- ── 3. Local date and time → instant ───────────────────────────────────────────
create or replace function kc_private.series_local_instant(p_on date, p_at time, p_time_zone text)
returns timestamptz
language plpgsql
stable  -- the time zone database can change between releases
set search_path = ''
as $$
declare
  v_local timestamp := p_on + p_at;
  -- Postgres reads a time in a spring-forward gap as shifted forward by the gap, and a time in a
  -- fall-back overlap as its later instant.
  v_at timestamptz := v_local at time zone p_time_zone;
  v_shift interval;
begin
  -- Ambiguous: if an earlier instant shows the same wall-clock time, that is the first one.
  foreach v_shift in array array[interval '1 hour', interval '30 minutes'] loop
    if ((v_at - v_shift) at time zone p_time_zone) = v_local then
      return v_at - v_shift;
    end if;
  end loop;
  return v_at;
end;
$$;

comment on function kc_private.series_local_instant(date, time, text) is
  'FR-POST-024 AC4 (0744): a local date and time as an instant; a spring-forward gap moves forward by the gap, a fall-back overlap takes the first instant.';

-- ── 4. Publishing a date ───────────────────────────────────────────────────────
-- Runs `create_marketplace_listing` as the series owner, as a trusted server write (the hourly
-- write cap counts a member's own publishing, not the dates their series publishes for them).
-- The caller's claims are restored afterwards.
create or replace function kc_private.post_series_publish_date(p_series public.post_series, p_on date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_starts timestamptz := kc_private.series_local_instant(p_on, p_series.start_time, p_series.time_zone);
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_listing uuid;
  v_post uuid;
  v_hidden boolean;
begin
  if v_starts <= now()
     or (p_series.weekdays & (1 << extract(dow from p_on)::int)) = 0
     or p_on < p_series.starts_on
     or (p_series.ends_on is not null and p_on > p_series.ends_on) then
    return null;
  end if;

  -- The row is the lock: a second run for the same date finds it and publishes nothing.
  insert into public.post_series_occurrences (series_id, occurrence_on, starts_at, series_version)
  values (p_series.series_id, p_on, v_starts, p_series.version)
  on conflict (series_id, occurrence_on) do nothing;
  if not found then
    return null;
  end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_series.owner_id, 'role', 'service_role')::text, true);
  v_listing := public.create_marketplace_listing(
    p_kind_id => p_series.kind_id,
    p_title   => p_series.title,
    p_summary => p_series.summary,
    p_details => p_series.details || jsonb_build_object(
      'starts_at', to_char(v_starts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'ends_at',   to_char((v_starts + make_interval(mins => p_series.duration_minutes)) at time zone 'UTC',
                           'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'post_series', jsonb_build_object('id', p_series.series_id::text, 'on', to_char(p_on, 'YYYY-MM-DD'))),
    p_city_id => p_series.city_id);
  perform set_config('request.jwt.claims', v_claims, true);

  v_post := public.post_id_of_listing(v_listing);
  select p.feed_hidden into v_hidden from public.posts p where p.post_id = v_post;
  update public.post_series_occurrences
     set post_id = v_post, feed_hidden_default = coalesce(v_hidden, false)
   where series_id = p_series.series_id and occurrence_on = p_on;

  -- Only the soonest upcoming date of a series is in the main feed (the sweep hands it on).
  update public.posts p
     set feed_hidden = true
   where p.post_id = v_post
     and exists (
       select 1 from public.post_series_occurrences o
        where o.series_id = p_series.series_id and o.status = 'scheduled'
          and o.post_id is not null and o.post_id <> v_post
          and o.starts_at > now() and o.starts_at < v_starts);
  return v_post;
end;
$$;

revoke all on function kc_private.post_series_publish_date(public.post_series, date) from public, anon, authenticated;

-- Publishes the missing dates of the next 30 days (in the series' time zone). Strict: a refusal
-- (the owner left the organization, the details no longer pass) raises; otherwise that date is
-- skipped and the sweep tries again next hour.
create or replace function kc_private.post_series_materialize(p_series_id uuid, p_strict boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.post_series;
  v_today date;
  v_on date;
  v_count integer := 0;
begin
  select * into s from public.post_series where series_id = p_series_id;
  if not found or s.status <> 'active' then
    return 0;
  end if;
  v_today := (now() at time zone s.time_zone)::date;

  for v_on in
    select d::date from generate_series(greatest(v_today, s.starts_on),
                                        least(v_today + 30, coalesce(s.ends_on, v_today + 30)),
                                        interval '1 day') d
  loop
    if p_strict then
      v_count := v_count + (kc_private.post_series_publish_date(s, v_on) is not null)::int;
    else
      begin
        v_count := v_count + (kc_private.post_series_publish_date(s, v_on) is not null)::int;
      exception when others then
        raise warning 'post_series % date % not published: %', s.series_id, v_on, sqlerrm;
      end;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function kc_private.post_series_materialize(uuid, boolean) from public, anon, authenticated;

-- True when a date's post holds a live registration (requested, confirmed or waitlisted).
create or replace function kc_private.post_has_live_registrations(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.post_handoffs h
     where h.post_id = p_post_id and h.status in ('reserved', 'confirmed', 'waitlisted'));
$$;

revoke all on function kc_private.post_has_live_registrations(uuid) from public, anon, authenticated;

-- Removes the upcoming dates nobody registered for (post and row), so a resume or an edit
-- publishes them again. Returns how many were removed.
create or replace function kc_private.post_series_drop_unregistered(p_series_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_count integer := 0;
begin
  for o in
    select occurrence_on, post_id from public.post_series_occurrences
     where series_id = p_series_id and status = 'scheduled' and starts_at > now()
       and (post_id is null or not kc_private.post_has_live_registrations(post_id))
     for update
  loop
    if o.post_id is not null then
      delete from public.posts where post_id = o.post_id;
    end if;
    delete from public.post_series_occurrences where series_id = p_series_id and occurrence_on = o.occurrence_on;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function kc_private.post_series_drop_unregistered(uuid) from public, anon, authenticated;

-- Cancels one upcoming date: its post closes, which cancels its registrations and tells each
-- registrant (0686), and the row stays as a tombstone so the date is never published again.
create or replace function kc_private.post_series_cancel_date(p_series_id uuid, p_on date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts;
begin
  update public.post_series_occurrences set status = 'cancelled'
   where series_id = p_series_id and occurrence_on = p_on and status = 'scheduled';
  select p.* into v_post
    from public.posts p
    join public.post_series_occurrences o on o.post_id = p.post_id
   where o.series_id = p_series_id and o.occurrence_on = p_on;
  if found and v_post.status in ('open', 'paused') then
    -- On the post itself: `post_record_set_status` also writes the `listings` view, whose mirror
    -- reads its "closed" status back as `closed_delivered`.
    update public.posts set status = 'deleted_no_recipient', updated_at = now()
     where post_id = v_post.post_id;
  end if;
end;
$$;

revoke all on function kc_private.post_series_cancel_date(uuid, date) from public, anon, authenticated;

-- ── 5. Owner RPCs ──────────────────────────────────────────────────────────────
-- The caller's series, locked; refuses another member's series and an ended one.
create or replace function kc_private.post_series_for_owner(p_series_id uuid)
returns public.post_series
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.post_series;
begin
  select * into s from public.post_series
   where series_id = p_series_id and owner_id = auth.uid()
   for update;
  if not found then
    raise exception 'post_series_not_found' using errcode = 'P0002';
  end if;
  if s.status = 'ended' then
    raise exception 'post_series_ended' using errcode = '23514';
  end if;
  return s;
end;
$$;

revoke all on function kc_private.post_series_for_owner(uuid) from public, anon, authenticated;

-- Shared schedule checks of create and update.
create or replace function kc_private.post_series_check_schedule(
  p_weekdays integer, p_duration_minutes integer, p_time_zone text, p_ends_on date
)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_weekdays is null or p_weekdays not between 1 and 127 then
    raise exception 'post_series_weekdays_invalid' using errcode = '22023';
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 15 and 1440 then
    raise exception 'post_series_duration_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'post_series_time_zone_invalid' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_ends_on < (now() at time zone p_time_zone)::date then
    raise exception 'post_series_ends_in_past' using errcode = '23514';
  end if;
end;
$$;

revoke all on function kc_private.post_series_check_schedule(integer, integer, text, date) from public, anon, authenticated;

-- The template keeps no times and no series marker: each date writes its own.
create or replace function kc_private.post_series_template(p_details jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_details, '{}'::jsonb) - 'starts_at' - 'ends_at' - 'post_series';
$$;

-- Creates a series and publishes its dates; returns the series and its soonest date's post.
-- First slice: an organization's event (`post_series_kind_unsupported` otherwise).
create or replace function public.create_post_series(
  p_kind_id uuid,
  p_title text,
  p_details jsonb,
  p_start_time time,
  p_duration_minutes integer,
  p_weekdays integer,
  p_summary text default null,
  p_city_id text default null,
  p_ends_on date default null,
  p_time_zone text default 'Asia/Jerusalem'
)
returns table (series_id uuid, first_post_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_first uuid;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if not public.is_event_kind(p_kind_id) then
    raise exception 'post_series_kind_unsupported' using errcode = '22023';
  end if;
  perform kc_private.post_series_check_schedule(p_weekdays, p_duration_minutes, p_time_zone, p_ends_on);

  insert into public.post_series (
    owner_id, kind_id, title, summary, details, city_id, start_time, duration_minutes, weekdays,
    time_zone, starts_on, ends_on
  ) values (
    v_uid, p_kind_id, p_title, nullif(trim(coalesce(p_summary, '')), ''), kc_private.post_series_template(p_details),
    p_city_id, p_start_time, p_duration_minutes, p_weekdays, p_time_zone,
    (now() at time zone p_time_zone)::date, p_ends_on
  ) returning post_series.series_id into v_id;

  -- Strict: a refusal (membership, details) aborts the whole create.
  if kc_private.post_series_materialize(v_id, true) = 0 then
    raise exception 'post_series_no_occurrence' using errcode = '23514';
  end if;

  select o.post_id into v_first from public.post_series_occurrences o
   where o.series_id = v_id order by o.starts_at limit 1;
  return query select v_id, v_first;
end;
$$;

revoke all on function public.create_post_series(uuid, text, jsonb, time, integer, integer, text, text, date, text) from public, anon;
grant execute on function public.create_post_series(uuid, text, jsonb, time, integer, integer, text, text, date, text) to authenticated;

-- Edit all (FR-POST-024 AC5): the template and schedule change; upcoming dates nobody registered
-- for are published again from the new version; a date with registrations keeps its time and
-- details.
create or replace function public.update_post_series(
  p_series_id uuid,
  p_title text,
  p_details jsonb,
  p_start_time time,
  p_duration_minutes integer,
  p_weekdays integer,
  p_summary text default null,
  p_ends_on date default null
)
returns public.post_series
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.post_series := kc_private.post_series_for_owner(p_series_id);
begin
  perform kc_private.post_series_check_schedule(p_weekdays, p_duration_minutes, s.time_zone, p_ends_on);

  update public.post_series
     set title = p_title,
         summary = nullif(trim(coalesce(p_summary, '')), ''),
         details = kc_private.post_series_template(p_details),
         start_time = p_start_time,
         duration_minutes = p_duration_minutes,
         weekdays = p_weekdays,
         ends_on = p_ends_on,
         version = version + 1
   where series_id = s.series_id
   returning * into s;

  perform kc_private.post_series_drop_unregistered(s.series_id);
  perform kc_private.post_series_materialize(s.series_id, true);
  return s;
end;
$$;

revoke all on function public.update_post_series(uuid, text, jsonb, time, integer, integer, text, date) from public, anon;
grant execute on function public.update_post_series(uuid, text, jsonb, time, integer, integer, text, date) to authenticated;

-- Pause / resume / end (FR-POST-024 AC7–AC9). Pausing removes the upcoming dates nobody
-- registered for; resuming publishes again; ending cancels every upcoming date, registered ones
-- included, and their registrants are told ({{D:series-end-cancels-booked}}).
create or replace function public.set_post_series_status(p_series_id uuid, p_status text)
returns public.post_series
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.post_series := kc_private.post_series_for_owner(p_series_id);
  v_on date;
begin
  if p_status not in ('active', 'paused', 'ended') then
    raise exception 'post_series_status_invalid' using errcode = '22023';
  end if;
  if p_status = s.status then
    return s;
  end if;

  update public.post_series set status = p_status where series_id = s.series_id returning * into s;

  if p_status = 'active' then
    perform kc_private.post_series_materialize(s.series_id, true);
    return s;
  end if;

  perform kc_private.post_series_drop_unregistered(s.series_id);
  if p_status = 'ended' then
    for v_on in
      select occurrence_on from public.post_series_occurrences
       where series_id = s.series_id and status = 'scheduled' and starts_at > now()
    loop
      perform kc_private.post_series_cancel_date(s.series_id, v_on);
    end loop;
  end if;
  return s;
end;
$$;

revoke all on function public.set_post_series_status(uuid, text) from public, anon;
grant execute on function public.set_post_series_status(uuid, text) to authenticated;

-- Cancel one date (FR-POST-024 AC6), by its post; refused once it has started.
create or replace function public.cancel_post_series_occurrence(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.post_series_occurrences;
begin
  select * into o from public.post_series_occurrences where post_id = p_post_id;
  if not found then
    raise exception 'post_series_occurrence_not_found' using errcode = 'P0002';
  end if;
  perform kc_private.post_series_for_owner(o.series_id);
  if o.status <> 'scheduled' then
    return;
  end if;
  if o.starts_at <= now() then
    raise exception 'post_series_occurrence_started' using errcode = '23514';
  end if;
  perform kc_private.post_series_cancel_date(o.series_id, o.occurrence_on);
end;
$$;

revoke all on function public.cancel_post_series_occurrence(uuid) from public, anon;
grant execute on function public.cancel_post_series_occurrence(uuid) to authenticated;

-- A series' upcoming dates the caller may see, soonest first ("other dates" on a date's post).
create or replace function public.list_post_series_occurrences(p_series_id uuid, p_limit integer default 10)
returns table (occurrence_on date, starts_at timestamptz, post_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select o.occurrence_on, o.starts_at, o.post_id
    from public.post_series_occurrences o
    join public.posts p on p.post_id = o.post_id
   where o.series_id = p_series_id
     and o.status = 'scheduled'
     and o.starts_at > now()
     and p.status = 'open'
     and public.is_post_visible_to(p, auth.uid())
   order by o.starts_at
   limit greatest(1, least(coalesce(p_limit, 10), 31));
$$;

revoke all on function public.list_post_series_occurrences(uuid, integer) from public;
grant execute on function public.list_post_series_occurrences(uuid, integer) to anon, authenticated;

-- ── 6. Hourly sweep ────────────────────────────────────────────────────────────
create or replace function public.post_series_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_count integer := 0;
begin
  for s in select series_id, time_zone, ends_on from public.post_series where status = 'active' loop
    -- A series whose last date has passed ends; nothing is left to cancel.
    if s.ends_on is not null and s.ends_on < (now() at time zone s.time_zone)::date then
      update public.post_series set status = 'ended' where series_id = s.series_id;
      continue;
    end if;
    v_count := v_count + kc_private.post_series_materialize(s.series_id, false);
  end loop;

  -- The main-feed place passes to each series' soonest upcoming open date.
  update public.posts p
     set feed_hidden = o.feed_hidden_default
    from public.post_series_occurrences o
   where o.post_id = p.post_id
     and p.feed_hidden is distinct from o.feed_hidden_default
     and p.status = 'open'
     and o.starts_at = (
       select min(o2.starts_at) from public.post_series_occurrences o2
         join public.posts p2 on p2.post_id = o2.post_id
        where o2.series_id = o.series_id and o2.status = 'scheduled'
          and o2.starts_at > now() and p2.status = 'open');
  return v_count;
end;
$$;

comment on function public.post_series_sweep() is
  'FR-POST-024 (0744, hourly): keeps every active series published 30 days ahead, hands the main-feed place to its soonest date, ends a series past its last date.';

revoke all on function public.post_series_sweep() from public, anon, authenticated;
grant execute on function public.post_series_sweep() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'post_series_sweep') then
      perform cron.unschedule('post_series_sweep');
    end if;
    perform cron.schedule('post_series_sweep', '23 * * * *', $sql$ select public.post_series_sweep(); $sql$);
  else
    raise notice 'pg_cron not enabled — post_series_sweep not scheduled.';
  end if;
end $$;
