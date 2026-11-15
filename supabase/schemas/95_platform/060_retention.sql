-- Platform · retention (design §4.1, §5 "Partitioning")
--
-- Every rule about how long data is kept is one row of kc_private.retention_rules. A rule
-- with `runnable` is enforced by kc_private.retention_run(<name>), which reads the period
-- from the row — changing the period is an update of that row. The other rows document a
-- period that is fixed where the deadline is stamped (the row names that place) and the
-- job that acts on the deadline.

create table kc_private.retention_rules (
  name        text primary key check (name ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- How long rows are kept; null = kept until a decision is taken (see description).
  keep        interval check (keep > interval '0'),
  -- True when kc_private.retention_run(name) enforces the rule with `keep`.
  runnable    boolean not null,
  enforced_by text not null,
  description text not null
);
comment on table kc_private.retention_rules is 'The one list of retention periods and the function that enforces each.';
alter table kc_private.retention_rules enable row level security;
alter table kc_private.retention_rules force row level security;
revoke insert, update, delete, truncate on kc_private.retention_rules from service_role;

insert into kc_private.retention_rules (name, keep, runnable, enforced_by, description) values
  ('outbox_processed', interval '7 days', true, 'kc_private.outbox_purge',
   'Outbox events that were processed. Unprocessed events are never purged: they stay visible to the health checks.'),
  ('notifications', interval '180 days', true, 'kc_private.notifications_purge',
   'Notification centre rows and the dedupe ledger; whole monthly partitions are dropped.'),
  ('feed_impressions', interval '90 days', true, 'kc_private.feed_impressions_purge',
   'Feed impression log (design §3.4); whole monthly partitions are dropped.'),
  ('audit_events', interval '24 months', true, 'kc_private.audit_drop_partitions_before',
   'Audit trail (FR-MOD-012 AC3: at least 24 months); whole monthly partitions are dropped.'),
  ('job_runs', interval '30 days', true, 'kc_private.ops_purge',
   'ops.job_runs rows.'),
  ('ops_warnings', interval '30 days', true, 'kc_private.ops_purge',
   'ops.warnings rows not seen again for this long.'),
  ('counter_drift', interval '90 days', true, 'kc_private.ops_purge',
   'ops.counter_drift rows.'),
  ('rate_limit_counters', interval '1 hour', true, 'kc_private.rate_limit_purge',
   'Rate-limit counters, this long after their window ended.'),
  ('cron_run_history', interval '7 days', true, 'kc_private.cron_history_purge',
   'pg_cron''s own log of runs (cron.job_run_details); ops.job_runs is the record that is kept longer.'),
  ('posts_deleted', interval '7 days', false, 'kc_private.posts_purge',
   'Posts deleted without a recipient. The deadline is stamped on post_closures.purge_after when the post is deleted (25_handoffs); the purge removes posts past it.'),
  ('accounts_pending_deletion', interval '30 days', false, 'Edge Function purge-deleted-accounts',
   'Accounts in their deletion grace period. The deadline is stamped on user_account.deletion_purge_at by request_account_deletion (10_identity).'),
  ('billing_after_account_deletion', null, false, 'none',
   'Money records of purged accounts: kept, no automatic purge, until the legal period is decided (design §12 Q5); the period then lives in billing.settings.');

-- Processed outbox events older than p_keep. Returns the number removed.
create function kc_private.outbox_purge(p_keep interval)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows bigint;
begin
  delete from kc_private.outbox_events e
   where e.processed_at is not null and e.processed_at < now() - p_keep;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
comment on function kc_private.outbox_purge(interval) is 'Retention: deletes processed outbox events older than the period.';

-- Drops the monthly partitions of feed_impressions that lie entirely before the period and
-- deletes older rows left in the default partition. Returns the number of partitions dropped.
create function kc_private.feed_impressions_purge(p_keep interval)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff constant timestamptz := now() - p_keep;
  v_partition text;
  v_dropped integer := 0;
begin
  for v_partition in
    select c.relname
      from pg_catalog.pg_inherits i
      join pg_catalog.pg_class c on c.oid = i.inhrelid
     where i.inhparent = 'public.feed_impressions'::regclass
       and c.relname ~ '^feed_impressions_[0-9]{4}_[0-9]{2}$'
       and (to_date(right(c.relname, 7), 'YYYY_MM') + interval '1 month')::timestamp at time zone 'UTC' <= v_cutoff
  loop
    execute format('drop table public.%I', v_partition);
    v_dropped := v_dropped + 1;
  end loop;
  delete from public.feed_impressions_default d where d.seen_at < v_cutoff;
  return v_dropped;
end;
$$;
comment on function kc_private.feed_impressions_purge(interval) is
  'Retention: drops feed_impressions partitions older than the period.';

-- Operational telemetry past its periods. Returns the number of rows removed.
create function kc_private.ops_purge(p_job_runs interval, p_warnings interval, p_counter_drift interval)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows bigint;
  v_total bigint := 0;
begin
  delete from ops.job_runs r where r.finished_at < now() - p_job_runs;
  get diagnostics v_rows = row_count;
  v_total := v_total + v_rows;
  delete from ops.warnings w where w.last_seen < now() - p_warnings;
  get diagnostics v_rows = row_count;
  v_total := v_total + v_rows;
  delete from ops.counter_drift d where d.detected_at < now() - p_counter_drift;
  get diagnostics v_rows = row_count;
  return v_total + v_rows;
end;
$$;
comment on function kc_private.ops_purge(interval, interval, interval) is
  'Retention: deletes old job runs, warnings and counter drift rows.';

-- Rate-limit counters whose window ended more than p_keep ago.
create function kc_private.rate_limit_purge(p_keep interval)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows bigint;
begin
  delete from kc_private.rate_limit_counters c where c.expires_at < now() - p_keep;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
comment on function kc_private.rate_limit_purge(interval) is 'Retention: deletes expired rate-limit counters.';

-- pg_cron's run log older than p_keep; nothing to do on a server without pg_cron.
create function kc_private.cron_history_purge(p_keep interval)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows bigint := 0;
begin
  if to_regclass('cron.job_run_details') is not null then
    execute 'delete from cron.job_run_details d where d.end_time < now() - $1' using p_keep;
    get diagnostics v_rows = row_count;
  end if;
  return v_rows;
end;
$$;
comment on function kc_private.cron_history_purge(interval) is 'Retention: trims pg_cron''s run log.';

-- Hard delete of posts deleted without a recipient whose grace period ended (design §4.1.5).
-- Everything that hangs on the post goes with it by cascade; its files are then no longer
-- referenced and are removed from storage by the orphan reconciliation. Returns the number
-- of posts removed.
create function kc_private.posts_purge(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  delete from public.posts p
   where p.id in (select d from kc_private.posts_due_for_purge(p_limit) d);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
comment on function kc_private.posts_purge(integer) is
  'Deletes deleted_no_recipient posts past their grace period; storage files follow through the orphan job.';

-- Enforces one runnable rule with the period of its row. Returns what the enforcing
-- function reports (rows or partitions removed).
create function kc_private.retention_run(p_rule text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule kc_private.retention_rules;
begin
  select r.* into v_rule from kc_private.retention_rules r where r.name = p_rule;
  if not found or not v_rule.runnable or v_rule.keep is null then
    raise exception 'retention_rule_not_runnable' using errcode = 'P0001', detail = p_rule;
  end if;
  case p_rule
    when 'outbox_processed' then return kc_private.outbox_purge(v_rule.keep);
    when 'notifications' then return kc_private.notifications_purge(v_rule.keep);
    when 'feed_impressions' then return kc_private.feed_impressions_purge(v_rule.keep);
    when 'audit_events' then
      return kc_private.audit_drop_partitions_before((now() - v_rule.keep)::date);
    when 'job_runs', 'ops_warnings', 'counter_drift' then
      return kc_private.ops_purge(
        (select r.keep from kc_private.retention_rules r where r.name = 'job_runs'),
        (select r.keep from kc_private.retention_rules r where r.name = 'ops_warnings'),
        (select r.keep from kc_private.retention_rules r where r.name = 'counter_drift'));
    when 'rate_limit_counters' then return kc_private.rate_limit_purge(v_rule.keep);
    when 'cron_run_history' then return kc_private.cron_history_purge(v_rule.keep);
    else
      raise exception 'retention_rule_not_runnable' using errcode = 'P0001', detail = p_rule;
  end case;
end;
$$;
comment on function kc_private.retention_run(text) is
  'Enforces a retention rule of kc_private.retention_rules with the period stored on its row.';

-- ── Partition maintenance ────────────────────────────────────────────────────
-- Creates the partitions of the current and the next month for the three partitioned logs.
-- Run daily, so a month is prepared weeks ahead and a missed run is repaired by the next.
create function kc_private.partitions_ensure()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date;
begin
  foreach v_month in array array[
    date_trunc('month', now() at time zone 'UTC')::date,
    (date_trunc('month', now() at time zone 'UTC') + interval '1 month')::date]
  loop
    perform kc_private.feed_impressions_ensure_partition(v_month);
    perform kc_private.notifications_ensure_partition(v_month);
    perform kc_private.audit_ensure_partition(v_month);
  end loop;
end;
$$;
comment on function kc_private.partitions_ensure() is
  'Creates this month''s and next month''s partitions of feed_impressions, notifications and audit.events.';

-- feed_impressions starts with its default partition only; give it its first two months.
do $$ begin perform kc_private.partitions_ensure(); end $$;
