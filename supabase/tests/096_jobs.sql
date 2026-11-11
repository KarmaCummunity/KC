-- Jobs: every registered job runs through the wrapper, which records success and failure
-- and never raises; the registry is reconciled into pg_cron (tested for real where pg_cron
-- is loaded, skipped elsewhere); calling an Edge Function is a recorded no-op without
-- pg_net / Vault and can never fail the transaction that asked for it.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as a database role; 'ok' or the SQLSTATE.
create function pg_temp.as_role(p_role text, p_sql text)
returns text
language plpgsql
as $$
begin
  begin
    perform set_config('role', p_role, true);
    execute p_sql;
    perform set_config('role', 'none', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'none', true);
    return sqlstate;
  end;
end;
$$;

select plan(37);

-- A scheduler may be running these jobs in the background on this database: every
-- assertion below looks only at what this transaction did (job names `zz_…`, return values).

-- ── The registry ────────────────────────────────────────────────────────────
select is((select count(*) from kc_private.scheduled_jobs where not enabled), 0::bigint, 'every registered job is enabled');
select is((select count(*) from kc_private.scheduled_jobs j
            where j.timeout >= j.alert_after or j.description = ''), 0::bigint,
  'every job has a timeout shorter than its alert period');
select is((select string_agg(j.name, ',' order by j.name) from kc_private.scheduled_jobs j
            where j.command !~ '^select kc_private\.[a-z_]+\(.*\)$'), null,
  'every job is one call of an internal function');
select is((select bool_and(kc_private.job_run(j.name)) from kc_private.scheduled_jobs j), true,
  'every registered job runs without error on an empty database');
select throws_ok($$insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description)
  values ('zz_long', '* * * * *', 'select 1', interval '2 hours', interval '3 hours', 'x')$$, '23514', null,
  'a timeout above one hour is refused');
select is(pg_temp.as_role('service_role', 'update kc_private.scheduled_jobs set enabled = false')
  || '|' || pg_temp.as_role('service_role', $$insert into ops.job_runs (job_name, started_at, finished_at, status, duration_ms)
       values ('x', now(), now(), 'succeeded', 0)$$)
  || '|' || pg_temp.as_role('service_role', 'select * from ops.job_runs limit 1'), '42501|42501|ok',
  'the service role reads job history and can change neither it nor the registry');
select is(pg_temp.as_role('authenticated', 'select 1 from ops.job_runs')
  || '|' || pg_temp.as_role('authenticated', $$select kc_private.job_run('audit_consume')$$), '42501|42501',
  'a member can neither read job history nor run a job');

-- ── The wrapper ─────────────────────────────────────────────────────────────
insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description) values
  ('zz_ok', '* * * * *', 'select 1', interval '5 seconds', interval '1 hour', 'succeeds'),
  ('zz_fail', '* * * * *', 'select 1 / 0', interval '5 seconds', interval '1 hour', 'fails'),
  ('zz_missing', '* * * * *', 'select kc_private.no_such_function()', interval '5 seconds', interval '1 hour', 'fails'),
  ('zz_off', '* * * * *', 'select 1 / 0', interval '5 seconds', interval '1 hour', 'disabled');
update kc_private.scheduled_jobs set enabled = false where name = 'zz_off';

select is(kc_private.job_run('zz_ok'), true, 'a job that works reports success');
select is(kc_private.job_run('zz_fail'), false, 'a job that raises reports failure without raising');
select is(kc_private.job_run('zz_missing'), false, 'so does a job whose function does not exist');
select is(kc_private.job_run('zz_unknown'), false, 'and a job that is not registered');
select is(kc_private.job_run('zz_off'), false, 'a disabled job does not run');
select is((select string_agg(r.job_name || ':' || r.status || ':' || coalesce(left(r.error, 5), '-'), ' ' order by r.job_name)
             from ops.job_runs r where r.job_name like 'zz\_%'),
  'zz_fail:failed:22012 zz_missing:failed:42883 zz_ok:succeeded:- zz_unknown:failed:job i',
  'each run is recorded with its outcome and error; the disabled job left nothing');
select is((select bool_and(r.finished_at >= r.started_at and r.duration_ms >= 0) from ops.job_runs r where r.job_name like 'zz\_%'),
  true, 'with start, finish and duration');

-- ── pg_cron, for real ───────────────────────────────────────────────────────
create function pg_temp.cron_tests()
returns setof text
language plpgsql
as $$
declare
  v_command text;
begin
  if to_regclass('cron.job') is null then
    return next is(kc_private.jobs_sync(), 0, 'without pg_cron the reconciliation does nothing');
    return query select skip('pg_cron is not loaded on this server', 8);
    return;
  end if;
  return next is(kc_private.jobs_sync(), 0, 'the registry is already in pg_cron: nothing to do');
  return next is((select count(*) from kc_private.scheduled_jobs j
                   where j.enabled and not exists (select 1 from cron.job c where c.jobname = j.name and c.active)),
                 0::bigint, 'every enabled job is scheduled');
  select c.command into v_command from cron.job c where c.jobname = 'zz_ok';
  return next is(v_command, $c$set statement_timeout = 5000; select kc_private.job_run('zz_ok');$c$,
                 'a job runs through the wrapper under its timeout');
  return next is((select count(*) from cron.job c where c.jobname = 'zz_off'), 0::bigint, 'a disabled job is unscheduled');

  update kc_private.scheduled_jobs set schedule = '*/5 * * * *', timeout = interval '9 seconds' where name = 'zz_ok';
  return next is((select c.schedule || ' ' || (c.command like '%= 9000;%') from cron.job c where c.jobname = 'zz_ok'),
                 '*/5 * * * * true', 'a changed schedule or timeout reaches pg_cron with the update');
  return next is((select count(*) from cron.job c where c.jobname = 'zz_ok'), 1::bigint, 'as an alteration, not a second job');

  delete from kc_private.scheduled_jobs where name in ('zz_ok', 'zz_fail');
  return next is((select count(*) from cron.job c where c.jobname in ('zz_ok', 'zz_fail')), 0::bigint,
                 'a job removed from the registry is unscheduled');
  perform cron.schedule('zz_manual', '0 0 1 1 *', 'select 1');
  perform cron.unschedule('audit_consume');
  return next is(kc_private.jobs_sync() || '/' || kc_private.jobs_sync(), '1/0',
                 'a missing job is restored, and a second run changes nothing');
  return next is((select count(*) from cron.job c where c.jobname in ('zz_manual', 'audit_consume')), 2::bigint,
                 'a job scheduled by hand is left alone');
end;
$$;
select * from pg_temp.cron_tests();

-- ── Edge Function invocation without pg_net / Vault ─────────────────────────
create function pg_temp.platform_absent() returns boolean language sql as $$
  select to_regnamespace('net') is null and to_regnamespace('vault') is null;
$$;
delete from ops.warnings;
select is(kc_private.invoke_edge_function('dispatch-notification') is null
  and kc_private.invoke_edge_function('Not A Name') is null and kc_private.invoke_edge_function(null) is null, true,
  'an invocation that cannot be made returns nothing and does not raise');
select is((select string_agg(w.key, ',' order by w.key) from ops.warnings w),
  case when pg_temp.platform_absent() then 'edge_invocation_invalid_name,edge_invocation_unavailable'
       else (select string_agg(w.key, ',' order by w.key) from ops.warnings w) end,
  'and leaves a warning');
select lives_ok($$select kc_private.outbox_enqueue('notification', '{"kind":"zz"}')$$,
  'a notification event is enqueued where nothing can be called');
select is(kc_private.push_dispatch_tick(), not pg_temp.platform_absent(), 'the scheduled start is a no-op there');

-- ── With a stand-in for pg_net and Vault ────────────────────────────────────
create function pg_temp.edge_tests()
returns setof text
language plpgsql
as $$
begin
  if not pg_temp.platform_absent() then
    return query select skip('pg_net / Vault are installed: the stand-in is not used', 10);
    return;
  end if;
  create schema net;
  create table net.calls (id bigint generated always as identity, url text, body jsonb, headers jsonb);
  create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer)
  returns bigint language plpgsql as $f$
  declare v_id bigint;
  begin
    if current_setting('test.net_fails', true) = 'on' then raise exception 'network down'; end if;
    insert into net.calls (url, body, headers) values (url, body, headers) returning id into v_id;
    return v_id;
  end $f$;
  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
  delete from ops.warnings;

  return next is(kc_private.invoke_edge_function('strip-exif'), null, 'without the Vault secrets nothing is called');
  return next is((select count(*) from ops.warnings w where w.key = 'edge_invocation_unconfigured'), 1::bigint,
                 'and a warning says so');
  insert into vault.decrypted_secrets values ('kc_project_url', 'https://project.example/'), ('kc_service_role_key', 'test-key');
  return next is(kc_private.invoke_edge_function('strip-exif', '{"lookbackHours":2}') is not null, true, 'with them the call is queued');
  return next is((select c.url || ' ' || (c.headers ->> 'Authorization') || ' ' || c.body::text from net.calls c),
                 'https://project.example/functions/v1/strip-exif Bearer test-key {"lookbackHours": 2}',
                 'to the function''s URL, with the service key as bearer and the body');

  delete from net.calls;
  insert into kc_private.outbox_events (topic, payload)
  select 'notification', '{"kind":"zz"}' from generate_series(1, 50);
  perform kc_private.outbox_enqueue('notification', '{"kind":"zz"}');
  perform kc_private.outbox_enqueue('audit', '{"action":"zz"}');
  return next is((select count(*) || ' ' || max(c.url) from net.calls c),
                 '1 https://project.example/functions/v1/dispatch-notification',
                 'a burst of notification events starts the dispatcher once; other topics do not');
  update kc_private.edge_function_kicks set last_kick_at = clock_timestamp() - interval '3 seconds';
  perform kc_private.outbox_enqueue('notification', '{"kind":"zz"}');
  perform kc_private.outbox_enqueue('notification', '{"kind":"zz"}', now() + interval '1 hour');
  return next is((select count(*) from net.calls), 2::bigint,
                 'after the debounce period the next due event starts it again; a delayed event does not');
  return next is(kc_private.push_dispatch_tick(), true, 'the scheduled start runs while events are due');
  return next is((select count(*) from net.calls), 3::bigint, 'and calls the dispatcher');

  perform set_config('test.net_fails', 'on', true);
  update kc_private.edge_function_kicks set last_kick_at = '-infinity';
  return next lives_ok($q$select kc_private.outbox_enqueue('notification', '{"kind":"zz"}')$q$,
                       'a failing HTTP call does not fail the insert');
  return next is((select w.detail from ops.warnings w where w.key = 'edge_invocation_failed:dispatch-notification'),
                 'sqlstate P0001', 'it is recorded as a warning, without the error text');
end;
$$;
select * from pg_temp.edge_tests();

select * from finish();
rollback;
