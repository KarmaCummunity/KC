-- 0463_ops_health_registry | Operational health registry + first checks (G42, D68, D69).
--
-- docs/architecture/target.md §5.2. A check is one row in ops.health_checks pointing at a
-- function that returns ops.health_result (a number + a short, data-free detail). The row
-- holds severity and threshold, so tuning never needs code. ops.run_health_checks() runs
-- every enabled check and is what the hourly monitor (.github/workflows/ops-health.yml)
-- reads on dev and prod.
--
-- Safety: every check runs inside its own read-only subtransaction that is always rolled
-- back, so a check can never change data (prod checks are read-only by construction, D69)
-- and one failing check is reported as `error` without stopping the others. Details carry
-- counts and job names only — alerts land in GitHub issues, so no user data ever leaves.

begin;

create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;
comment on schema ops is 'Operational health checks (G42). Service roles only.';

-- The value a check measures and a one-line human description of it.
create type ops.health_result as (
  value  numeric,
  detail text
);

create table ops.health_checks (
  check_key      text primary key check (check_key ~ '^[a-z][a-z0-9_]{2,62}$'),
  area           text not null check (area ~ '^[a-z][a-z0-9_]*$'),   -- 'platform' or a giving-world slug
  description    text not null,
  severity       text not null check (severity in ('warning', 'critical')),
  threshold      numeric not null,                                      -- alert when value > threshold
  check_function regprocedure not null,
  enabled        boolean not null default true,
  updated_at     timestamptz not null default now()
);

alter table ops.health_checks enable row level security;
revoke all on ops.health_checks from public, anon, authenticated;

comment on table ops.health_checks is
  'Registry of operational health checks (G42). One row per check; threshold and severity are tuned here, never in code.';

-- ── Runner ────────────────────────────────────────────────────────────────────

-- Runs every enabled check. Each check executes in a read-only subtransaction that is then
-- rolled back on purpose with SQLSTATE KC001 (class 'KC' = KC-internal control flow), so no
-- side effect of a check can survive; a check that fails reports only its SQLSTATE.
create or replace function ops.run_health_checks()
returns table (
  check_key text,
  area      text,
  severity  text,
  status    text,      -- ok | alert | error
  value     numeric,
  threshold numeric,
  detail    text
)
language plpgsql
set search_path = ops, public, pg_temp
as $$
declare
  c         ops.health_checks;
  v_value   numeric;
  v_detail  text;
  v_failed  text;
begin
  for c in select * from ops.health_checks h where h.enabled order by h.area, h.check_key loop
    v_value := null;
    v_detail := null;
    v_failed := null;

    begin
      perform set_config('transaction_read_only', 'on', true);
      execute format('select (r).value, (r).detail from (select %s() as r) s', c.check_function::oid::regproc)
         into v_value, v_detail;
      raise exception using errcode = 'KC001';
    exception
      when sqlstate 'KC001' then null;          -- the deliberate rollback; values were captured
      when others then v_failed := sqlstate;    -- report the code only, never the message
    end;

    check_key := c.check_key;
    area      := c.area;
    severity  := c.severity;
    threshold := c.threshold;
    value     := v_value;
    if v_failed is not null then
      status := 'error';
      detail := format('check could not run (SQLSTATE %s)', v_failed);
    else
      status := case when coalesce(v_value, 0) > c.threshold then 'alert' else 'ok' end;
      detail := v_detail;
    end if;
    return next;
  end loop;
end;
$$;

revoke all on function ops.run_health_checks() from public, anon, authenticated;

-- ── Platform checks ───────────────────────────────────────────────────────────

-- Scheduled jobs (expiry, matching sweep, cleanups) that failed in the last 24 hours.
create or replace function ops.check_scheduled_jobs_failed()
returns ops.health_result
language sql
stable
set search_path = cron, pg_temp
as $$
  select count(*)::numeric,
         coalesce('failed runs in 24 h: ' || string_agg(distinct j.jobname, ', '), 'no failed runs in 24 h')
    from cron.job_run_details d
    left join cron.job j on j.jobid = d.jobid
   where d.status = 'failed'
     and d.start_time > now() - interval '24 hours';
$$;

-- Notifications nobody dispatched for over 15 minutes: the dispatcher is down or stuck.
create or replace function ops.check_notifications_backlog()
returns ops.health_result
language sql
stable
set search_path = public, pg_temp
as $$
  select count(*)::numeric,
         format('%s undispatched notifications, oldest %s min',
                count(*), coalesce(floor(extract(epoch from now() - min(created_at)) / 60), 0))
    from public.notifications_outbox
   where dispatched_at is null
     and created_at < now() - interval '15 minutes';
$$;

-- Push sends that failed in the last 24 hours. Skips the dispatcher makes on purpose
-- (no devices, muted, suspended or missing recipient) are not failures.
create or replace function ops.check_notifications_push_failures()
returns ops.health_result
language sql
stable
set search_path = public, pg_temp
as $$
  select count(*)::numeric,
         format('%s failed push sends in 24 h', count(*))
    from public.notifications_outbox
   where dispatched_at > now() - interval '24 hours'
     and last_error is not null
     and last_error not in ('no_devices', 'suppressed_by_preference', 'recipient_suspended', 'recipient_not_found');
$$;

-- Listings whose automatic offer↔request matching failed in the last 24 hours.
create or replace function ops.check_matching_errors()
returns ops.health_result
language sql
stable
set search_path = public, pg_temp
as $$
  select count(*)::numeric,
         format('%s listings failed matching in 24 h', count(*))
    from public.match_listing_state
   where last_error is not null
     and computed_at > now() - interval '24 hours';
$$;

-- ── Rides checks (docs/spec §5.3) ─────────────────────────────────────────────

-- Departure time of a ride listing, or NULL when the stored value is not a timestamp.
create or replace function ops.ride_departs_at(p_details jsonb)
returns timestamptz
language sql
immutable
as $$
  select case when p_details ->> 'departs_at' ~ '^\d{4}-\d{2}-\d{2}'
              then (p_details ->> 'departs_at')::timestamptz end;
$$;

-- Seat bookings still waiting for the driver after their confirm-by deadline.
create or replace function ops.check_rides_bookings_unconfirmed()
returns ops.health_result
language sql
stable
set search_path = public, pg_temp
as $$
  select count(*)::numeric,
         format('%s ride bookings past their confirm-by deadline', count(*))
    from public.giving_handoffs
   where world_slug = 'rides'
     and status = 'reserved'
     and confirm_by < now();
$$;

-- Ride offers still open six hours after departure: nothing closed them.
create or replace function ops.check_rides_open_after_departure()
returns ops.health_result
language sql
stable
set search_path = ops, public, pg_temp
as $$
  select count(*)::numeric,
         format('%s rides open more than 6 h after departure', count(*))
    from public.listings
   where world_slug = 'rides'
     and status = 'open'
     and ops.ride_departs_at(details) < now() - interval '6 hours';
$$;

-- Confirmed seats on rides that left over a day ago and were never completed.
create or replace function ops.check_rides_trips_not_completed()
returns ops.health_result
language sql
stable
set search_path = ops, public, pg_temp
as $$
  select count(*)::numeric,
         format('%s confirmed ride seats not completed 24 h after departure', count(*))
    from public.giving_handoffs h
    join public.listings l on l.listing_id = h.listing_id
   where h.world_slug = 'rides'
     and h.status = 'confirmed'
     and ops.ride_departs_at(l.details) < now() - interval '24 hours';
$$;

revoke all on all functions in schema ops from public, anon, authenticated;

insert into ops.health_checks (check_key, area, description, severity, threshold, check_function) values
  ('scheduled_jobs_failed',        'platform', 'Scheduled jobs that failed in the last 24 h',                     'critical', 0,  'ops.check_scheduled_jobs_failed()'),
  ('notifications_backlog',        'platform', 'Notifications not dispatched within 15 minutes',                  'critical', 0,  'ops.check_notifications_backlog()'),
  ('notifications_push_failures',  'platform', 'Push sends that failed in the last 24 h',                         'warning',  10, 'ops.check_notifications_push_failures()'),
  ('matching_errors',              'platform', 'Listings whose automatic matching failed in the last 24 h',       'warning',  0,  'ops.check_matching_errors()'),
  ('rides_bookings_unconfirmed',   'rides',    'Seat bookings past the driver''s confirm-by deadline',            'warning',  0,  'ops.check_rides_bookings_unconfirmed()'),
  ('rides_open_after_departure',   'rides',    'Ride offers still open 6 h after departure',                      'warning',  0,  'ops.check_rides_open_after_departure()'),
  ('rides_trips_not_completed',    'rides',    'Confirmed seats not completed 24 h after departure',              'warning',  0,  'ops.check_rides_trips_not_completed()')
on conflict (check_key) do nothing;

commit;
