-- kc-dev job tuning (supabase/seed/dev-tuning, #2492, #2488): the migrations keep the
-- production values; the dev-only seed shortens the two run-log retention periods and slows
-- the system-message consumer, reaches pg_cron with the same update, leaves every other rule
-- and job alone, and changes nothing when it runs again.
-- The tuning is a dev-only seed, not a migration, so this test loads it itself.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local client_min_messages = warning;

select plan(9);

-- ── Production values, as the migrations leave them ─────────────────────────
select is((select r.keep from kc_private.retention_rules r where r.name = 'job_runs'), interval '30 days',
  'the migrations keep job runs 30 days (production)');
select is((select r.keep from kc_private.retention_rules r where r.name = 'cron_run_history'), interval '7 days',
  'the migrations keep pg_cron''s run log 7 days (production)');
select is((select j.schedule from kc_private.scheduled_jobs j where j.name = 'chat_system_messages'), '10 seconds',
  'the migrations run the system-message consumer every 10 seconds (production)');

-- Snapshot of everything the tuning must not touch.
create temp table untouched_before on commit drop as
  select 'rule:' || r.name as item, r.keep::text as value from kc_private.retention_rules r
   where r.name not in ('job_runs', 'cron_run_history')
  union all
  select 'job:' || j.name, j.schedule || '|' || j.alert_after::text from kc_private.scheduled_jobs j
   where j.name <> 'chat_system_messages';

-- Loaded twice: the second run must succeed and change nothing.
select set_config('kc.seed_target', 'dev', true);
\ir ../seed/dev-tuning/load.sql
\ir ../seed/dev-tuning/load.sql

-- ── kc-dev values ───────────────────────────────────────────────────────────
select is((select r.keep from kc_private.retention_rules r where r.name = 'job_runs'), interval '7 days',
  'kc-dev keeps job runs 7 days');
select is((select r.keep from kc_private.retention_rules r where r.name = 'cron_run_history'), interval '1 day',
  'kc-dev keeps pg_cron''s run log 1 day');
select is((select j.schedule from kc_private.scheduled_jobs j where j.name = 'chat_system_messages'), '30 seconds',
  'kc-dev runs the system-message consumer every 30 seconds');
select ok((select j.alert_after >= interval '90 seconds' from kc_private.scheduled_jobs j
            where j.name = 'chat_system_messages'),
  'its alert period still covers three runs, so jobs_late keeps its meaning');

select is((select count(*) from (
            select 'rule:' || r.name as item, r.keep::text as value from kc_private.retention_rules r
             where r.name not in ('job_runs', 'cron_run_history')
            union all
            select 'job:' || j.name, j.schedule || '|' || j.alert_after::text from kc_private.scheduled_jobs j
             where j.name <> 'chat_system_messages'
            except
            select item, value from untouched_before) changed), 0::bigint,
  'every other retention rule and job keeps its production value');

-- The scheduler follows the registry: the slower cadence reached pg_cron with the update.
create function pg_temp.cron_checks()
returns setof text
language plpgsql
as $$
begin
  if to_regclass('cron.job') is null then
    return query select skip('pg_cron is not loaded on this server', 1);
    return;
  end if;
  return next is((select c.schedule from cron.job c where c.jobname = 'chat_system_messages'), '30 seconds',
                 'pg_cron runs the system-message consumer every 30 seconds');
end;
$$;
select * from pg_temp.cron_checks();

select * from finish();
rollback;
