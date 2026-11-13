-- WhatsApp staff console (whatsapp_admin_console): who may call what, masked numbers,
-- keyset paging, the kill switch, resend, block, the review queue of bot posts and the two
-- super-admin configuration writers, each with its audit row.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.uid(p_who text)
returns uuid
language sql
as $$ select ('00000000-0000-4000-8000-0000000000' || to_hex(ascii(p_who)))::uuid; $$;

-- Runs `p_sql` as the member and returns its single value as text ('ok' for none), or the
-- P0001 message / the SQLSTATE of its error.
create function pg_temp.run(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(p_who), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql into v_out;
    v_out := coalesce(nullif(v_out, ''), 'ok');
  exception when others then
    v_out := case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_out;
end;
$$;

-- Audit rows of an action: 'actor:target_type:metadata' of the latest one, and how many.
create function pg_temp.audit(p_action text)
returns text
language sql
as $$
  select count(*) over () || '|' || coalesce(e.actor_id::text, '-') || '|' || coalesce(e.target_type, '-') || '|' || e.metadata::text
    from audit.events e where e.action = p_action order by e.id desc limit 1;
$$;

select plan(46);

-- s super admin · m moderator · p support · x member · u a member with a WhatsApp number.
insert into auth.users (id, email, raw_app_meta_data)
select pg_temp.uid(x), 'u' || x || '@example.test', '{"provider":"google"}'
  from unnest(array['s', 'm', 'p', 'x', 'u']) x;
insert into public.admin_role_grants (user_id, role) values
  (pg_temp.uid('s'), 'super_admin'), (pg_temp.uid('m'), 'moderator'), (pg_temp.uid('p'), 'support');
insert into public.cities (city_id, name_he, name_en) values ('c1', 'c1', 'City One');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item_request', 'r', 'r', 'request'),
  ('20000000-0000-4000-8000-000000000002', 'items', 'item_offer', 'o', 'o', 'offer');
insert into integrations.whatsapp_identities (wa_id, user_id, consent_status, updated_at) values
  ('972500000001', pg_temp.uid('u'), 'opted_in', now() - interval '1 hour'),
  ('972500000002', null, 'unknown', now() - interval '2 hours'),
  ('972500000003', null, 'opted_out', now() - interval '3 hours');
insert into integrations.whatsapp_consents (user_id, opted_in, opted_in_at) values (pg_temp.uid('u'), true, now());
insert into integrations.whatsapp_outbound_messages (id, user_id, kind, to_wa_id, template_name, body, status, created_at) values
  ('30000000-0000-4000-8000-000000000001', pg_temp.uid('u'), 'template', '972500000001', 'match_found_v1', null, 'failed', now() - interval '1 minute'),
  ('30000000-0000-4000-8000-000000000002', pg_temp.uid('u'), 'template', '972500000001', 'match_found_v1', null, 'sent', now() - interval '2 minutes'),
  ('30000000-0000-4000-8000-000000000003', pg_temp.uid('u'), 'template', '972500000001', 'confirm_handoff_v1', null, 'queued', now() - interval '3 minutes'),
  ('30000000-0000-4000-8000-000000000004', null, 'session', '972500000002', null, 'hi', 'sent', now() - interval '8 days');

-- ── Who may call ────────────────────────────────────────────────────────────
select is(pg_temp.run('x', 'select public.api_whatsapp_admin_get_channel()') || '|'
  || pg_temp.run('p', 'select public.api_whatsapp_admin_overview()') || '|'
  || pg_temp.run('p', 'select count(*) from public.api_whatsapp_admin_list_outbound()') || '|'
  || pg_temp.run('p', 'select count(*) from public.api_whatsapp_admin_review_list()') || '|'
  || pg_temp.run('x', 'select public.api_whatsapp_admin_set_channel_enabled(true)'),
  '42501|42501|42501|42501|42501', 'members and support staff cannot use the console');
select is(pg_temp.run('m', $$select public.api_whatsapp_admin_set_send_limits('{"per_user_hour": 7}')$$) || '|'
  || pg_temp.run('m', $$select public.api_whatsapp_admin_set_template_status('reminder_v1', 'he', 'approved')$$),
  '42501|42501', 'a moderator cannot change the limits or a template''s status');
select is(pg_temp.run('m', 'select public.api_whatsapp_admin_get_channel()') ::jsonb ->> 'is_enabled', 'false',
  'a moderator reads the channel');
select is(pg_temp.run('p', 'select public.api_whatsapp_admin_get_send_limits()'), '42501',
  'support staff cannot read the send limits');
select is(pg_temp.run('m', 'select public.api_whatsapp_admin_get_send_limits()') ::jsonb ->> 'per_user_hour', '5',
  'a moderator reads the seeded send limits');

-- ── Kill switch ─────────────────────────────────────────────────────────────
select is(pg_temp.run('m', 'select public.api_whatsapp_admin_set_channel_enabled(null)'), 'enabled_required', 'the value is required');
select is(pg_temp.run('m', 'select public.api_whatsapp_admin_set_channel_enabled(true)') ::jsonb ->> 'is_enabled', 'true',
  'a moderator switches the channel on');
select is((select (updated_by = pg_temp.uid('m'))::text from integrations.whatsapp_channel_config), 'true', 'who did it is kept');
select is(pg_temp.audit('whatsapp_channel_toggle'), '1|' || pg_temp.uid('m') || '|-|{"enabled": true}', 'and audited');
select is((select source || ':' || keyword from integrations.whatsapp_consent_events where user_id = pg_temp.uid('m')),
  'admin:kill_switch_enable', 'and kept in the consent history');

-- ── Overview and lists ──────────────────────────────────────────────────────
select is(pg_temp.run('m', 'select public.api_whatsapp_admin_overview()') ::jsonb - 'since',
  '{"sessions_7d": 0, "outbound_sent": 1, "rate_hits_7d": 0, "outbound_failed": 1, "outbound_queued": 1, "review_pending": 0,
    "channel_enabled": true, "matches_sent_7d": 1, "outbound_skipped": 0, "consent_opted_in": 1, "consent_opted_out": 0}'::jsonb,
  'the overview counts the last seven days');
select is(pg_temp.run('m', $$select string_agg(right(outbound_id::text, 1) || ':' || wa_id_masked, ',' order by created_at desc)
                              from public.api_whatsapp_admin_list_outbound(p_limit => 2)$$),
  '1:****0001,2:****0001', 'outbound messages, newest first, numbers masked');
select is(pg_temp.run('m', $$select string_agg(right(outbound_id::text, 1), ',') from public.api_whatsapp_admin_list_outbound(
                                p_cursor => (select cursor from public.api_whatsapp_admin_list_outbound(p_limit => 2) offset 1))$$),
  '3', 'the cursor continues after the page; older than seven days is left out');
select is(pg_temp.run('m', $$select count(*) from public.api_whatsapp_admin_list_outbound('sent')$$), '1', 'filtered by status');
select is(pg_temp.run('m', $$select count(*) from public.api_whatsapp_admin_list_outbound('lost')$$), 'invalid_status',
  'an unknown status is refused');
select is(pg_temp.run('m', $$select string_agg(wa_id_masked || ':' || consent_status || ':' || opted_in, ',')
                              from public.api_whatsapp_admin_list_consent(p_limit => 2)$$),
  '****0001:opted_in:true,****0002:unknown:false', 'numbers with their consent, most recent first');
select is(pg_temp.run('m', $$select string_agg(wa_id_masked, ',') from public.api_whatsapp_admin_list_consent(
                                (select cursor from public.api_whatsapp_admin_list_consent(p_limit => 2) offset 1))$$),
  '****0003', 'the consent list pages by cursor');
select is(pg_temp.run('m', $$select string_agg(template_name, ',') from public.api_whatsapp_admin_list_recent_matches()$$),
  'match_found_v1,match_found_v1,confirm_handoff_v1', 'recent match alerts');
select is(pg_temp.run('m', 'select count(*) from public.api_whatsapp_admin_list_templates()'), '8', 'the templates');
select kc_private.rate_limit('wa_in:972500000001', 20, interval '1 minute');
select is(pg_temp.run('m', 'select bucket || ''='' || hits from public.api_whatsapp_admin_list_rate_hits()'),
  'wa_in:****0001=1', 'live WhatsApp rate counters, the number masked');
select is(pg_temp.run('m', 'select count(*) from public.api_whatsapp_admin_list_conversations()'), '0', 'conversations');

-- ── Resend ──────────────────────────────────────────────────────────────────
update integrations.whatsapp_outbound_messages set attempts = 5 where id = '30000000-0000-4000-8000-000000000001';
select is(pg_temp.run('m', $$select public.api_whatsapp_admin_resend('30000000-0000-4000-8000-000000000001')$$), 'queued',
  'a failed message is queued again');
select is((select status || ':' || attempts from integrations.whatsapp_outbound_messages
            where id = '30000000-0000-4000-8000-000000000001'), 'queued:0', 'with its attempts reset');
select is(pg_temp.audit('whatsapp_resend'), '1|' || pg_temp.uid('m') || '|whatsapp_outbound|{"from_status": "failed"}', 'audited');
select is(pg_temp.run('m', $$select public.api_whatsapp_admin_resend('30000000-0000-4000-8000-000000000002')$$), 'not_resendable',
  'a sent message is not resent');
select is(pg_temp.run('m', $$select public.api_whatsapp_admin_resend('30000000-0000-4000-8000-000000000009')$$), 'outbound_not_found',
  'an unknown message is refused');

-- ── Block ───────────────────────────────────────────────────────────────────
select is(pg_temp.run('m', format('select public.api_whatsapp_admin_block_user(%L)', pg_temp.uid('u'))), 'ok', 'a moderator blocks a member');
select is((select opted_in::text from integrations.whatsapp_consents where user_id = pg_temp.uid('u'))
  || ':' || (select consent_status from integrations.whatsapp_identities where user_id = pg_temp.uid('u')),
  'false:opted_out', 'alert consent off and the number opted out');
select is((select string_agg(status || ':' || coalesce(last_error, '-'), ',' order by id) from integrations.whatsapp_outbound_messages
            where user_id = pg_temp.uid('u') and status not in ('sent')),
  'skipped_no_consent:admin_block,skipped_no_consent:admin_block', 'their queued templates are cancelled');
select is((select source || ':' || keyword from integrations.whatsapp_consent_events where user_id = pg_temp.uid('u')),
  'admin:block', 'the block is in the consent history');
select is(pg_temp.audit('whatsapp_block_user'), '1|' || pg_temp.uid('m') || '|user|{}', 'and audited against the member');
select is(pg_temp.run('m', 'select public.api_whatsapp_admin_block_user(null)'), 'user_id_required', 'a member is required');

-- ── Review queue ────────────────────────────────────────────────────────────
update public.users set city_id = 'c1' where id = pg_temp.uid('u');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id) values
  ('10000000-0000-4000-8000-000000000001', pg_temp.uid('u'), 'items', '20000000-0000-4000-8000-000000000001', 'request', 'draft', 'need a crib', 'c1'),
  ('10000000-0000-4000-8000-000000000002', pg_temp.uid('u'), 'items', '20000000-0000-4000-8000-000000000001', 'request', 'draft', 'need a pram', 'c1'),
  ('10000000-0000-4000-8000-000000000003', pg_temp.uid('u'), 'items', '20000000-0000-4000-8000-000000000002', 'offer', 'draft', 'a sofa', 'c1');
insert into integrations.bot_review_items (id, post_id, reason, created_at) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'publish_pending_review', now() - interval '3 minutes'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'publish_pending_review', now() - interval '2 minutes'),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'publish_pending_review', now() - interval '1 minute');
select is(pg_temp.run('m', 'select string_agg(post_title, '','') from public.api_whatsapp_admin_review_list()'),
  'a sofa,need a pram,need a crib', 'the pending bot posts, newest first');
select is(pg_temp.run('m', $$select public.api_whatsapp_admin_review_resolve('50000000-0000-4000-8000-000000000001', 'maybe')$$),
  'invalid_decision', 'the decision is approved or rejected');
select is(pg_temp.run('m', $$select public.api_whatsapp_admin_review_resolve('50000000-0000-4000-8000-000000000001', 'approved')$$),
  'approved', 'a moderator approves a bot post');
select is((select status from public.posts where id = '10000000-0000-4000-8000-000000000001')
  || ':' || (select status || ':' || (reviewer_id = pg_temp.uid('m'))::text || ':' || (resolved_at is not null)::text
               from integrations.bot_review_items where id = '50000000-0000-4000-8000-000000000001'),
  'open:approved:true:true', 'which publishes the draft and closes the item');
select is(pg_temp.audit('whatsapp_review_resolve'), '1|' || pg_temp.uid('m') || '|whatsapp_review|'
  || jsonb_build_object('post_id', '10000000-0000-4000-8000-000000000001', 'decision', 'approved')::text, 'audited');
select is(pg_temp.run('m', $$select public.api_whatsapp_admin_review_resolve('50000000-0000-4000-8000-000000000001', 'rejected')$$),
  'invalid_transition', 'a decision is final');
select is(pg_temp.run('m', $$select public.api_whatsapp_admin_review_resolve('50000000-0000-4000-8000-000000000002', 'rejected')$$)
  || ':' || (select status from public.posts where id = '10000000-0000-4000-8000-000000000002'),
  'rejected:draft', 'a rejected post stays its owner''s draft');
select is(pg_temp.run('m', $$select public.api_whatsapp_admin_review_resolve('50000000-0000-4000-8000-000000000003', 'approved')$$),
  'offer_photo_required', 'an offer without a photo is not published by an approval (D132)');

-- ── Configuration ───────────────────────────────────────────────────────────
select is(pg_temp.run('s', $$select public.api_whatsapp_admin_set_send_limits('{"per_user_hour": 7, "max_attempts": 3}')$$)
  ::jsonb ->> 'per_user_hour', '7', 'a super admin tunes the limits');
select is(pg_temp.run('s', $$select public.api_whatsapp_admin_set_send_limits('{"per_user_hour": 0}')$$) || '|'
  || pg_temp.run('s', $$select public.api_whatsapp_admin_set_send_limits('{"bogus": 1}')$$) || '|'
  || pg_temp.run('s', $$select public.api_whatsapp_admin_set_send_limits('{"per_user_hour": "7"}')$$),
  'invalid_limits|invalid_limits|invalid_limits', 'out of range, unknown or non-numeric fields are refused');
select is(pg_temp.audit('whatsapp_send_limits_set'), '1|' || pg_temp.uid('s') || '|-|{"max_attempts": 3, "per_user_hour": 7}',
  'the change is audited');
select is(pg_temp.run('s', $$select public.api_whatsapp_admin_set_template_status('reminder_v1', 'he', 'approved', 'meta-1')$$),
  'ok', 'a super admin records a Meta approval');
select is((select is_approved::text || ':' || meta_template_id from integrations.whatsapp_message_templates
            where template_name = 'reminder_v1' and language_code = 'he'), 'true:meta-1', 'which makes the template sendable');
select is(pg_temp.run('s', $$select public.api_whatsapp_admin_set_template_status('nope_v1', 'he', 'approved')$$),
  'template_not_found', 'an unknown template is refused');

select * from finish();
rollback;
