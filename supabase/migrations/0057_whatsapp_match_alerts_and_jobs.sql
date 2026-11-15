-- WhatsApp bot · match alerts, the sender job, retention and health (M22 / L7)
--
-- Match alerts on WhatsApp ride on the notification centre instead of the matching module:
-- a row of `public.notifications` of a kind listed in integrations.whatsapp_notification_templates
-- (match_suggested → match_found_v1, match_accepted → confirm_handoff_v1) queues the template
-- for its member. A notification row exists only when the member's preferences allow its
-- kind (kc_private.notifications_deliver), so the per-kind opt-out of FR-NOTIF-017 AC4 and
-- the daily cap of match_announce hold for WhatsApp too. Members without a WhatsApp number
-- are skipped before any row is written. The trigger can never fail the notification.
--
-- Jobs: whatsapp_send starts the whatsapp-sender Edge Function each minute, only while the
-- channel is on and a message is due; four retention jobs keep the inbound log 90 days, the
-- claims 7 days, link failures 1 day (and expired codes) and the outbound log 180 days.
-- Health: whatsapp_outbound_backlog fails when a due message waited longer than its period.

-- ── Match alerts ────────────────────────────────────────────────────────────
-- The template params of a notification: {world_label_he, world_label_en, world} for a new
-- match, {partner_name, listing_title} for a mutual accept (the offer's title).
-- Scalars, not the row: a trigger on a partition sees the partition's own row type.
create function kc_private.whatsapp_notification_params(
  p_builder text, p_match_id uuid, p_world_slug text, p_actor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_match kc_private.match_candidates;
  v_world public.worlds;
begin
  select m.* into v_match from kc_private.match_candidates m where m.id = p_match_id;
  if p_builder = 'world_label' then
    select w.* into v_world from public.worlds w where w.slug = coalesce(p_world_slug, v_match.world_slug);
    return jsonb_build_object('world', v_world.slug, 'world_label_he', v_world.label_he,
                              'world_label_en', v_world.label_en, 'world_label', v_world.label_he);
  end if;
  return jsonb_build_object(
    'partner_name', (select u.display_name from public.users u where u.id = p_actor_id),
    'listing_title', (select p.title from public.posts p where p.id = v_match.offer_post_id),
    'match_id', v_match.id);
end;
$$;
comment on function kc_private.whatsapp_notification_params(text, uuid, text, uuid) is
  'Template params of a notification mirrored to WhatsApp.';

create function kc_private.whatsapp_notify_from_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map integrations.whatsapp_notification_templates;
begin
  select t.* into v_map from integrations.whatsapp_notification_templates t where t.kind = new.kind;
  if not found or not exists (select 1 from integrations.whatsapp_identities i where i.user_id = new.user_id) then
    return null;
  end if;
  perform kc_private.whatsapp_queue_template(
    new.user_id, v_map.template_name, kc_private.whatsapp_notification_params(v_map.param_builder, new.entity_id, new.world_slug, new.actor_ids[1]));
  return null;
exception when others then
  perform kc_private.ops_warn('whatsapp_notify_failed', sqlstate || ': ' || sqlerrm);
  return null;
end;
$$;
comment on function kc_private.whatsapp_notify_from_notification() is
  'AFTER INSERT on notifications: queues the WhatsApp template of a mirrored kind; never fails the insert.';

-- Row triggers on the partitioned parent are cloned to every partition, present and future.
create trigger notifications_whatsapp_notify
  after insert on public.notifications
  for each row when (new.kind in ('match_suggested', 'match_accepted'))
  execute function kc_private.whatsapp_notify_from_notification();

-- ── Sender start ────────────────────────────────────────────────────────────
-- Starts whatsapp-sender while the channel is on and a message is due (a queued row whose
-- time has come, or a claim left behind). Returns whether a call was queued.
create function kc_private.whatsapp_send_tick()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not kc_private.whatsapp_channel_enabled() or not exists (
       select 1 from integrations.whatsapp_outbound_messages o
        where (o.status = 'queued' and o.next_attempt_at <= now())
           or (o.status = 'sending' and o.claimed_at < now() - interval '1 minute')) then
    return false;
  end if;
  return kc_private.invoke_edge_function('whatsapp-sender') is not null;
end;
$$;
comment on function kc_private.whatsapp_send_tick() is
  'Scheduled every minute: starts whatsapp-sender when the channel is on and a message is due.';

-- ── Retention ───────────────────────────────────────────────────────────────
-- Inbound messages past their retain_until (stamped at ingest from the rule's period).
create function kc_private.whatsapp_inbound_purge(p_limit integer default 5000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  delete from integrations.whatsapp_inbound_messages m
   where m.id in (select x.id from integrations.whatsapp_inbound_messages x
                   where x.retain_until < now() order by x.retain_until limit greatest(p_limit, 1));
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
comment on function kc_private.whatsapp_inbound_purge(integer) is 'Retention: deletes inbound WhatsApp messages past retain_until.';

create function kc_private.whatsapp_claims_purge(p_keep interval)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows bigint;
begin
  delete from integrations.whatsapp_inbound_claims c where c.claimed_at < now() - p_keep;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
comment on function kc_private.whatsapp_claims_purge(interval) is 'Retention: deletes old inbound message claims.';

-- Failed link attempts older than p_keep, and link codes that expired.
create function kc_private.whatsapp_link_purge(p_keep interval)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failures bigint;
  v_codes bigint;
begin
  delete from integrations.whatsapp_link_failures f where f.failed_at < now() - p_keep;
  get diagnostics v_failures = row_count;
  delete from integrations.whatsapp_link_codes c where c.expires_at < now();
  get diagnostics v_codes = row_count;
  return v_failures + v_codes;
end;
$$;
comment on function kc_private.whatsapp_link_purge(interval) is 'Retention: deletes old failed link attempts and expired link codes.';

-- Outbound messages older than p_keep that are no longer waiting or being sent.
create function kc_private.whatsapp_outbound_purge(p_keep interval)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows bigint;
begin
  delete from integrations.whatsapp_outbound_messages o
   where o.created_at < now() - p_keep and o.status not in ('queued', 'sending');
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
comment on function kc_private.whatsapp_outbound_purge(interval) is 'Retention: deletes finished WhatsApp outbound rows past the period.';

insert into kc_private.retention_rules (name, keep, runnable, enforced_by, description) values
  ('whatsapp_inbound_messages', interval '90 days', false, 'kc_private.whatsapp_inbound_purge',
   'Inbound WhatsApp payloads. The deadline is stamped on whatsapp_inbound_messages.retain_until by api_whatsapp_ingest_inbound from this period; the purge removes rows past it.'),
  ('whatsapp_inbound_claims', interval '7 days', true, 'kc_private.whatsapp_claims_purge',
   'Message ids claimed by the webhook; only Meta''s retry window (hours) needs them.'),
  ('whatsapp_link_failures', interval '1 day', true, 'kc_private.whatsapp_link_purge',
   'Failed WhatsApp link-code attempts (the lockout looks back one hour); expired link codes go in the same run.'),
  ('whatsapp_outbound', interval '180 days', true, 'kc_private.whatsapp_outbound_purge',
   'WhatsApp outbound log (templates and replies) once sent, failed or skipped.');

-- retention_run learns the three runnable WhatsApp rules; every other branch is unchanged.
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
    else
      raise exception 'retention_rule_not_runnable' using errcode = 'P0001', detail = p_rule;
  end case;
end;
$$;

-- ── Jobs ────────────────────────────────────────────────────────────────────
insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description) values
  ('whatsapp_send', '* * * * *', 'select kc_private.whatsapp_send_tick()',
   interval '20 seconds', interval '10 minutes',
   'Starts whatsapp-sender while the WhatsApp channel is on and a message is due; a no-op otherwise.'),
  ('retention_whatsapp_inbound', '25 4 * * *', 'select kc_private.whatsapp_inbound_purge()',
   interval '5 minutes', interval '36 hours', 'Removes inbound WhatsApp payloads past 90 days.'),
  ('retention_whatsapp_claims', '35 * * * *', $$select kc_private.retention_run('whatsapp_inbound_claims')$$,
   interval '1 minute', interval '4 hours', 'Removes WhatsApp message claims past 7 days.'),
  ('retention_whatsapp_link_failures', '*/30 * * * *', $$select kc_private.retention_run('whatsapp_link_failures')$$,
   interval '1 minute', interval '2 hours', 'Removes failed WhatsApp link attempts past a day and expired link codes.'),
  ('retention_whatsapp_outbound', '45 4 * * *', $$select kc_private.retention_run('whatsapp_outbound')$$,
   interval '5 minutes', interval '36 hours', 'Removes finished WhatsApp outbound rows past 180 days.');

-- ── Health ──────────────────────────────────────────────────────────────────
insert into ops.health_checks (name, description, max_allowed, period, failure_means) values
  ('whatsapp_outbound_backlog', 'WhatsApp messages due longer than the period while the channel is on.', 0,
   interval '5 minutes',
   'whatsapp-sender is not running or cannot send: check the whatsapp_send job, the Edge Function logs and the Meta token.');

create function ops.whatsapp_health_measurements()
returns table (check_name text, measured bigint, detail text)
language sql
stable
security definer
set search_path = ''
as $$
  select 'whatsapp_outbound_backlog', count(*),
         'oldest ' || date_trunc('second', now() - min(o.next_attempt_at))::text
    from integrations.whatsapp_outbound_messages o
   where kc_private.whatsapp_channel_enabled()
     and o.status in ('queued', 'sending')
     and o.next_attempt_at < now() - (select c.period from ops.health_checks c where c.name = 'whatsapp_outbound_backlog');
$$;
comment on function ops.whatsapp_health_measurements() is 'Measures the WhatsApp health checks; internal to ops.run_health_checks().';

-- run_health_checks also reads the WhatsApp measurements.
create or replace function ops.run_health_checks()
returns table (check_name text, status text, measured bigint, max_allowed bigint, detail text, failure_means text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.name,
         case when m.check_name is null then 'skipped'
              when m.measured > c.max_allowed then 'failing'
              else 'ok' end,
         m.measured, c.max_allowed, m.detail, c.failure_means
    from ops.health_checks c
    left join (select * from ops.health_measurements()
               union all select * from ops.whatsapp_health_measurements()) m on m.check_name = c.name
   order by c.name;
$$;
