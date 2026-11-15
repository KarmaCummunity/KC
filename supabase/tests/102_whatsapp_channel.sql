-- WhatsApp channel (whatsapp_channel_schema, whatsapp_webhook_and_queue): the tables are
-- closed to clients; keyword parsing (Hebrew under a C collation); inbound claims, throttle,
-- ingest and the 24-hour window; consent keywords; session replies; the template queue's
-- gates in order; the sender's claim within the global budget and its retry with backoff;
-- the language-model budget.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.uid(p_who text)
returns uuid
language sql
as $$ select ('00000000-0000-4000-8000-0000000000' || to_hex(ascii(p_who)))::uuid; $$;

-- Runs `p_sql` in a role ('service_role', 'authenticated' as member x, 'anon') and returns its
-- single value as text ('ok' for none), or the P0001 message / the SQLSTATE of its error.
create function pg_temp.as_role(p_role text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('x'), 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
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
create function pg_temp.svc(p_sql text)
returns text
language sql
as $$ select pg_temp.as_role('service_role', p_sql); $$;

-- Status of the outbound row with this id.
create function pg_temp.out_status(p_id text)
returns text
language sql
as $$ select o.status from integrations.whatsapp_outbound_messages o where o.id = p_id::uuid; $$;

select plan(62);

insert into auth.users (id, email, raw_app_meta_data)
select pg_temp.uid(x), 'u' || x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'x']) x;

-- ── Closed to clients ───────────────────────────────────────────────────────
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'integrations' and c.relkind = 'r'
              and not (c.relrowsecurity and c.relforcerowsecurity)), 0::bigint,
  'every integrations table forces row level security');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'integrations' and c.relkind = 'r'
              and (has_table_privilege('authenticated', c.oid, 'select, insert, update, delete')
                   or has_table_privilege('anon', c.oid, 'select, insert, update, delete'))), 0::bigint,
  'no client role holds a privilege on an integrations table');
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and (p.proname like 'api\_whatsapp\_%' or p.proname like 'api\_bot\_%')
              and p.proname not like 'api\_whatsapp\_admin\_%'
              and p.proname not in ('api_whatsapp_create_link_code', 'api_whatsapp_my_link_status',
                                    'api_whatsapp_unlink_me', 'api_whatsapp_set_match_consent')
              and (has_function_privilege('authenticated', p.oid, 'execute')
                   or has_function_privilege('anon', p.oid, 'execute'))), null,
  'the webhook, sender and agent functions are not executable by a client role');
select is(pg_temp.as_role('authenticated', $$select public.api_whatsapp_claim_inbound('m1')$$), '42501',
  'a member cannot call the webhook contract');
select is((select count(*) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like 'api\_whatsapp\_admin\_%'
              and not has_function_privilege('authenticated', p.oid, 'execute')), 0::bigint,
  'the console functions are granted to authenticated (they check the role themselves)');
select is((select count(*) from integrations.whatsapp_message_templates), 8::bigint,
  'the eight registry templates are seeded');
select is((select count(*) from integrations.whatsapp_message_templates where is_approved), 0::bigint,
  'no template is approved before Meta approves it');
select is(pg_temp.svc('select public.api_whatsapp_channel_config()'),
  '{"is_enabled": false, "phone_number_id": null, "graph_api_version": "v21.0"}',
  'the channel starts disabled');

-- ── Keyword parsing ─────────────────────────────────────────────────────────
select is(kc_private.whatsapp_parse_keyword('STOP!') ->> 'action', 'opt_out', 'STOP with punctuation is an opt-out');
select is(kc_private.whatsapp_parse_keyword('  Opt   Out ') ->> 'keyword', 'opt out', 'spacing and case are normalised');
select is(kc_private.whatsapp_parse_keyword('הסר') ->> 'language', 'he', 'a Hebrew opt-out is recognised');
select is(kc_private.whatsapp_parse_keyword('״הסר״ 🙏') ->> 'action', 'opt_out',
  'Hebrew quotes (gershayim) and emoji are stripped');
select is(kc_private.whatsapp_parse_keyword('הסר' COLLATE "C") ->> 'action', 'opt_out',
  'Hebrew letters survive the stripping under the C collation');
select is(kc_private.whatsapp_parse_keyword('כן') ->> 'action', 'opt_in', 'a Hebrew opt-in is recognised');
select is(kc_private.whatsapp_parse_keyword('עזרה') ->> 'action', 'help', 'a Hebrew help is recognised');
select is(kc_private.whatsapp_parse_keyword('please stop sending me this'), null,
  'a sentence that contains stop is not a keyword');
select is(kc_private.whatsapp_parse_keyword(repeat('a', 30)), null, 'text over 24 characters is not a keyword');

-- ── Inbound: claim, throttle, ingest ────────────────────────────────────────
select is(pg_temp.svc($$select public.api_whatsapp_claim_inbound('wamid.1')$$), 'true', 'a first delivery is claimed');
select is(pg_temp.svc($$select public.api_whatsapp_claim_inbound('wamid.1')$$), 'false', 'a retry of it is skipped');
select is(pg_temp.svc($$select public.api_whatsapp_release_inbound('wamid.1')$$)
  || pg_temp.svc($$select public.api_whatsapp_claim_inbound('wamid.1')$$), 'oktrue', 'a released claim can be taken again');
select is(pg_temp.svc($$select public.api_whatsapp_claim_inbound(' ')$$), 'message_id_required', 'a blank id is refused');

update integrations.whatsapp_send_limits set inbound_per_phone_minute = 2;
select is(pg_temp.svc($$select public.api_whatsapp_inbound_allowed('972500000001')$$) || ','
  || pg_temp.svc($$select public.api_whatsapp_inbound_allowed('972500000001')$$) || ','
  || pg_temp.svc($$select public.api_whatsapp_inbound_allowed('972500000001')$$) || ','
  || pg_temp.svc($$select public.api_whatsapp_inbound_allowed('972500000002')$$),
  'true,true,false,true', 'inbound messages are throttled per number, with the limit of the console row');

create temporary table t_ids (k text primary key, v text);
grant all on t_ids to service_role;
insert into t_ids values ('in1', pg_temp.svc($$select public.api_whatsapp_ingest_inbound('wamid.1',
  '{"message": {"from": "972500000001", "type": "text", "text": {"body": "hi"}}}')$$));
select is(pg_temp.svc($$select public.api_whatsapp_ingest_inbound('wamid.1', '{"message": {}}')$$),
  (select v from t_ids where k = 'in1'), 'ingest is idempotent on the message id');
select is((select (retain_until::date - received_at::date) from integrations.whatsapp_inbound_messages where message_id = 'wamid.1'),
  90, 'the payload is kept for the 90 days of the retention rule');
select is((select last_inbound_at = now() from integrations.whatsapp_identities where wa_id = '972500000001'), true,
  'ingest opens the number''s 24-hour window');

-- ── Consent keywords ────────────────────────────────────────────────────────
update integrations.whatsapp_identities set user_id = pg_temp.uid('a') where wa_id = '972500000001';
select is(pg_temp.svc(format($$select public.api_whatsapp_handle_keyword('972500000001', 'הסר', %L)$$,
                             (select v from t_ids where k = 'in1'))),
  '{"action": "opt_out", "language": "he", "consent_status": "opted_out"}', 'STOP opts the number out');
select is((select opted_in::text from integrations.whatsapp_consents where user_id = pg_temp.uid('a')), 'false',
  'and mirrors into the linked member''s alert consent');
select is((select source || ':' || keyword || ':' || (inbound_message_id is not null)::text
             from integrations.whatsapp_consent_events where wa_id = '972500000001'), 'keyword:הסר:true',
  'a consent event is recorded with the inbound message');
select is(pg_temp.svc($$select public.api_whatsapp_handle_keyword('972500000001', 'help')$$),
  '{"action": "help", "language": "en", "consent_status": "opted_out"}', 'HELP leaves the consent as it is');
select is(pg_temp.svc($$select public.api_whatsapp_handle_keyword('972500000001', 'what is this?')$$),
  '{"action": null}', 'ordinary text is not a keyword');
select is(pg_temp.svc($$select public.api_whatsapp_handle_keyword('972500000001', 'START')$$) ::jsonb ->> 'consent_status',
  'opted_in', 'START opts the number back in');
select is((select string_agg(action, ',' order by created_at, action) from integrations.whatsapp_consent_events
            where wa_id = '972500000001'), 'help,opt_in,opt_out', 'each keyword is recorded once');

-- ── Session replies ─────────────────────────────────────────────────────────
select is(pg_temp.out_status(pg_temp.svc($$select public.api_whatsapp_queue_reply('972500000001', 'hello')$$)),
  'skipped_channel_disabled', 'nothing is queued while the channel is off');
update integrations.whatsapp_channel_config set is_enabled = true;
select is(pg_temp.svc($$select public.api_whatsapp_queue_reply('972500000001', 'hello', 'shout')$$), 'invalid_reply_kind',
  'an unknown reply kind is refused');
select is(pg_temp.svc($$select public.api_whatsapp_queue_reply('972500000001', ' ')$$), 'body_required', 'an empty body is refused');
select is(pg_temp.out_status(pg_temp.svc($$select public.api_whatsapp_queue_reply('972599999999', 'hello')$$)),
  'skipped_no_identity', 'a number never seen gets nothing');
insert into integrations.whatsapp_identities (wa_id, last_inbound_at) values ('972500000003', now() - interval '25 hours');
select is(pg_temp.out_status(pg_temp.svc($$select public.api_whatsapp_queue_reply('972500000003', 'hello')$$)),
  'skipped_outside_window', 'a reply outside the 24-hour window is not sent');
update integrations.whatsapp_identities set consent_status = 'opted_out' where wa_id = '972500000001';
select is(pg_temp.out_status(pg_temp.svc($$select public.api_whatsapp_queue_reply('972500000001', 'hello')$$))
  || ',' || pg_temp.out_status(pg_temp.svc($$select public.api_whatsapp_queue_reply('972500000001', 'bye', 'consent_confirmation')$$)),
  'skipped_no_consent,queued', 'after a STOP only the STOP confirmation passes');
update integrations.whatsapp_identities set consent_status = 'opted_in' where wa_id = '972500000001';
update integrations.whatsapp_send_limits set reply_per_phone_hour = 2;
select is(pg_temp.out_status(pg_temp.svc($$select public.api_whatsapp_queue_reply('972500000001', 'one')$$))
  || ',' || pg_temp.out_status(pg_temp.svc($$select public.api_whatsapp_queue_reply('972500000001', 'two')$$)),
  'queued,skipped_rate_limit', 'replies are capped per number per hour');

-- ── Template queue: the gates in order ──────────────────────────────────────
delete from integrations.whatsapp_outbound_messages;
update integrations.whatsapp_channel_config set is_enabled = false;
select is(pg_temp.out_status(kc_private.whatsapp_queue_template(pg_temp.uid('a'), 'match_found_v1', '{}')::text),
  'skipped_channel_disabled', '1. the channel switch comes first');
update integrations.whatsapp_channel_config set is_enabled = true;
update integrations.whatsapp_consents set opted_in = false where user_id = pg_temp.uid('a');
select is(pg_temp.out_status(kc_private.whatsapp_queue_template(pg_temp.uid('a'), 'match_found_v1', '{}')::text),
  'skipped_no_consent', '2. then the member''s consent');
insert into integrations.whatsapp_consents (user_id, opted_in) values (pg_temp.uid('b'), true);
select is(pg_temp.out_status(kc_private.whatsapp_queue_template(pg_temp.uid('b'), 'match_found_v1', '{}')::text),
  'skipped_no_identity', '3. then a number of the member');
update integrations.whatsapp_consents set opted_in = true where user_id = pg_temp.uid('a');
select is(pg_temp.out_status(kc_private.whatsapp_queue_template(pg_temp.uid('a'), 'match_found_v1', '{}')::text),
  'skipped_template_unapproved', '4. then an approved template');
update integrations.whatsapp_message_templates set meta_status = 'approved'
 where template_name = 'match_found_v1' and language_code = 'en';
update integrations.whatsapp_identities set preferred_language = 'he' where wa_id = '972500000001';
insert into t_ids values ('t1', kc_private.whatsapp_queue_template(pg_temp.uid('a'), 'match_found_v1', '{}')::text);
select is((select status || ':' || language from integrations.whatsapp_outbound_messages where id = (select v from t_ids where k = 't1')::uuid),
  'queued:en', 'a Hebrew speaker gets the English variant when only it is approved');
update integrations.whatsapp_message_templates set meta_status = 'approved' where template_name = 'match_found_v1';
insert into t_ids values ('t2', kc_private.whatsapp_queue_template(pg_temp.uid('a'), 'match_found_v1', '{}')::text);
select is((select language from integrations.whatsapp_outbound_messages where id = (select v from t_ids where k = 't2')::uuid),
  'he', 'and the Hebrew one once it is approved');
update integrations.whatsapp_send_limits set per_user_hour = 2;
select is(pg_temp.out_status(kc_private.whatsapp_queue_template(pg_temp.uid('a'), 'match_found_v1', '{}')::text),
  'skipped_rate_limit', '5. then the per-member hourly cap');
update integrations.whatsapp_send_limits set per_user_hour = 100, global_template_recipients_day = 1;
insert into integrations.whatsapp_identities (wa_id, user_id) values ('972500000004', pg_temp.uid('b'));
select is(pg_temp.out_status(kc_private.whatsapp_queue_template(pg_temp.uid('b'), 'match_found_v1', '{}')::text),
  'skipped_global_cap', '6. then the global daily recipient cap');

-- ── Sender: claim and result ────────────────────────────────────────────────
update integrations.whatsapp_send_limits set global_per_minute = 2, max_attempts = 3, backoff_base_seconds = 30;
select is(pg_temp.svc('select count(*) from public.api_whatsapp_outbound_claim(10)'), '2',
  'a claim takes at most the global per-minute budget');
select is(pg_temp.svc('select count(*) from public.api_whatsapp_outbound_claim(10)'), '0', 'and nothing more in that minute');
select is((select count(*) from integrations.whatsapp_outbound_messages where status = 'sending'), 2::bigint,
  'the claimed rows are sending');
delete from kc_private.rate_limit_counters where key = 'wa_out_global';
insert into t_ids values ('t3', kc_private.whatsapp_queue_template(pg_temp.uid('a'), 'match_found_v1', '{}')::text);
update integrations.whatsapp_consents set opted_in = false where user_id = pg_temp.uid('a');
select is(pg_temp.svc('select count(*) from public.api_whatsapp_outbound_claim(10)'), '0',
  'a template whose member withdrew consent is not claimed');
select is(pg_temp.out_status((select v from t_ids where k = 't3')), 'skipped_no_consent',
  'it becomes skipped_no_consent at claim time');
update integrations.whatsapp_consents set opted_in = true where user_id = pg_temp.uid('a');

insert into t_ids values ('s1', (select id::text from integrations.whatsapp_outbound_messages where status = 'sending' order by id limit 1));
select is(pg_temp.svc(format($$select public.api_whatsapp_outbound_result(%L, false, null, 'HTTP 503', true)$$,
                             (select v from t_ids where k = 's1'))), 'queued', 'a retryable failure is queued again');
select is((select attempts || ':' || (next_attempt_at = now() + interval '30 seconds')::text
             from integrations.whatsapp_outbound_messages where id = (select v from t_ids where k = 's1')::uuid),
  '1:true', 'after the base backoff');
update integrations.whatsapp_outbound_messages set status = 'sending' where id = (select v from t_ids where k = 's1')::uuid;
select is(pg_temp.svc(format($$select public.api_whatsapp_outbound_result(%L, false, null, 'HTTP 503', true)$$,
                             (select v from t_ids where k = 's1'))), 'queued', 'a second retry is queued');
select is((select (next_attempt_at = now() + interval '60 seconds')::text
             from integrations.whatsapp_outbound_messages where id = (select v from t_ids where k = 's1')::uuid),
  'true', 'the backoff doubles');
update integrations.whatsapp_outbound_messages set status = 'sending' where id = (select v from t_ids where k = 's1')::uuid;
select is(pg_temp.svc(format($$select public.api_whatsapp_outbound_result(%L, false, null, 'HTTP 503', true)$$,
                             (select v from t_ids where k = 's1'))), 'failed', 'past max_attempts it fails');
select is(pg_temp.svc(format($$select public.api_whatsapp_outbound_result(%L, true, 'wamid.x')$$,
                             (select v from t_ids where k = 's1'))), 'failed', 'a result for a finished row changes nothing');
insert into t_ids values ('s2', (select id::text from integrations.whatsapp_outbound_messages where status = 'sending' limit 1));
select is(pg_temp.svc(format($$select public.api_whatsapp_outbound_result(%L, true, 'wamid.ok')$$,
                             (select v from t_ids where k = 's2'))), 'sent', 'a success is sent');
select is(pg_temp.svc($$select public.api_whatsapp_outbound_result('00000000-0000-4000-8000-000000000000', true)$$),
  'outbound_not_found', 'an unknown row is refused');
update integrations.whatsapp_outbound_messages set status = 'sending', claimed_at = now() - interval '5 minutes'
 where id = (select v from t_ids where k = 's1')::uuid;
select is(pg_temp.svc('select string_agg(outbound_id::text, '','') from public.api_whatsapp_outbound_claim(10, 60)'),
  (select v from t_ids where k = 's1'), 'a claim left behind longer than the visibility is taken again');

-- ── Language-model budget ───────────────────────────────────────────────────
update integrations.whatsapp_send_limits set llm_per_phone_day = 1, llm_global_day = 2;
select is(pg_temp.svc($$select public.api_whatsapp_llm_budget_take('972500000001')$$) || ','
  || pg_temp.svc($$select public.api_whatsapp_llm_budget_take('972500000001')$$) || ','
  || pg_temp.svc($$select public.api_whatsapp_llm_budget_take('972500000002')$$) || ','
  || pg_temp.svc($$select public.api_whatsapp_llm_budget_take('972500000005')$$),
  'true,false,true,false', 'the budget is capped per number and globally per day');

select * from finish();
rollback;
