-- WhatsApp bot · match alerts keep the member's quiet hours; bot sessions kept 180 days (M22 / L7)
--
-- Quiet hours (FR-NOTIF-017 AC4, spec 07 §7.11): a WhatsApp match alert already follows the
-- member's notification preferences, because it is queued from the delivered notification row.
-- It now also keeps the member's own quiet hours, as the push does: during the window the
-- template is still queued, with next_attempt_at at the end of the window (the member's time
-- zone, Israel time by default), and api_whatsapp_outbound_claim / whatsapp_send_tick pick it
-- up only from then. A kind that passes quiet hours for the push (bypass_preferences or
-- bypass_quiet_hours, D95) passes them here too. Whether a moment is inside the window is
-- decided by kc_private.notification_in_quiet_hours, the push path's own helper.
--
-- Retention (D160 as approved): bot conversation sessions, which hold the draft text a member
-- sent, are deleted 180 days after their last change. A session whose review item is still
-- pending stays until staff decide it; the post and its origin row stay (session_id is set null).

-- ── Quiet hours ─────────────────────────────────────────────────────────────
-- When the quiet window that p_at falls in ends, or null when p_at is outside quiet hours
-- (or they are off). The window is the one kc_private.notification_in_quiet_hours reads.
create function kc_private.notification_quiet_hours_end(p_preferences jsonb, p_at timestamptz default now())
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_quiet constant jsonb := p_preferences -> 'quietHours';
  v_zone text;
  v_end time;
  v_local timestamp;
  v_until timestamptz;
begin
  if not kc_private.notification_in_quiet_hours(p_preferences, p_at) then
    return null;
  end if;
  v_zone := coalesce(v_quiet ->> 'timezone', 'Asia/Jerusalem');
  v_end := coalesce(v_quiet ->> 'end', '08:00')::time;
  v_local := p_at at time zone v_zone;
  -- The next local `end` after p_at: today's when the window ends later today, else tomorrow's.
  v_until := (v_local::date + v_end) at time zone v_zone;
  if v_until <= p_at then
    v_until := ((v_local::date + 1) + v_end) at time zone v_zone;
  end if;
  return v_until;
exception when others then
  return null;
end;
$$;
comment on function kc_private.notification_quiet_hours_end(jsonb, timestamptz) is
  'End of the quiet window the moment falls in, or null outside quiet hours.';

-- The same trigger as before, plus the quiet-hours deferral of the queued template.
create or replace function kc_private.whatsapp_notify_from_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map integrations.whatsapp_notification_templates;
  v_kind kc_private.notification_kinds;
  v_until timestamptz;
  v_id uuid;
begin
  select t.* into v_map from integrations.whatsapp_notification_templates t where t.kind = new.kind;
  if not found or not exists (select 1 from integrations.whatsapp_identities i where i.user_id = new.user_id) then
    return null;
  end if;
  select k.* into v_kind from kc_private.notification_kinds k where k.kind = new.kind;
  if not coalesce(v_kind.bypass_preferences or v_kind.bypass_quiet_hours, false) then
    select kc_private.notification_quiet_hours_end(p.notification_preferences) into v_until
      from public.user_private p where p.user_id = new.user_id;
  end if;
  v_id := kc_private.whatsapp_queue_template(
    new.user_id, v_map.template_name, kc_private.whatsapp_notification_params(v_map.param_builder, new.entity_id, new.world_slug, new.actor_ids[1]));
  if v_until is not null then
    update integrations.whatsapp_outbound_messages o set next_attempt_at = v_until
     where o.id = v_id and o.status = 'queued';
  end if;
  return null;
exception when others then
  perform kc_private.ops_warn('whatsapp_notify_failed', sqlstate || ': ' || sqlerrm);
  return null;
end;
$$;
comment on function kc_private.whatsapp_notify_from_notification() is
  'AFTER INSERT on notifications: queues the WhatsApp template of a mirrored kind, held to the end of quiet hours; never fails the insert.';

-- ── Retention of bot sessions ───────────────────────────────────────────────
-- Sessions unchanged for longer than p_keep, unless a review item of theirs is still pending.
create function kc_private.whatsapp_sessions_purge(p_keep interval)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows bigint;
begin
  delete from integrations.bot_conversation_sessions s
   where s.updated_at < now() - p_keep
     and not exists (select 1 from integrations.bot_review_items r
                      where r.session_id = s.id and r.status = 'pending');
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
comment on function kc_private.whatsapp_sessions_purge(interval) is
  'Retention: deletes WhatsApp bot sessions (draft text) past the period, except those pending review.';

insert into kc_private.retention_rules (name, keep, runnable, enforced_by, description) values
  ('whatsapp_bot_sessions', interval '180 days', true, 'kc_private.whatsapp_sessions_purge',
   'WhatsApp bot conversation sessions and the draft text they hold, after their last change; a session pending staff review stays.');

-- retention_run learns the bot sessions rule; every other branch is unchanged.
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
    else
      raise exception 'retention_rule_not_runnable' using errcode = 'P0001', detail = p_rule;
  end case;
end;
$$;

insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description) values
  ('retention_whatsapp_bot_sessions', '55 4 * * *', $$select kc_private.retention_run('whatsapp_bot_sessions')$$,
   interval '5 minutes', interval '36 hours', 'Removes WhatsApp bot sessions (draft text) past 180 days.');
