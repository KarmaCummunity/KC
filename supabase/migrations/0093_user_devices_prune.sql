-- Push devices · prune tokens not seen for 90 days (FR-NOTIF-015 AC4, KC#2519)
--
-- `public.user_devices.last_seen_at` is refreshed on registration and app start (#2517).
-- Stale tokens were only removed when the push provider reported them dead
-- (`kc_private.notification_push_settle` / forget_devices). A device that is gone but never
-- reported kept its row forever, and dispatch kept sending to it. The period is a row of
-- kc_private.retention_rules; a daily job enforces it. Spec name `bg-job-token-prune` maps
-- to the registry job `retention_user_devices` (same naming as every other retention job).

-- Devices whose last_seen_at is older than p_keep. Returns the number removed.
create function kc_private.user_devices_purge(p_keep interval)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows bigint;
begin
  delete from public.user_devices d
   where d.last_seen_at < now() - p_keep;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
comment on function kc_private.user_devices_purge(interval) is
  'Retention: deletes push device tokens not seen for longer than the period (FR-NOTIF-015 AC4).';

insert into kc_private.retention_rules (name, keep, runnable, enforced_by, description) values
  ('user_devices', interval '90 days', true, 'kc_private.user_devices_purge',
   'Push device tokens (FR-NOTIF-015 AC4), this long after last_seen_at.');

-- retention_run learns the user_devices rule; every other branch is unchanged.
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
    when 'user_devices' then return kc_private.user_devices_purge(v_rule.keep);
    else
      raise exception 'retention_rule_not_runnable' using errcode = 'P0001', detail = p_rule;
  end case;
end;
$$;

insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description) values
  ('retention_user_devices', '15 5 * * *', $$select kc_private.retention_run('user_devices')$$,
   interval '5 minutes', interval '36 hours',
   'Removes push device tokens not seen for 90 days (FR-NOTIF-015 AC4 / bg-job-token-prune).');
