-- Platform · operational telemetry tables (design §6 "Monitoring")
--
-- Three small tables in `ops`, written only by server code and read only by the service
-- role (monitoring and the health checks of this module). No member can address the schema.
--   ops.job_runs       one row per run of a scheduled job: outcome, duration, error
--   ops.warnings       conditions an operator must know about that are not a failed run
--   ops.counter_drift  counters the nightly reconciliation found wrong, and repaired

create table ops.job_runs (
  id          bigint generated always as identity primary key,
  job_name    text not null,
  started_at  timestamptz not null,
  finished_at timestamptz not null,
  -- `failed` carries the error; the wrapper never lets a job's error escape.
  status      text not null check (status in ('succeeded', 'failed')),
  duration_ms integer not null check (duration_ms >= 0),
  error       text,
  constraint job_runs_error_chk check ((status = 'failed') = (error is not null))
);
comment on table ops.job_runs is 'Outcome of every scheduled job run; pruned by retention.';

-- Health checks: the latest runs of one job.
create index job_runs_job_finished_idx on ops.job_runs (job_name, finished_at desc);
-- Retention: rows older than the window.
create index job_runs_finished_idx on ops.job_runs (finished_at);

alter table ops.job_runs enable row level security;
alter table ops.job_runs force row level security;
revoke insert, update, delete, truncate on ops.job_runs from service_role;

create table ops.warnings (
  -- Stable identifier of the condition, e.g. 'edge_invocation_unavailable'.
  key         text primary key check (key ~ '^[a-z][a-z0-9_.:-]{1,120}$'),
  detail      text not null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  occurrences bigint not null default 1 check (occurrences > 0)
);
comment on table ops.warnings is
  'Standing operational warnings, one row per condition; a health check reports the recent ones.';

alter table ops.warnings enable row level security;
alter table ops.warnings force row level security;
-- An operator acknowledges a warning by deleting its row; nothing else is writable.
revoke insert, update, truncate on ops.warnings from service_role;

-- Records a warning, or counts one more occurrence of a known one. Never raises: a warning
-- that cannot be written must not break the work that wanted to report it. A known warning
-- is refreshed at most once a minute, so a busy path does not queue on its row.
create function kc_private.ops_warn(p_key text, p_detail text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into ops.warnings as w (key, detail)
  values (p_key, left(coalesce(p_detail, ''), 500))
  on conflict (key) do update
    set detail = excluded.detail, last_seen = now(), occurrences = w.occurrences + 1
    where w.last_seen < now() - interval '1 minute';
exception when others then
  null;
end;
$$;
comment on function kc_private.ops_warn(text, text) is
  'Records an operational warning (one row per key, occurrences counted); never raises.';

create table ops.counter_drift (
  id            bigint generated always as identity primary key,
  detected_at   timestamptz not null default now(),
  counter_table text not null,
  counter_name  text not null,
  -- The member or post whose counter was wrong.
  subject_id    uuid not null,
  stored_value  bigint not null,
  actual_value  bigint not null
);
comment on table ops.counter_drift is
  'Counters found out of step with their source rows by the nightly reconciliation; each was repaired.';

-- Health check and retention: drift of the recent period.
create index counter_drift_detected_idx on ops.counter_drift (detected_at);

alter table ops.counter_drift enable row level security;
alter table ops.counter_drift force row level security;
revoke insert, update, delete, truncate on ops.counter_drift from service_role;
