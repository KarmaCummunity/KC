-- kc-dev job tuning (supabase/seed/dev-tuning, #2492, #2488, #2494): the migrations keep the
-- production values; the dev-only seed shortens the two run-log retention periods, slows the
-- system-message consumer and narrows the matching scan, reaches pg_cron with the same
-- update, leaves every other rule and job alone, and changes nothing when it runs again.
-- A repeat run must also skip the statement-level scheduled_jobs_sync trigger, not only
-- leave values unchanged.
-- The tuning is a dev-only seed, not a migration, so this test loads it itself.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local client_min_messages = warning;

select plan(12);

-- ── Production values, as the migrations leave them ─────────────────────────
select is((select r.keep from kc_private.retention_rules r where r.name = 'job_runs'), interval '30 days',
  'the migrations keep job runs 30 days (production)');
select is((select r.keep from kc_private.retention_rules r where r.name = 'cron_run_history'), interval '7 days',
  'the migrations keep pg_cron''s run log 7 days (production)');
select is((select j.schedule from kc_private.scheduled_jobs j where j.name = 'chat_system_messages'), '10 seconds',
  'the migrations run the system-message consumer every 10 seconds (production)');
select is((select s.scan_limit from kc_private.matching_settings s), 500,
  'the migrations let one matching run scan 500 posts (production)');

-- Snapshot of everything the tuning must not touch.
create temp table untouched_before on commit drop as
  select 'rule:' || r.name as item, r.keep::text as value from kc_private.retention_rules r
   where r.name not in ('job_runs', 'cron_run_history')
  union all
  select 'job:' || j.name, j.schedule || '|' || j.alert_after::text from kc_private.scheduled_jobs j
   where j.name <> 'chat_system_messages';

-- Count statement-level UPDATE trigger invocations. A WHERE clause matching
-- zero rows still fires this trigger, so checking final values alone is not enough.
create temp table dev_tuning_sync_calls(n integer);
insert into dev_tuning_sync_calls values (0);
create function pg_temp.count_dev_tuning_sync()
returns trigger language plpgsql as $$
begin
  update pg_temp.dev_tuning_sync_calls set n = n + 1;
  return null;
end;
$$;
create trigger test_dev_tuning_sync_calls
  after update on kc_private.scheduled_jobs
  for each statement execute function pg_temp.count_dev_tuning_sync();

select set_config('kc.seed_target', 'dev', true);
\ir ../seed/dev-tuning/load.sql
update dev_tuning_sync_calls set n = 0;
\ir ../seed/dev-tuning/load.sql
select is((select n from dev_tuning_sync_calls), 0,
  'repeat seed skips the UPDATE statement and scheduler sync trigger entirely');

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
select is((select s.scan_limit from kc_private.matching_settings s), 200,
  'kc-dev lets one matching run scan 200 posts');

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
