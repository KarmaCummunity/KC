-- Retention and purge: each rule removes exactly what is past its period and nothing
-- else; deleted posts and accounts past their grace period are purged, idempotently; the
-- storage reconciliation is told only about files no row references.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.err(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
end;
$$;

select plan(29);

delete from ops.job_runs;
delete from ops.warnings;
delete from kc_private.outbox_events;

-- ── The rules ───────────────────────────────────────────────────────────────
select is((select count(*) from kc_private.retention_rules r where r.runnable and r.keep is null), 0::bigint,
  'every runnable rule has a period');
select is((select string_agg(r.name, ',' order by r.name) from kc_private.retention_rules r
            where r.runnable and not exists (select 1 from kc_private.scheduled_jobs j
                                              where j.command = format('select kc_private.retention_run(%L)', r.name))
              and r.name not in ('ops_warnings', 'counter_drift')), null,
  'every runnable rule is scheduled (the three ops rules share one job)');
select is(pg_temp.err($$select kc_private.retention_run('posts_deleted')$$) || '|'
  || pg_temp.err($$select kc_private.retention_run('billing_after_account_deletion')$$) || '|'
  || pg_temp.err($$select kc_private.retention_run('no_such_rule')$$),
  'retention_rule_not_runnable|retention_rule_not_runnable|retention_rule_not_runnable',
  'a documented-only or unknown rule cannot be run');

-- ── Outbox ──────────────────────────────────────────────────────────────────
insert into kc_private.outbox_events (topic, payload, processed_at) values
  ('zz', '{"n":1}', now() - interval '8 days'),
  ('zz', '{"n":2}', now() - interval '6 days'),
  ('zz', '{"n":3}', null);
update kc_private.outbox_events set created_at = now() - interval '30 days', available_at = now() - interval '30 days' where topic = 'zz';
select is(kc_private.retention_run('outbox_processed'), 1::bigint, 'one processed event is past seven days');
select is((select string_agg(payload ->> 'n', ',' order by id) from kc_private.outbox_events where topic = 'zz'), '2,3',
  'a younger processed event and an old unprocessed one stay');

-- ── Rate-limit counters ─────────────────────────────────────────────────────
insert into kc_private.rate_limit_counters (key, window_start, expires_at, hits) values
  ('zz:old', now() - interval '3 hours', now() - interval '2 hours', 1),
  ('zz:recent', now() - interval '1 hour', now() - interval '30 minutes', 1),
  ('zz:live', now(), now() + interval '1 hour', 1);
select is(kc_private.retention_run('rate_limit_counters'), 1::bigint, 'one counter expired longer ago than the period');
select is((select string_agg(key, ',' order by key) from kc_private.rate_limit_counters where key like 'zz:%'),
  'zz:live,zz:recent', 'a live counter and a freshly expired one stay');

-- ── Operational telemetry ───────────────────────────────────────────────────
insert into ops.job_runs (job_name, started_at, finished_at, status, duration_ms) values
  ('zz', now() - interval '31 days', now() - interval '31 days', 'succeeded', 1),
  ('zz', now() - interval '29 days', now() - interval '29 days', 'succeeded', 1);
insert into ops.warnings (key, detail, last_seen) values
  ('zz_old', 'x', now() - interval '31 days'), ('zz_new', 'x', now() - interval '29 days');
insert into ops.counter_drift (counter_table, counter_name, subject_id, stored_value, actual_value, detected_at) values
  ('t', 'c', gen_random_uuid(), 1, 2, now() - interval '91 days'), ('t', 'c', gen_random_uuid(), 1, 2, now() - interval '89 days');
select is(kc_private.retention_run('job_runs'), 3::bigint, 'one old row of each telemetry table is removed');
select is((select count(*) from ops.job_runs) || '/' || (select string_agg(key, ',') from ops.warnings)
  || '/' || (select count(*) from ops.counter_drift), '1/zz_new/1', 'the rows inside their periods stay');

-- ── Partitioned logs ────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || m)::uuid, m || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c']) m;
do $$
begin
  perform kc_private.feed_impressions_ensure_partition((now() - interval '5 months')::date);
  perform kc_private.feed_impressions_ensure_partition((now() - interval '1 month')::date);
  perform kc_private.notifications_ensure_partition((now() - interval '8 months')::date);
  perform kc_private.audit_ensure_partition((now() - interval '26 months')::date);
end $$;
insert into public.feed_impressions (user_id, post_id, seen_at) values
  ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), now() - interval '5 months'),
  ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), now() - interval '1 month'),
  ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), now() - interval '10 months'),
  ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), now());
select is(kc_private.retention_run('feed_impressions'), 1::bigint, 'one impression partition lies wholly before 90 days');
select is((select count(*) from public.feed_impressions), 2::bigint,
  'its rows and the old row of the default partition are gone; recent impressions stay');
select is(kc_private.retention_run('notifications'), 1::bigint, 'one notification partition lies wholly before 180 days');
select is(kc_private.retention_run('audit_events'), 1::bigint, 'one audit partition lies wholly before 24 months');
select is(kc_private.retention_run('audit_events') + kc_private.retention_run('notifications')
  + kc_private.retention_run('feed_impressions'), 0::bigint, 'a second run finds nothing');
select is(pg_temp.err($$select kc_private.audit_drop_partitions_before(current_date)$$), 'retention_too_short',
  'the audit trail cannot be cut shorter than its minimum');
select lives_ok('select kc_private.partitions_ensure(); select kc_private.partitions_ensure()', 'partition maintenance is repeatable');
select is(kc_private.retention_run('cron_run_history') >= 0, true, 'the scheduler''s own log is trimmed (nothing to do without pg_cron)');

-- ── Deleted posts ───────────────────────────────────────────────────────────
insert into public.cities (city_id, name_he, name_en) values ('c1', 'c1', 'City One');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id)
select ('40000000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-4000-8000-00000000000a', 'items',
       '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'post ' || n, 'c1'
  from generate_series(1, 3) n;
insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes) values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a/p1/1.jpg', 0, 'image/jpeg', 1000),
  ('40000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a/p3/1.jpg', 0, 'image/jpeg', 1000);
do $$
begin
  perform set_config('kc.fsm_role', 'owner', true);
  update public.posts set status = 'deleted_no_recipient'
   where id in ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002');
  perform set_config('kc.fsm_role', '', true);
end $$;
update public.post_closures set purge_after = now() - interval '1 hour' where post_id = '40000000-0000-4000-8000-000000000001';
select is(kc_private.posts_purge(), 1, 'one deleted post is past its grace period');
select is((select string_agg(right(id::text, 1), ',' order by id) from public.posts), '2,3',
  'the post still in its grace period and the open post stay');

-- ── Storage reconciliation ──────────────────────────────────────────────────
select is((select string_agg(k, ',' order by k) from kc_private.storage_orphan_keys('post-images', array[
    '00000000-0000-4000-8000-00000000000a/p1/1.jpg', '00000000-0000-4000-8000-00000000000a/p3/1.jpg', 'x/unknown.jpg']) k),
  '00000000-0000-4000-8000-00000000000a/p1/1.jpg,x/unknown.jpg',
  'the file of the purged post and a file never recorded are orphans; a referenced file is not');
select is((select count(*) from kc_private.storage_orphan_keys('chat-media', array['x/unknown.jpg'])), 0::bigint,
  'a bucket whose files are not recorded row by row is never judged');

-- ── Account purge ───────────────────────────────────────────────────────────
update public.user_account
   set status = 'pending_deletion', status_before_deletion = 'active',
       deletion_requested_at = now() - interval '31 days', deletion_purge_at = now() - interval '1 day'
 where user_id = '00000000-0000-4000-8000-00000000000a';
update public.user_account
   set status = 'pending_deletion', status_before_deletion = 'active',
       deletion_requested_at = now() - interval '1 day', deletion_purge_at = now() + interval '29 days'
 where user_id = '00000000-0000-4000-8000-00000000000b';
select is((select string_agg(right(user_id::text, 1), ',') from kc_private.accounts_due_for_purge()), 'a',
  'only the account past its grace period is due');
select is(pg_temp.err($$select kc_private.account_purge_prepare('00000000-0000-4000-8000-00000000000b')$$) || '|'
  || pg_temp.err($$select kc_private.account_purge_finish('00000000-0000-4000-8000-00000000000b')$$) || '|'
  || pg_temp.err($$select kc_private.account_purge_finish('00000000-0000-4000-8000-00000000000c')$$),
  'account_not_due_for_purge|account_not_due_for_purge|account_not_due_for_purge',
  'an account in its grace period, or not deleted at all, cannot be purged');
select lives_ok($$select kc_private.account_purge_prepare('00000000-0000-4000-8000-00000000000a');
                  select kc_private.account_purge_prepare('00000000-0000-4000-8000-00000000000a')$$,
  'preparing the purge can be repeated');
select is((select count(*) || '/' || bool_and(requested_at is not null) from audit.deletion_tombstones
            where user_hash = kc_private.audit_tombstone_hash('00000000-0000-4000-8000-00000000000a')), '1/true',
  'it leaves one tombstone with the request date');
select is((select count(*) from public.users where id = '00000000-0000-4000-8000-00000000000a'), 1::bigint,
  'the account is still there until its files are gone');
select is(kc_private.account_purge_finish('00000000-0000-4000-8000-00000000000a'), true, 'finishing removes the identity');
select is((select count(*) from auth.users where id = '00000000-0000-4000-8000-00000000000a')
  + (select count(*) from public.users where id = '00000000-0000-4000-8000-00000000000a')
  + (select count(*) from public.posts) + (select count(*) from kc_private.accounts_due_for_purge()), 0::bigint,
  'and with it the member, their posts and the due entry');
select is(kc_private.account_purge_finish('00000000-0000-4000-8000-00000000000a'), false,
  'finishing again reports that nothing was left to do');

select * from finish();
rollback;
