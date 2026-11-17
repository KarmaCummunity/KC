-- External post import · import records are purged after 90 days (FR-IMPORT-009 AC1, KC#2394)
--
-- `public.external_post_imports` keeps one row per extraction attempt (no raw text: the
-- fingerprint and the validated extraction only). The per-member limits and the daily provider
-- budget look back a day at most, so nothing reads an old row; until now nothing removed one.
-- The period is a row of kc_private.retention_rules, like every other retention period, and a
-- nightly job enforces it. The 24-hour extraction cache is cleared by its writer and is not
-- part of this rule.

-- Import records older than p_keep. Returns the number removed. A published post keeps
-- nothing of its import record, so removing the row changes no post.
create function kc_private.external_post_imports_purge(p_keep interval)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows bigint;
begin
  delete from public.external_post_imports i
   where i.created_at < now() - p_keep;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
comment on function kc_private.external_post_imports_purge(interval) is
  'Retention: deletes external post import records older than the period.';

insert into kc_private.retention_rules (name, keep, runnable, enforced_by, description) values
  ('external_post_imports', interval '90 days', true, 'kc_private.external_post_imports_purge',
   'External post import records (fingerprint and validated extraction, no raw text), this long after the attempt (FR-IMPORT-009 AC1).');

-- retention_run learns the import records rule; every other branch is unchanged.
create or replace function kc_private.retention_run(p_rule text)
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
    when 'whatsapp_inbound_claims' then return kc_private.whatsapp_claims_purge(v_rule.keep);
    when 'whatsapp_link_failures' then return kc_private.whatsapp_link_purge(v_rule.keep);
    when 'whatsapp_outbound' then return kc_private.whatsapp_outbound_purge(v_rule.keep);
    when 'whatsapp_bot_sessions' then return kc_private.whatsapp_sessions_purge(v_rule.keep);
    when 'external_post_imports' then return kc_private.external_post_imports_purge(v_rule.keep);
    else
      raise exception 'retention_rule_not_runnable' using errcode = 'P0001', detail = p_rule;
  end case;
end;
$$;

insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description) values
  ('retention_external_post_imports', '5 5 * * *', $$select kc_private.retention_run('external_post_imports')$$,
   interval '5 minutes', interval '36 hours', 'Removes external post import records past 90 days.');
