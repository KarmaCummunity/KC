-- Worlds · recurring knowledge lessons (FR-KNOW-003 AC2-AC3, FR-KNOW-004 AC1, issue #2035)
--
-- A teacher who gives the same lesson every week publishes one lesson offer with a weekly
-- schedule instead of one-off slots. Unlike a recurring ride or event (one post per date,
-- ride_series / post_series), a lesson offer is one post with many bookable slots, so a
-- series materializes `post_knowledge_slots` rows of its own post, 30 days ahead, and every
-- booking, approval and session completion stays the one-off flow of 70_worlds/150.
--
--   start      public.start_knowledge_slot_series  (the giver, on a lesson offer)
--   sweep      kc_private.knowledge_slot_series_materialize  (every 10 minutes)
--   pause      public.set_knowledge_slot_series_status(…, 'paused')   upcoming unbooked slots go
--   resume     public.set_knowledge_slot_series_status(…, 'active')   the next 30 days come back
--   end        public.set_knowledge_slot_series_status(…, 'ended')    terminal; booked slots stay
--
-- A recurring offer never expires while its series runs (FR-KNOW-003 AC3); once ended it
-- falls back to the one-off rule (30 minutes after its last remaining slot).
-- Errors (P0001): knowledge_series_not_allowed, knowledge_series_exists,
-- knowledge_series_has_slots, knowledge_series_schedule_invalid, knowledge_series_no_occurrence,
-- knowledge_series_not_found, illegal_transition (from an ended series), unknown_state.

insert into kc_private.fsm_state (machine_id, status) values
  ('knowledge_slot_series', 'active'), ('knowledge_slot_series', 'paused'), ('knowledge_slot_series', 'ended');

-- Ending is terminal: an ended series is never resumed (start a new offer).
insert into kc_private.fsm_edge (machine_id, from_status, to_status) values
  ('knowledge_slot_series', 'active', 'paused'),
  ('knowledge_slot_series', 'paused', 'active'),
  ('knowledge_slot_series', 'active', 'ended'),
  ('knowledge_slot_series', 'paused', 'ended');

create table public.knowledge_slot_series (
  id               uuid primary key default gen_random_uuid(),
  -- The lesson offer whose slots the series keeps; one series per offer, ever.
  post_id          uuid not null unique references public.posts (id) on delete cascade,
  -- Start of every session, Israel local time (FR-KNOW-003 AC2 `recurring.time`).
  start_time       time not null,
  -- Length of every session: the slot bounds of post_knowledge_slots_length_chk.
  duration_minutes integer not null check (duration_minutes between 15 and 480),
  -- Days the lesson runs, as a bit set: bit 0 = Sunday … bit 6 = Saturday.
  weekdays         smallint not null check (weekdays between 1 and 127),
  -- Learners per session, copied onto every materialized slot.
  capacity         smallint not null default 1 check (capacity between 1 and 20),
  starts_on        date not null default ((now() at time zone 'Asia/Jerusalem')::date),
  -- Last day a session may fall on (FR-KNOW-003 AC2 `recurring.until`); null = open-ended.
  ends_on          date,
  -- Machine `knowledge_slot_series`. Never written by a device.
  status           text not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint knowledge_slot_series_dates_chk check (ends_on >= starts_on)
);
comment on table public.knowledge_slot_series is
  'Weekly schedule of a recurring lesson offer; its slots are materialized 30 days ahead. Written only by server code.';

-- Materialisation sweep: the active series, oldest first.
create index knowledge_slot_series_active_idx on public.knowledge_slot_series (created_at) where status = 'active';

create trigger knowledge_slot_series_status_fsm
  before insert or update of status on public.knowledge_slot_series
  for each row execute function kc_private.fsm_guard_status('knowledge_slot_series', 'status');

create trigger knowledge_slot_series_set_updated_at
  before update on public.knowledge_slot_series
  for each row execute function kc_private.set_updated_at();

alter table public.knowledge_slot_series enable row level security;
alter table public.knowledge_slot_series force row level security;

-- The schedule is part of the offer: visible exactly when the post is, so a learner reads
-- "every Sunday at 18:00" on the detail screen.
create policy knowledge_slot_series_select_visible on public.knowledge_slot_series
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = knowledge_slot_series.post_id));

grant select on public.knowledge_slot_series to authenticated;

-- A materialized slot: its series and the Israel day it stands for. Not writable by a
-- device (the column grants of post_knowledge_slots do not include them).
alter table public.post_knowledge_slots
  add column series_id uuid references public.knowledge_slot_series (id) on delete cascade,
  add column series_on date,
  add constraint post_knowledge_slots_series_chk check ((series_id is null) = (series_on is null)),
  -- One slot per series and day; also covers the series foreign key.
  add constraint post_knowledge_slots_series_day_key unique (series_id, series_on);

-- The slots of a series belong to its schedule: a device neither moves nor removes one
-- (pause or end the series instead), and adds no one-off slot beside a running series.
-- Restrictive, so they narrow the owner and editor policies of 70_worlds/150.
create policy post_knowledge_slots_update_not_series on public.post_knowledge_slots
  as restrictive for update to authenticated
  using (series_id is null);
create policy post_knowledge_slots_delete_not_series on public.post_knowledge_slots
  as restrictive for delete to authenticated
  using (series_id is null);
create policy post_knowledge_slots_insert_not_recurring on public.post_knowledge_slots
  as restrictive for insert to authenticated
  with check (not exists (select 1 from public.knowledge_slot_series k
                           where k.post_id = post_knowledge_slots.post_id and k.status <> 'ended'));

-- Rules of a slot on every write (70_worlds/150), with one change: the twenty-slot limit
-- counts one-off slots only, since a series keeps up to 31 days of its own.
create or replace function kc_private.post_knowledge_slots_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taken constant integer := case when tg_op <> 'INSERT'
    then kc_private.knowledge_slot_seats_taken(old.post_id, old.starts_at) else 0 end;
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.posts p
                    where p.id = new.post_id and p.world_slug = 'knowledge' and p.direction = 'offer') then
      raise exception 'post_details_mismatch' using errcode = 'P0001';
    end if;
    if new.starts_at <= now() then
      raise exception 'slot_started' using errcode = 'P0001';
    end if;
    if new.series_id is null
       and (select count(*) from public.post_knowledge_slots s
             where s.post_id = new.post_id and s.series_id is null) >= 20 then
      raise exception 'knowledge_slots_limit' using errcode = 'P0001';
    end if;
  -- When the post itself is being removed its row is already gone, and the slot follows.
  elsif v_taken > 0 and exists (select 1 from public.posts p where p.id = old.post_id)
        and (tg_op = 'DELETE' or (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at)
             or new.capacity < v_taken) then
    raise exception 'knowledge_slot_has_booking' using errcode = 'P0001';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

-- When an offer expires: never while its series runs; otherwise 30 minutes after its last
-- slot ends, and never when it has no slot (FR-KNOW-003 AC3). Writes only on a change.
create function kc_private.knowledge_offer_sync_expiry(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires_at timestamptz;
begin
  if not exists (select 1 from public.knowledge_slot_series k
                  where k.post_id = p_post_id and k.status <> 'ended') then
    select max(s.ends_at) + interval '30 minutes' into v_expires_at
      from public.post_knowledge_slots s where s.post_id = p_post_id;
  end if;
  update public.posts p set expires_at = v_expires_at
   where p.id = p_post_id and p.expires_at is distinct from v_expires_at;
end;
$$;
comment on function kc_private.knowledge_offer_sync_expiry(uuid) is
  'Sets a knowledge offer''s expiry: none while its series runs, else 30 minutes after its last slot.';

create or replace function kc_private.post_knowledge_slots_sync_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.knowledge_offer_sync_expiry(case tg_op when 'DELETE' then old.post_id else new.post_id end);
  return null;
end;
$$;
comment on function kc_private.post_knowledge_slots_sync_expiry() is
  'AFTER write on post_knowledge_slots: the offer expires 30 minutes after its last slot, unless a series runs.';

-- Adds the missing slots of active series — one series, or all of them — from today to 30
-- days ahead (Israel days), and ends a series past its last day. A day is skipped when it
-- is not a lesson day, its start passed, or a slot of the offer (its own included) overlaps it. Series whose offer is closed or whose giver is inactive wait.
-- Run by the scheduler and by the series RPCs; returns how many slots it added.
create function kc_private.knowledge_slot_series_materialize(p_series_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series public.knowledge_slot_series;
  v_today constant date := (now() at time zone 'Asia/Jerusalem')::date;
  v_added integer;
  v_count integer := 0;
begin
  for v_series in
    select k.* from public.knowledge_slot_series k
      join public.posts p on p.id = k.post_id and p.status in ('draft', 'open', 'paused')
      join public.users u on u.id = p.owner_id and u.is_active
     where k.status = 'active' and (p_series_id is null or k.id = p_series_id)
     order by k.created_at
     -- The series row is locked, so the sweep and the giver's pause or end never interleave,
     -- and two sweeps never add the same day twice.
     for update of k
  loop
    if v_series.ends_on < v_today then
      update public.knowledge_slot_series k set status = 'ended' where k.id = v_series.id;
      perform kc_private.knowledge_offer_sync_expiry(v_series.post_id);
      continue;
    end if;
    insert into public.post_knowledge_slots (post_id, starts_at, ends_at, capacity, series_id, series_on)
    select v_series.post_id, t.starts_at, t.starts_at + make_interval(mins => v_series.duration_minutes),
           v_series.capacity, v_series.id, t.day
      from generate_series(greatest(v_series.starts_on, v_today),
                           least(coalesce(v_series.ends_on, v_today + 30), v_today + 30),
                           interval '1 day') as d (day)
     cross join lateral (select d.day::date as day,
                                kc_private.series_local_instant(d.day::date, v_series.start_time, 'Asia/Jerusalem')
                                  as starts_at) t
     where (v_series.weekdays & (1 << extract(dow from t.day)::integer)) <> 0
       and t.starts_at > now()
       -- The day's own slot, kept from an earlier run, overlaps it too.
       and not exists (select 1 from public.post_knowledge_slots o
                        where o.post_id = v_series.post_id
                          and tstzrange(o.starts_at, o.ends_at)
                              && tstzrange(t.starts_at, t.starts_at + make_interval(mins => v_series.duration_minutes)))
    on conflict (series_id, series_on) do nothing;
    get diagnostics v_added = row_count;
    v_count := v_count + v_added;
  end loop;
  return v_count;
end;
$$;
comment on function kc_private.knowledge_slot_series_materialize(uuid) is
  'Adds the missing slots of active recurring lesson offers for the next 30 days and ends a series past its last day; returns how many slots.';

-- Removes the upcoming slots of a series that nobody booked; a slot somebody holds stays.
create function kc_private.knowledge_slot_series_drop_unbooked(p_series_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.post_knowledge_slots s
   where s.series_id = p_series_id and s.starts_at > now()
     and kc_private.knowledge_slot_seats_taken(s.post_id, s.starts_at) = 0;
$$;
comment on function kc_private.knowledge_slot_series_drop_unbooked(uuid) is
  'Deletes the upcoming, unbooked slots of a recurring lesson offer.';

insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description) values
  ('knowledge_slot_series_materialize', '*/10 * * * *', 'select kc_private.knowledge_slot_series_materialize()',
   interval '5 minutes', interval '1 hour', 'Keeps the next 30 days of every recurring lesson offer bookable.');
