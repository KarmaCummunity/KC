-- WhatsApp match alerts, jobs, retention and health (whatsapp_match_alerts_and_jobs): a
-- delivered match_suggested / match_accepted notification queues its template with the
-- right params, through the partitioned notifications table; a member's opt-out of the kind
-- and a member without a number get nothing; the sender job starts only when there is work;
-- every WhatsApp retention rule removes exactly what is past its period; the backlog check.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.uid(p_who text)
returns uuid
language sql
as $$ select ('00000000-0000-4000-8000-0000000000' || to_hex(ascii(p_who)))::uuid; $$;

-- Delivers one notification event as the push worker would; returns the delivery status.
create function pg_temp.deliver(p_kind text, p_to text, p_actor text, p_data jsonb)
returns text
language sql
as $$
  select kc_private.notifications_deliver(kc_private.outbox_enqueue('notification', jsonb_build_object(
    'kind', p_kind, 'recipient_id', pg_temp.uid(p_to), 'actor_id', case when p_actor is not null then pg_temp.uid(p_actor) end,
    'entity', jsonb_build_object('type', 'match', 'id', '60000000-0000-4000-8000-000000000001'),
    'data', p_data || jsonb_build_object('dedupe_key', p_kind || ':' || p_to || ':' || gen_random_uuid())))) ->> 'status';
$$;

-- Templates queued for a member: 'template:status' in order.
create function pg_temp.queued(p_who text)
returns text
language sql
as $$
  select string_agg(o.template_name || ':' || o.status, ',' order by o.template_name)
    from integrations.whatsapp_outbound_messages o where o.user_id = pg_temp.uid(p_who);
$$;

create function pg_temp.health()
returns text
language sql
as $$
  select h.status || coalesce(': ' || h.measured, '')
    from ops.run_health_checks() h where h.check_name = 'whatsapp_outbound_backlog';
$$;

select plan(28);

delete from ops.warnings;

-- a offers, b asks; c turned match suggestions off; d has no WhatsApp number.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select pg_temp.uid(x), 'u' || x || '@example.test', '{"provider":"google"}', jsonb_build_object('full_name', 'Member ' || upper(x))
  from unnest(array['a', 'b', 'c', 'd']) x;
update public.user_private set notification_preferences = '{"kinds": {"match_suggested": false}}' where user_id = pg_temp.uid('c');
insert into public.cities (city_id, name_he, name_en) values ('c1', 'c1', 'City One');
insert into public.worlds (slug, label_he, label_en) values ('items', 'חפצים', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id) values
  ('10000000-0000-4000-8000-000000000001', pg_temp.uid('a'), 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'blue stroller', 'c1'),
  ('10000000-0000-4000-8000-000000000002', pg_temp.uid('b'), 'items', '20000000-0000-4000-8000-000000000001', 'request', 'open', 'a stroller', 'c1');
insert into kc_private.match_candidates (id, offer_post_id, request_post_id, offer_owner_id, request_owner_id, world_slug, score)
values ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
        pg_temp.uid('a'), pg_temp.uid('b'), 'items', 0.9);
insert into integrations.whatsapp_identities (wa_id, user_id, preferred_language) values
  ('972500000001', pg_temp.uid('a'), 'en'), ('972500000002', pg_temp.uid('b'), 'he'), ('972500000003', pg_temp.uid('c'), 'he');
insert into integrations.whatsapp_consents (user_id, opted_in) values
  (pg_temp.uid('a'), true), (pg_temp.uid('b'), true), (pg_temp.uid('c'), true), (pg_temp.uid('d'), true);
update integrations.whatsapp_message_templates set meta_status = 'approved';

-- ── The trigger sits on every partition ─────────────────────────────────────
select is((select count(*) from pg_inherits i
            where i.inhparent = 'public.notifications'::regclass
              and not exists (select 1 from pg_trigger t where t.tgrelid = i.inhrelid and t.tgname = 'notifications_whatsapp_notify')),
  0::bigint, 'every partition of notifications carries the WhatsApp trigger');
select kc_private.notifications_ensure_partition((current_date + interval '3 months')::date);
select is((select count(*) from pg_trigger t
            where t.tgname = 'notifications_whatsapp_notify'
              and t.tgrelid = to_regclass('kc_private.notifications_y' || to_char(current_date + interval '3 months', 'YYYY"m"MM'))),
  1::bigint, 'and a partition created later gets it too');

-- ── Match alerts end to end ─────────────────────────────────────────────────
select is(pg_temp.deliver('match_suggested', 'b', null, '{"world_slug": "items", "post_id": "10000000-0000-4000-8000-000000000001"}'),
  'delivered', 'a match suggestion is delivered to the centre');
select is(pg_temp.queued('b'), 'match_found_v1:skipped_channel_disabled',
  'and mirrored to WhatsApp, recorded as skipped while the channel is off');
update integrations.whatsapp_channel_config set is_enabled = true;
select is(pg_temp.deliver('match_suggested', 'a', null, '{"world_slug": "items"}'), 'delivered', 'with the channel on');
select is(pg_temp.queued('a'), 'match_found_v1:queued', 'the template is queued');
select is((select language || '|' || (payload ->> 'world_label_he') || '|' || (payload ->> 'world_label_en')
             from integrations.whatsapp_outbound_messages where user_id = pg_temp.uid('a')),
  'en|חפצים|Items', 'in the member''s language, with the world label in both languages');
select is(pg_temp.deliver('match_accepted', 'b', 'a', '{"post_id": "10000000-0000-4000-8000-000000000001"}'), 'delivered',
  'a mutual accept is delivered');
select is((select payload ->> 'partner_name' || '|' || (payload ->> 'listing_title') from integrations.whatsapp_outbound_messages
            where user_id = pg_temp.uid('b') and template_name = 'confirm_handoff_v1'),
  'Member A|blue stroller', 'and queues the handoff confirmation with the partner and the offer');
select is(pg_temp.deliver('match_suggested', 'c', null, '{"world_slug": "items"}') || ':' || coalesce(pg_temp.queued('c'), 'none'),
  'skipped:none', 'a member who turned match suggestions off gets neither the notification nor WhatsApp (FR-NOTIF-017 AC4)');
select is(pg_temp.deliver('match_suggested', 'd', null, '{"world_slug": "items"}') || ':' || coalesce(pg_temp.queued('d'), 'none'),
  'delivered:none', 'a member without a WhatsApp number gets no outbound row at all');
select is(pg_temp.deliver('match_interest', 'b', 'a', '{}') || ':' || pg_temp.queued('b'),
  'delivered:confirm_handoff_v1:queued,match_found_v1:skipped_channel_disabled', 'other kinds are not mirrored');
delete from integrations.whatsapp_notification_templates where kind = 'match_suggested';
insert into integrations.whatsapp_notification_templates values ('match_suggested', 'no_such_v1', 'world_label');
select is(pg_temp.deliver('match_suggested', 'a', null, '{"world_slug": "items"}') || ':' || pg_temp.queued('a'),
  'delivered:match_found_v1:queued,no_such_v1:skipped_template_unapproved',
  'an unknown template is recorded as unapproved, never a failed delivery');

-- ── Sender job ──────────────────────────────────────────────────────────────
select is((select string_agg(name || ':' || enabled, ',' order by name) from kc_private.scheduled_jobs where name like '%whatsapp%'),
  'retention_whatsapp_claims:true,retention_whatsapp_inbound:true,retention_whatsapp_link_failures:true,'
  || 'retention_whatsapp_outbound:true,whatsapp_send:true', 'the sender and the four retention jobs are registered');
delete from ops.warnings;
update integrations.whatsapp_channel_config set is_enabled = false;
select is(kc_private.whatsapp_send_tick() || ':' || (select count(*) from ops.warnings), 'false:0',
  'with the channel off the sender is not started');
update integrations.whatsapp_channel_config set is_enabled = true;
create temporary table t_tick as select kc_private.whatsapp_send_tick() as started;
select is((select started from t_tick) or exists (select 1 from ops.warnings w where w.detail like '%whatsapp-sender%'), true,
  'with the channel on and a message due it is started (a warning where the platform cannot call out)');
select is(kc_private.job_run('whatsapp_send'), true, 'the job itself succeeds');

-- ── Health ──────────────────────────────────────────────────────────────────
select is(pg_temp.health(), 'ok: 0', 'a fresh queue is healthy');
update integrations.whatsapp_outbound_messages set next_attempt_at = now() - interval '10 minutes' where status = 'queued';
select is(pg_temp.health(), 'failing: 2', 'messages due for longer than five minutes fail the check');
update integrations.whatsapp_channel_config set is_enabled = false;
select is(pg_temp.health(), 'ok: 0', 'a switched-off channel is not a backlog');

-- ── Retention ───────────────────────────────────────────────────────────────
select is((select string_agg(name || ':' || keep || ':' || runnable, ',' order by name) from kc_private.retention_rules
            where name like 'whatsapp%'),
  'whatsapp_inbound_claims:7 days:true,whatsapp_inbound_messages:90 days:false,whatsapp_link_failures:1 day:true,'
  || 'whatsapp_outbound:180 days:true', 'the four WhatsApp retention rules');
insert into integrations.whatsapp_inbound_claims (message_id, claimed_at) values
  ('old', now() - interval '8 days'), ('young', now() - interval '6 days');
select is(kc_private.retention_run('whatsapp_inbound_claims'), 1::bigint, 'claims past seven days are removed');
insert into integrations.whatsapp_link_failures (wa_id, failed_at) values ('1', now() - interval '2 days'), ('1', now());
insert into integrations.whatsapp_link_codes (user_id, code_hash, expires_at) values
  (pg_temp.uid('a'), repeat('a', 64), now() - interval '1 minute'), (pg_temp.uid('b'), repeat('b', 64), now() + interval '5 minutes');
select is(kc_private.retention_run('whatsapp_link_failures'), 2::bigint, 'old failures and expired codes are removed');
select is((select count(*) from integrations.whatsapp_link_failures) || ':' || (select count(*) from integrations.whatsapp_link_codes),
  '1:1', 'a recent failure and a live code stay');
update integrations.whatsapp_outbound_messages set created_at = now() - interval '181 days';
select is(kc_private.retention_run('whatsapp_outbound'), 2::bigint, 'finished outbound rows past 180 days are removed');
select is((select string_agg(status, ',') from integrations.whatsapp_outbound_messages), 'queued,queued',
  'rows still waiting to be sent are kept');
insert into integrations.whatsapp_inbound_messages (message_id, payload, retain_until) values
  ('m-old', '{}', now() - interval '1 second'), ('m-new', '{}', now() + interval '1 day');
select is(kc_private.whatsapp_inbound_purge(), 1, 'inbound payloads past retain_until are removed');
select is((select string_agg(message_id, ',') from integrations.whatsapp_inbound_messages), 'm-new', 'younger ones stay');

select * from finish();
rollback;
