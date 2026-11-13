-- WhatsApp match alerts keep the member's quiet hours, and bot sessions are kept 180 days
-- (whatsapp_alert_quiet_hours_and_session_retention): the end of a quiet window (same day,
-- across midnight, outside, disabled), a match alert deferred to that end and not claimed by
-- the sender before it, an alert outside the window or with quiet hours off sent at once, a
-- kind that bypasses quiet hours, and the retention of bot sessions.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.uid(p_who text)
returns uuid
language sql
as $$ select ('00000000-0000-4000-8000-0000000000' || to_hex(ascii(p_who)))::uuid; $$;

-- Quiet-hours preferences from local HH:MI times in Israel.
create function pg_temp.quiet(p_start text, p_end text, p_enabled boolean default true)
returns jsonb
language sql
as $$ select jsonb_build_object('quietHours', jsonb_build_object('enabled', p_enabled, 'start', p_start, 'end', p_end)); $$;

-- Israel local time `p_offset` from now, as HH:MI.
create function pg_temp.local_hm(p_offset interval)
returns text
language sql
as $$ select to_char((now() + p_offset) at time zone 'Asia/Jerusalem', 'HH24:MI'); $$;

create function pg_temp.deliver(p_kind text, p_to text)
returns text
language sql
as $$
  select kc_private.notifications_deliver(kc_private.outbox_enqueue('notification', jsonb_build_object(
    'kind', p_kind, 'recipient_id', pg_temp.uid(p_to), 'actor_id', null,
    'entity', jsonb_build_object('type', 'match', 'id', '60000000-0000-4000-8000-000000000001'),
    'data', jsonb_build_object('world_slug', 'items', 'dedupe_key', p_kind || ':' || p_to || ':' || gen_random_uuid())))) ->> 'status';
$$;

-- When the member's queued template is due: 'deferred <timestamptz>' or 'now'.
create function pg_temp.due(p_who text)
returns text
language sql
as $$
  select string_agg(case when o.next_attempt_at > now() then 'deferred ' || o.next_attempt_at::text else 'now' end
                    || ':' || o.status, ',')
    from integrations.whatsapp_outbound_messages o where o.user_id = pg_temp.uid(p_who);
$$;

select plan(16);

-- ── The end of a quiet window ───────────────────────────────────────────────
-- 2026-11-13 is winter time in Israel (UTC+2).
select is(kc_private.notification_quiet_hours_end(pg_temp.quiet('22:00', '08:00'), '2026-11-13 21:00Z'),
  '2026-11-14 06:00Z'::timestamptz, 'a window crossing midnight, entered before midnight, ends next morning');
select is(kc_private.notification_quiet_hours_end(pg_temp.quiet('22:00', '08:00'), '2026-11-14 01:00Z'),
  '2026-11-14 06:00Z'::timestamptz, 'and after midnight, the same morning');
select is(kc_private.notification_quiet_hours_end(pg_temp.quiet('13:00', '15:00'), '2026-11-13 12:00Z'),
  '2026-11-13 13:00Z'::timestamptz, 'a window inside one day ends the same day');
select is(kc_private.notification_quiet_hours_end(pg_temp.quiet('22:00', '08:00'), '2026-11-13 10:00Z'), null,
  'outside the window there is no end');
select is(kc_private.notification_quiet_hours_end(pg_temp.quiet('22:00', '08:00', false), '2026-11-13 21:00Z'), null,
  'quiet hours switched off mean no window');
select is(kc_private.notification_quiet_hours_end('{}', '2026-11-13 21:00Z'), null, 'and so do preferences without them');

-- ── Match alerts ────────────────────────────────────────────────────────────
-- a: in quiet hours now · b: quiet hours later today · c: quiet hours off · d: in quiet hours,
-- for a kind that bypasses them.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select pg_temp.uid(x), 'u' || x || '@example.test', '{"provider":"google"}', jsonb_build_object('full_name', 'Member ' || upper(x))
  from unnest(array['a', 'b', 'c', 'd']) x;
insert into public.worlds (slug, label_he, label_en) values ('items', 'חפצים', 'Items');
insert into integrations.whatsapp_identities (wa_id, user_id, preferred_language)
select '97250000000' || n, pg_temp.uid(x), 'he' from unnest(array['a', 'b', 'c', 'd']) with ordinality as t (x, n);
insert into integrations.whatsapp_consents (user_id, opted_in) select pg_temp.uid(x), true from unnest(array['a', 'b', 'c', 'd']) x;
update integrations.whatsapp_message_templates set meta_status = 'approved';
update integrations.whatsapp_channel_config set is_enabled = true;
update public.user_private set notification_preferences = case user_id
    when pg_temp.uid('a') then pg_temp.quiet(pg_temp.local_hm(interval '-1 hour'), pg_temp.local_hm(interval '1 hour'))
    when pg_temp.uid('b') then pg_temp.quiet(pg_temp.local_hm(interval '2 hours'), pg_temp.local_hm(interval '3 hours'))
    when pg_temp.uid('c') then pg_temp.quiet(pg_temp.local_hm(interval '-1 hour'), pg_temp.local_hm(interval '1 hour'), false)
    else pg_temp.quiet(pg_temp.local_hm(interval '-1 hour'), pg_temp.local_hm(interval '1 hour')) end
 where user_id in (pg_temp.uid('a'), pg_temp.uid('b'), pg_temp.uid('c'), pg_temp.uid('d'));

select is(pg_temp.deliver('match_suggested', 'a') || ':' || pg_temp.due('a'),
  'delivered:deferred ' || date_trunc('minute', now() + interval '1 hour')::text || ':queued',
  'inside quiet hours the alert is queued for the end of the window, not dropped');
select is(pg_temp.deliver('match_suggested', 'b') || ':' || pg_temp.due('b'), 'delivered:now:queued',
  'outside the window it is due at once');
select is(pg_temp.deliver('match_suggested', 'c') || ':' || pg_temp.due('c'), 'delivered:now:queued',
  'with quiet hours off it is due at once');
update kc_private.notification_kinds set bypass_quiet_hours = true where kind = 'match_suggested';
select is(pg_temp.deliver('match_suggested', 'd') || ':' || pg_temp.due('d'), 'delivered:now:queued',
  'a kind that passes quiet hours for the push passes them on WhatsApp too');

select is((select string_agg(c.user_id::text, ',' order by c.user_id) from public.api_whatsapp_outbound_claim(20, 60) c),
  pg_temp.uid('b') || ',' || pg_temp.uid('c') || ',' || pg_temp.uid('d'), 'the sender does not claim the deferred alert');
update integrations.whatsapp_outbound_messages set next_attempt_at = now() - interval '1 second'
 where user_id = pg_temp.uid('a');
select is((select string_agg(c.user_id::text, ',') from public.api_whatsapp_outbound_claim(20, 60) c),
  pg_temp.uid('a')::text, 'and claims it once the window is over');

-- ── Retention of bot sessions ───────────────────────────────────────────────
select is((select keep || ':' || runnable from kc_private.retention_rules where name = 'whatsapp_bot_sessions'),
  '180 days:true', 'bot sessions are kept 180 days');
insert into integrations.bot_conversation_sessions (id, identity_id, draft, updated_at)
select ('70000000-0000-4000-8000-00000000000' || n)::uuid,
       (select id from integrations.whatsapp_identities where wa_id = '972500000001'),
       '{"title": "draft text"}', now() - age
  from (values (1, interval '181 days'), (2, interval '179 days'), (3, interval '200 days')) as s (n, age);
insert into integrations.bot_review_items (session_id, reason) values
  ('70000000-0000-4000-8000-000000000003', 'low_confidence_extraction');
select is(kc_private.retention_run('whatsapp_bot_sessions'), 1::bigint, 'a session past 180 days is removed');
select is((select string_agg(right(id::text, 1), ',' order by id) from integrations.bot_conversation_sessions), '2,3',
  'a younger one stays, and so does one still pending review');
select is((select count(*) from kc_private.scheduled_jobs
            where command = $$select kc_private.retention_run('whatsapp_bot_sessions')$$ and enabled), 1::bigint,
  'the retention job is scheduled');

select * from finish();
rollback;
