-- Billing: the schema is closed to client roles and members reach only their own money
-- data through RPCs; a donation runs from intent through a provider event to payment,
-- ledger, receipt, books and notices, exactly once; refunds, payouts, standing orders,
-- KYC and entitlements follow their machines; organization finance is scoped by role;
-- an account purge keeps the money records and swaps the member reference.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Shorthand inside SQL text: @x the member with hex digit x, &slug an organization, ~key
-- the settled payment of the donation intent with that idempotency key.
create function pg_temp.expand(p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
begin
  for v_match in select regexp_matches(p_sql, '&([a-z]+)', 'g') loop
    v_sql := regexp_replace(v_sql, '&' || v_match[1] || '\M', coalesce(quote_literal((
      select o.id from public.organizations o where o.slug = v_match[1])), 'null') || '::uuid');
  end loop;
  for v_match in select regexp_matches(p_sql, '~([a-z0-9-]+)', 'g') loop
    v_sql := replace(v_sql, '~' || v_match[1], coalesce(quote_literal((
      select p.id from billing.payments p join billing.donation_intents i on i.id = p.intent_id
       where i.idempotency_key = v_match[1] and p.status <> 'failed')), 'null') || '::uuid');
  end loop;
  return regexp_replace(v_sql, '@([0-9a-f])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
end;
$$;

create function pg_temp.become(p_who text)
returns void
language plpgsql
as $$
begin
  if p_who is null or p_who = 'none' then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
  else
    perform set_config('request.jwt.claims', case when p_who in ('anon', 'service_role')
      then jsonb_build_object('role', p_who)
      else jsonb_build_object('sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated') end::text, true);
    perform set_config('role', case when p_who in ('anon', 'service_role') then p_who else 'authenticated' end, true);
  end if;
end;
$$;
grant execute on function pg_temp.become(text) to public;

-- Runs a statement as a member, `anon` or `service_role`: 'ok', the P0001 message, or the SQLSTATE.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
begin
  begin
    perform pg_temp.become(p_who);
    execute v_sql;
    perform pg_temp.become('none');
    return 'ok';
  exception when others then
    perform pg_temp.become('none');
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- One value read as a member or role, or as the database owner when p_who is null.
create function pg_temp.val(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
  v_value text;
begin
  perform pg_temp.become(p_who);
  execute v_sql into v_value;
  perform pg_temp.become('none');
  return v_value;
end;
$$;

-- Sends a provider event as the service role; returns the stored event's 'status' or 'status:error'.
create function pg_temp.event(p_event_id text, p_payload jsonb)
returns text
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform pg_temp.become('service_role');
  select a.webhook_event_id into v_id from public.provider_webhook_apply('grow', p_event_id, p_payload) a;
  perform pg_temp.become('none');
  return (select e.status || coalesce(':' || e.error_code, '') from billing.webhook_events e where e.id = v_id);
end;
$$;

-- A member starts a donation and the provider opens its checkout; returns the intent id.
create function pg_temp.intent(p_who text, p_org text, p_agorot bigint, p_key text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  v_id := (pg_temp.val(p_who, format('select public.create_donation_intent(&%s, %s, %L)', p_org, p_agorot, p_key))::jsonb ->> 'intent_id')::uuid;
  perform pg_temp.become('service_role');
  perform public.api_donation_intent_set_checkout(v_id, 'cs_' || p_key, 'https://pay.example.test/' || p_key);
  perform pg_temp.become('none');
  return v_id;
end;
$$;

-- Notification events of a kind addressed to a member; audit events of an action.
create function pg_temp.told(p_kind text, p_who text)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e
   where e.topic = 'notification' and e.payload ->> 'kind' = p_kind
     and e.payload ->> 'recipient_id' = '00000000-0000-4000-8000-00000000000' || p_who;
$$;
create function pg_temp.audited(p_action text)
returns bigint
language sql
as $$
  select count(*) from audit.events e where e.action = p_action;
$$;

select plan(62);

-- a platform admin · b moderator · c accountant of `aid` · d, e donors · f treasurer of
-- `aid` · 1 a member with no role.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(string_to_array('a,b,c,d,e,f,1', ',')) x;
insert into public.organizations (slug, name, is_platform, is_verified_nonprofit) values
  ('kc', 'Karma Community', true, false), ('aid', 'Aid', false, true), ('plain', 'Plain', false, false);
insert into public.admin_role_grants (user_id, role, scope_org_id) values
  ('00000000-0000-4000-8000-00000000000a', 'admin', null), ('00000000-0000-4000-8000-00000000000b', 'moderator', null),
  ('00000000-0000-4000-8000-00000000000c', 'org_accountant', (select id from public.organizations where slug = 'aid')),
  ('00000000-0000-4000-8000-00000000000f', 'org_treasurer', (select id from public.organizations where slug = 'aid'));

-- ── The schema is closed ────────────────────────────────────────────────────
select is(pg_temp.act('d', 'select 1 from billing.payments') || pg_temp.act('anon', 'select 1 from billing.settings')
  || pg_temp.act('d', 'select kc_private.is_pro(@d)') || pg_temp.act('d', 'select kc_private.billing_org_balance(&aid)'),
  '42501425014250142501', 'no client role can address the billing schema or the internal functions');
select is((select count(*) from information_schema.role_table_grants
            where table_schema = 'billing' and grantee in ('anon', 'authenticated', 'PUBLIC')), 0::bigint,
  'no client role holds a privilege on a billing table');
select is((select count(*) from pg_tables t where t.schemaname = 'billing'
             and not (select c.relrowsecurity and c.relforcerowsecurity from pg_class c
                       where c.oid = format('billing.%I', t.tablename)::regclass)), 0::bigint,
  'row level security is enabled and forced on every billing table');
select is(pg_temp.act('d', $$select webhook_event_id from public.provider_webhook_apply('grow', 'x', '{}')$$)
  || pg_temp.act('d', $$select public.api_donation_intent_set_checkout(gen_random_uuid(), 'x', 'https://x')$$)
  || pg_temp.act('d', $$select public.api_standing_orders_charge_due()$$)
  || pg_temp.act('d', $$select public.api_payout_open(&aid, 1, 'payout-key-1')$$)
  || pg_temp.act('d', $$select public.api_revenuecat_set_pro(@d, true, null)$$)
  || pg_temp.act('d', $$select public.api_set_pro_entitlement(@d, true)$$)
  || pg_temp.act('d', $$select public.api_payment_method_save(@d, 'grow', 'tok')$$),
  repeat('42501', 7), 'the service entry points are closed to members');
select is(pg_temp.val('service_role', 'select count(*) from billing.payments')
  || pg_temp.act('service_role', $$update billing.settings set min_donation_agorot = 500$$)
  || pg_temp.act('service_role', $$insert into billing.ledger_entries (txn_id, account, org_id, debit_agorot, ref_type, ref_id)
       values (gen_random_uuid(), 'org_payable', &aid, 1, 'payment', gen_random_uuid())$$)
  || pg_temp.act('service_role', 'delete from billing.payments') || pg_temp.act('service_role', 'delete from billing.settings'),
  '0ok425014250142501', 'the service role reads and sets settings; it writes no money row directly');

-- ── Starting a donation ─────────────────────────────────────────────────────
select is(pg_temp.act('d', $$select public.create_donation_intent(&aid, 1000, 'key-00001')$$), 'payments_unavailable',
  'no donation without a payment provider');
insert into billing.payment_providers (slug, display_name, is_default) values ('grow', 'Grow', true);
select is(pg_temp.act('anon', $$select public.create_donation_intent(&aid, 1000, 'key-00001')$$)
  || '|' || pg_temp.act('d', $$select public.create_donation_intent(&aid, 499, 'key-00001')$$)
  || '|' || pg_temp.act('d', $$select public.create_donation_intent(&plain, 1000, 'key-00001')$$)
  || '|' || pg_temp.act('d', $$select public.create_donation_intent(&kc, 1000, 'key-000kc')$$),
  '42501|money_min_amount|verified_org_required|ok',
  'a signed-in member donates at least the minimum to a verified nonprofit or to the platform organization');
select is(pg_temp.val('d', $$select public.create_donation_intent(&aid, 1000, 'key-00001') ->> 'status'$$)
  || '|' || (pg_temp.val('d', $$select public.create_donation_intent(&aid, 1000, 'key-00001') ->> 'intent_id'$$)
             = pg_temp.val(null, $$select id from billing.donation_intents where idempotency_key = 'key-00001'$$))
  || '|' || pg_temp.val(null, $$select count(*) from billing.donation_intents where idempotency_key = 'key-00001'$$)
  || '|' || pg_temp.act('d', $$select public.create_donation_intent(&aid, 2000, 'key-00001')$$)
  || '|' || pg_temp.act('e', $$select public.create_donation_intent(&aid, 1000, 'key-00001')$$),
  'created|true|1|idempotency_key_conflict|idempotency_key_conflict',
  'the same key returns the same intent; it cannot be reused for another amount or by another member');

-- ── From provider event to receipt ──────────────────────────────────────────
select is(pg_temp.event('evt-early', jsonb_build_object('type', 'payment.succeeded', 'provider_ref', 'ch_1',
    'intent_id', (select id from billing.donation_intents where idempotency_key = 'key-00001'))),
  'failed:intent_not_payable', 'an intent that never reached the checkout cannot be paid');
select is((select pg_temp.intent('d', 'aid', 1000, 'key-00001') is not null)::text
  || '|' || pg_temp.event('evt-bad', jsonb_build_object('type', 'payment.succeeded', 'amount_agorot', 999,
    'intent_id', (select id from billing.donation_intents where idempotency_key = 'key-00001')))
  || '|' || pg_temp.val(null, 'select (select count(*) from billing.payments) || (select count(*)::text from billing.ledger_entries)'),
  'true|failed:amount_mismatch|00', 'an event for another amount fails and writes nothing');
select is(pg_temp.event('evt-early', jsonb_build_object('type', 'payment.succeeded', 'provider_ref', 'ch_1', 'amount_agorot', 1000,
    'intent_id', (select id from billing.donation_intents where idempotency_key = 'key-00001'))),
  'processed', 'a failed event is applied when the provider sends it again');
select is((select p.status || '|' || p.amount_agorot || '|' || i.status || '|' || (p.user_id = i.user_id)
             from billing.payments p join billing.donation_intents i on i.id = p.intent_id),
  'succeeded|1000|succeeded|true', 'the payment and its intent are settled');
select is((select string_agg(account || ':' || debit_agorot || '/' || credit_agorot, ' ' order by account)
             || '|' || count(distinct txn_id) from billing.ledger_entries),
  'org_payable:0/1000 provider_clearing:1000/0|1', 'one balanced ledger transaction: clearing debited, the organization credited');
select is((select r.serial || '|' || r.sec46_eligible || '|' || r.amount_agorot from billing.receipts r), '1|false|1000',
  'the receipt is issued in the same step, numbered 1');
select is((select e.kind || '|' || e.status || '|' || e.source || '|' || e.category || '|' || a.kind || '|' || (e.donor_user_id is not null)
             from billing.org_finance_entries e join billing.org_finance_accounts a on a.id = e.account_id),
  'donation_in|cleared|payment_sync|individual_donations|payment_provider|true', 'the donation is mirrored into the organization''s books');
select is(pg_temp.told('donation_succeeded', 'd') || '|' || pg_temp.told('donation_receipt_ready', 'd')
  || '|' || pg_temp.audited('payment_succeeded') || '|' || pg_temp.audited('receipt_issued'), '1|1|1|1',
  'the donor is told and the move is audited');
select is(pg_temp.event('evt-early', '{"type":"payment.succeeded"}') || '|'
  || pg_temp.event('evt-again', jsonb_build_object('type', 'payment.succeeded',
       'intent_id', (select id from billing.donation_intents where idempotency_key = 'key-00001')))
  || '|' || pg_temp.val(null, $$select (select count(*) from billing.payments) || (select count(*)::text from billing.ledger_entries)
       || (select count(*) from billing.receipts) || (select count(*) from billing.org_finance_entries)$$)
  || '|' || pg_temp.told('donation_succeeded', 'd'),
  'processed|processed|1211|1', 'a replayed event and a second event for the same intent change nothing');
select is(pg_temp.val('service_role', format($$select webhook_event_id from public.provider_webhook_apply('other', 'evt-x', %L)$$, jsonb_build_object(
    'type', 'payment.succeeded', 'intent_id', pg_temp.intent('e', 'aid', 600, 'key-000e0')))) is not null
  and pg_temp.val(null, $$select e.status || ':' || e.error_code || ':' || i.status from billing.webhook_events e, billing.donation_intents i
       where e.provider_slug = 'other' and i.idempotency_key = 'key-000e0'$$) = 'failed:intent_not_found:checkout', true,
  'a provider cannot settle an intent that was sent to another provider');
select is(pg_temp.event('evt-odd', '{"type":"payment.exploded"}') || '|' || pg_temp.event('evt-uuid', '{"type":"refund.succeeded","refund_id":"x"}'),
  'failed:unknown_event_type|failed:22P02', 'an event that cannot be understood is kept as failed');

-- ── A member reads their own money only ─────────────────────────────────────
select is(pg_temp.val('d', $$select count(*) || '|' || max(receipt_serial) || '|' || max(org_name) from public.list_my_donation_history()$$)
  || '|' || pg_temp.val('e', 'select count(*) from public.list_my_donation_history()')
  || '|' || pg_temp.act('anon', 'select public.list_my_donation_history()'),
  '1|1|Aid|0|42501', 'the donation history is the caller''s own');
select is(pg_temp.val('d', $$select public.get_donation_receipt(~key-00001) ->> 'serial'$$)
  || '|' || coalesce(pg_temp.val('e', $$select public.get_donation_receipt(~key-00001)$$), 'null'),
  '1|null', 'a receipt is shown to its donor only');
select is(pg_temp.event('evt-e1', jsonb_build_object('type', 'payment.succeeded', 'intent_id', pg_temp.intent('e', 'aid', 5000, 'key-000e1')))
  || pg_temp.event('evt-d2', jsonb_build_object('type', 'payment.succeeded', 'intent_id', pg_temp.intent('d', 'kc', 1000, 'key-000kc')))
  || '|' || pg_temp.val(null, $$select string_agg(o.slug || ':' || r.serial, ' ' order by o.slug, r.serial)
               from billing.receipts r join public.organizations o on o.id = r.org_id$$),
  'processedprocessed|aid:1 aid:2 kc:1', 'receipts are numbered per organization');
select is(pg_temp.val('d', $$select count(*) from public.list_my_donation_history(1)$$)
  || pg_temp.val('d', $$select count(*) from public.list_my_donation_history(1) h
       cross join lateral public.list_my_donation_history(10, h.paid_at, h.payment_id) n$$), '11', 'the history pages by keyset');

-- ── A failed charge, then a retry ───────────────────────────────────────────
select is(pg_temp.event('evt-f1', jsonb_build_object('type', 'payment.failed', 'intent_id', pg_temp.intent('e', 'aid', 800, 'key-000e2')))
  || '|' || pg_temp.val(null, $$select i.status || '|' || (select count(*) from billing.payments where status = 'failed')
       || (select count(*) from billing.ledger_entries) from billing.donation_intents i where i.idempotency_key = 'key-000e2'$$)
  || '|' || pg_temp.event('evt-f2', jsonb_build_object('type', 'payment.succeeded',
       'intent_id', pg_temp.val(null, $$select id from billing.donation_intents where idempotency_key = 'key-000e2'$$)))
  || '|' || pg_temp.val(null, $$select i.status || (select count(*) from billing.ledger_entries)
       from billing.donation_intents i where i.idempotency_key = 'key-000e2'$$),
  'processed|failed|16|processed|succeeded8', 'a failed charge posts nothing; a later success on the same checkout settles it');

-- ── Refunds ─────────────────────────────────────────────────────────────────
create temporary table t_ids as
  select (select p.id from billing.payments p join billing.donation_intents i on i.id = p.intent_id
           where i.idempotency_key = 'key-000e1') as pay_e1;
grant select on t_ids to public;
select is(pg_temp.act('e', $$select public.admin_refund_payment((select pay_e1 from t_ids), 1000, 'donor_request', 'refund-key-1')$$)
  || '|' || pg_temp.act('a', $$select public.admin_refund_payment((select pay_e1 from t_ids), 5001, 'donor_request', 'refund-key-0')$$)
  || '|' || pg_temp.act('a', $$select public.admin_refund_payment((select pay_e1 from t_ids), 1000, 'because', 'refund-key-0')$$)
  || '|' || pg_temp.act('a', $$select public.admin_refund_payment((select pay_e1 from t_ids), 1000, 'donor_request', 'refund-key-1')$$)
  || pg_temp.act('a', $$select public.admin_refund_payment((select pay_e1 from t_ids), 1000, 'donor_request', 'refund-key-1')$$)
  || '|' || pg_temp.val(null, $$select count(*) || ':' || min(status) from billing.refunds$$) || '|' || pg_temp.audited('refund_opened'),
  '42501|refund_exceeds_payment|23514|okok|1:pending|1', 'a platform admin opens a refund within the payment, once per key');
select is(pg_temp.act('a', $$select public.admin_refund_payment((select pay_e1 from t_ids), 4001, 'error', 'refund-key-2')$$),
  'refund_exceeds_payment', 'a refund on the way counts against what is left');
select is(pg_temp.event('evt-r1', jsonb_build_object('type', 'refund.succeeded', 'refund_id', (select id from billing.refunds)))
  || pg_temp.event('evt-r1b', jsonb_build_object('type', 'refund.succeeded', 'refund_id', (select id from billing.refunds)))
  || '|' || pg_temp.val(null, $$select p.status || ':' || p.refunded_agorot from billing.payments p, t_ids where p.id = pay_e1$$)
  || '|' || pg_temp.val(null, $$select string_agg(account || ':' || debit_agorot || '/' || credit_agorot, ' ' order by account)
               from billing.ledger_entries where ref_type = 'refund'$$)
  || '|' || pg_temp.val(null, $$select count(*) from billing.org_finance_entries where kind = 'refund_out' and status = 'cleared'$$)
  || '|' || pg_temp.told('donation_refunded', 'e') || '|' || pg_temp.audited('refund_settled'),
  'processedprocessed|succeeded:1000|org_payable:1000/0 provider_clearing:0/1000|1|1|1',
  'a confirmed partial refund posts the reverse transaction once and keeps the payment succeeded');
select is(pg_temp.act('a', $$select public.admin_refund_payment((select pay_e1 from t_ids), 500, 'error', 'refund-key-3')$$)
  || pg_temp.event('evt-r3', jsonb_build_object('type', 'refund.failed',
       'refund_id', pg_temp.val(null, $$select id from billing.refunds where idempotency_key = 'refund-key-3'$$)))
  || '|' || pg_temp.val(null, $$select r.status || ':' || p.refunded_agorot from billing.refunds r join billing.payments p on p.id = r.payment_id
              where r.idempotency_key = 'refund-key-3'$$), 'okprocessed|failed:1000', 'a refund the provider refused moves nothing');
select is(pg_temp.act('a', $$select public.admin_refund_payment((select pay_e1 from t_ids), 4000, 'error', 'refund-key-4')$$)
  || pg_temp.event('evt-r4', jsonb_build_object('type', 'refund.succeeded',
       'refund_id', pg_temp.val(null, $$select id from billing.refunds where idempotency_key = 'refund-key-4'$$)))
  || '|' || pg_temp.val(null, $$select p.status || ':' || p.refunded_agorot from billing.payments p, t_ids where p.id = pay_e1$$)
  || '|' || pg_temp.act('a', $$select public.admin_refund_payment((select pay_e1 from t_ids), 1, 'error', 'refund-key-5')$$)
  || '|' || pg_temp.val('e', $$select string_agg(status, ',' order by amount_agorot) from public.list_my_donation_history()$$),
  'okprocessed|refunded:5000|payment_not_refundable|succeeded,refunded', 'a full refund marks the payment refunded, and that is final');

-- ── Payouts ─────────────────────────────────────────────────────────────────
select is((select kc_private.billing_org_balance(id) from public.organizations where slug = 'aid'), 1800::bigint,
  'the organization is owed what was collected less what was refunded');
select is(pg_temp.act('service_role', $$select public.api_payout_open(&aid, 1801, 'payout-key-1')$$)
  || '|' || pg_temp.act('service_role', $$select public.api_payout_open(&aid, 1000, 'payout-key-2')$$)
  || pg_temp.act('service_role', $$select public.api_payout_open(&aid, 1000, 'payout-key-2')$$)
  || '|' || pg_temp.act('service_role', $$select public.api_payout_open(&aid, 801, 'payout-key-3')$$)
  || '|' || pg_temp.val(null, 'select count(*) from billing.payouts'),
  'insufficient_balance|okok|insufficient_balance|1', 'a payout stays within the balance, counting payouts on the way, once per key');
select is(pg_temp.event('evt-p1', jsonb_build_object('type', 'payout.succeeded', 'provider_ref', 'po_1', 'payout_id', (select id from billing.payouts)))
  || pg_temp.event('evt-p2', jsonb_build_object('type', 'payout.failed', 'payout_id', (select id from billing.payouts)))
  || '|' || pg_temp.val(null, $$select status || ':' || provider_ref from billing.payouts$$)
  || '|' || pg_temp.val(null, 'select kc_private.billing_org_balance(&aid)')
  || '|' || pg_temp.audited('payout_opened') || pg_temp.audited('payout_settled'),
  'processedprocessed|succeeded:po_1|800|11', 'a confirmed payout leaves the ledger once; a later contrary event changes nothing');

-- ── Standing orders ─────────────────────────────────────────────────────────
select is(pg_temp.act('d', $$select public.create_standing_order(&aid, 2000, 'order-key-1', 'yearly')$$)
  || '|' || pg_temp.act('d', $$select public.create_standing_order(&aid, 100, 'order-key-1')$$)
  || '|' || pg_temp.val('d', $$select public.create_standing_order(&aid, 2000, 'order-key-1') ->> 'status'$$)
  || '|' || pg_temp.val('d', $$select public.create_standing_order(&aid, 2000, 'order-key-1') ->> 'status'$$)
  || '|' || pg_temp.val(null, 'select count(*) from billing.standing_orders'),
  'cadence_not_supported|money_min_amount|pending|pending|1', 'a monthly standing order waits for the provider''s mandate');
create temporary table t_order as select id from billing.standing_orders;
grant select on t_order to public;
select is(pg_temp.act('d', $$select public.pause_standing_order((select id from t_order))$$)
  || '|' || pg_temp.act('d', $$select public.resume_standing_order((select id from t_order))$$)
  || '|' || pg_temp.act('e', $$select public.cancel_standing_order((select id from t_order))$$),
  'illegal_transition|forbidden_role|order_not_found', 'a pending order is not paused, not activated by its member, and not another member''s');
select is(pg_temp.event('evt-so1', jsonb_build_object('type', 'standing_order.activated', 'provider_ref', 'mandate_1',
    'standing_order_id', (select id from t_order)))
  || '|' || pg_temp.val(null, $$select status || ':' || (next_charge_at <= now()) from billing.standing_orders$$),
  'processed|active:true', 'the provider''s confirmation activates it; the first charge is due');
select is(pg_temp.val('service_role', $$select count(*) || ':' || max(mandate_ref) || ':' || max(amount_agorot) from public.api_standing_orders_charge_due()$$)
  || '|' || pg_temp.val('service_role', 'select count(*) from public.api_standing_orders_charge_due()')
  || '|' || pg_temp.val(null, $$select i.status || ':' || (o.next_charge_at > now() + interval '27 days')
               from billing.donation_intents i join billing.standing_orders o on o.id = i.standing_order_id$$),
  '1:mandate_1:2000|0|checkout:true', 'the charger opens each due charge once and moves the order a month ahead');
select is(pg_temp.event('evt-so2', jsonb_build_object('type', 'payment.failed',
    'intent_id', (select id from billing.donation_intents where standing_order_id is not null)))
  || '|' || pg_temp.told('standing_order_charge_failed', 'd'), 'processed|1', 'the member is told when a charge fails');
select is(pg_temp.val('d', $$select public.pause_standing_order((select id from t_order)) ->> 'status'$$)
  || '|' || pg_temp.val(null, 'select next_charge_at is null from billing.standing_orders')
  || '|' || pg_temp.val('d', $$select public.resume_standing_order((select id from t_order)) ->> 'status'$$)
  || '|' || pg_temp.val('d', $$select public.cancel_standing_order((select id from t_order)) ->> 'status'$$)
  || '|' || pg_temp.val('d', $$select public.cancel_standing_order((select id from t_order)) ->> 'status'$$)
  || '|' || pg_temp.act('d', $$select public.resume_standing_order((select id from t_order))$$)
  || '|' || pg_temp.audited('standing_order_cancelled'),
  'paused|true|active|cancelled|cancelled|illegal_transition|1', 'the member pauses, resumes and cancels; a cancelled order is final');
select is(pg_temp.val('d', $$select count(*) || ':' || max(o ->> 'org_name') from public.list_my_standing_orders() o$$)
  || '|' || pg_temp.val('e', 'select count(*) from public.list_my_standing_orders()'), '1:Aid|0', 'a member lists their own standing orders');

-- ── KYC and entitlements ────────────────────────────────────────────────────
select is(pg_temp.event('evt-k1', $${"type":"kyc.updated","party_type":"payer","party_id":"00000000-0000-4000-8000-00000000000d","status":"approved"}$$)
  || pg_temp.event('evt-k2', jsonb_build_object('type', 'kyc.updated', 'party_type', 'recipient', 'status', 'rejected',
       'party_id', (select id from public.organizations where slug = 'aid')))
  || '|' || pg_temp.event('evt-k3', $${"type":"kyc.updated","party_type":"payer","party_id":"00000000-0000-4000-8000-00000000000d","status":"maybe"}$$)
  || '|' || pg_temp.val(null, $$select string_agg(party_type || ':' || status || ':' || (verified_at is not null), ' ' order by party_type) from billing.kyc_profiles$$),
  'processedprocessed|failed:unknown_state|payer:approved:true recipient:rejected:false', 'the provider reports KYC states along the machine');
select is(pg_temp.val('service_role', $$select public.api_revenuecat_set_pro(@d, true, now() + interval '1 month') ->> 'status'$$)
  || '|' || pg_temp.val('d', $$select public.api_my_pro_status() ->> 'is_pro'$$) || pg_temp.val('e', $$select public.api_my_pro_status() ->> 'is_pro'$$)
  || '|' || pg_temp.val('service_role', $$select public.api_revenuecat_set_pro(@d, true, now() - interval '1 minute') ->> 'status'$$)
  || pg_temp.val('d', $$select public.api_my_pro_status() ->> 'is_pro'$$)
  || '|' || pg_temp.val('service_role', $$select public.api_revenuecat_set_pro(@d, false, null) ->> 'status'$$)
  || '|' || pg_temp.val('service_role', $$select public.api_revenuecat_set_pro(gen_random_uuid(), true, null) ->> 'status'$$),
  'granted|truefalse|grantedfalse|revoked|unknown_user', 'the store sets the Pro tier; it ends when it expires or is revoked');
select is(pg_temp.val('service_role', $$select public.api_set_pro_entitlement(@d, true, null, 'promo') ->> 'status'$$)
  || '|' || pg_temp.val('service_role', $$select public.api_revenuecat_set_pro(@d, false, null) ->> 'status'$$)
  || '|' || pg_temp.val('d', $$select (public.api_my_pro_status() ->> 'is_pro') || (public.api_my_pro_status() ->> 'source')$$),
  'granted|skipped_manual_grant|truepromo', 'the store never overrides an entitlement granted by hand');

-- ── Organization finance, by role ───────────────────────────────────────────
select is(pg_temp.act('f', $$select public.finance_ledger_list(&aid)$$) || pg_temp.act('c', $$select public.finance_ledger_list(&aid)$$)
  || pg_temp.act('a', $$select public.finance_ledger_list(&aid)$$) || '|' || pg_temp.act('b', $$select public.finance_ledger_list(&aid)$$)
  || pg_temp.act('1', $$select public.finance_ledger_list(&aid)$$) || pg_temp.act('anon', $$select public.finance_ledger_list(&aid)$$)
  || '|' || pg_temp.act('b', $$select public.finance_ledger_list(&kc)$$) || pg_temp.act('f', $$select public.finance_ledger_list(&kc)$$),
  'okokok|425014250142501|ok42501',
  'the books are read by the organization''s finance roles and platform admins; a moderator reads the platform''s only');
select is(pg_temp.act('c', $$select public.finance_ledger_upsert(&aid, null, 'expense', 100)$$)
  || pg_temp.act('b', $$select public.finance_ledger_upsert(&kc, null, 'expense', 100)$$)
  || pg_temp.act('f', $$select public.finance_account_upsert(&kc, null, 'Bank', 'bank')$$)
  || pg_temp.act('f', $$select public.finance_transparency_settings_set(&aid, '{"show_totals":true}')$$),
  repeat('42501', 4), 'an accountant and a moderator write nothing; a treasurer stays in their organization and does not publish');
select is(pg_temp.act('f', $$select public.finance_account_upsert(&aid, null, 'Bank', 'bank', '1234', 10000)$$)
  || pg_temp.act('f', $$select public.finance_ledger_upsert(&aid, null, 'expense', 2500, now() - interval '1 day',
       (select id from public.finance_accounts_list(&aid) where kind = 'bank'), 'Printer Ltd', 'program', null, 'cleared')$$)
  || '|' || pg_temp.act('f', $$select public.finance_ledger_upsert(&aid, null, 'expense', 0)$$)
  || '|' || pg_temp.act('f', $$select public.finance_ledger_upsert(&aid, null, 'expense', 5, now() + interval '2 days')$$)
  || '|' || pg_temp.act('f', $$select public.finance_ledger_upsert(&aid, null, 'expense', 5, now(), gen_random_uuid())$$)
  || '|' || pg_temp.val('c', $$select string_agg(kind || ':' || balance_agorot, ' ' order by kind) from public.finance_accounts_list(&aid)$$)
  || '|' || pg_temp.audited('finance_entry_create') || pg_temp.audited('finance_account_upsert'),
  'okok|23514|invalid_date|account_not_found|bank:7500 payment_provider:1800|11',
  'the treasurer keeps accounts and entries; balances count cleared entries');
create temporary table t_entry as
  select (select id from billing.org_finance_entries where kind = 'expense') as manual,
         (select e.id from billing.org_finance_entries e
           where e.source_ref like 'payment:%'
             and e.org_id = (select o.id from public.organizations o where o.slug = 'aid')
           order by e.id limit 1) as synced;
grant select on t_entry to public;
select is(pg_temp.act('f', $$select public.finance_ledger_mark(&aid, (select manual from t_entry), null, true)$$)
  || '|' || pg_temp.act('f', $$select public.finance_ledger_upsert(&aid, (select manual from t_entry), null, 9999)$$)
  || '|' || pg_temp.act('f', $$select public.finance_ledger_mark(&aid, (select manual from t_entry), 'mistake')$$)
  || '|' || pg_temp.act('f', $$select public.finance_ledger_upsert(&aid, (select manual from t_entry), null, null, null, null, null, null, 'new text')$$)
  || '|' || pg_temp.act('f', $$select public.finance_ledger_mark(&aid, (select manual from t_entry), null, false)$$)
  || pg_temp.act('f', $$select public.finance_ledger_upsert(&aid, (select manual from t_entry), null, 3000)$$)
  || '|' || pg_temp.val(null, $$select amount_agorot || ':' || description || ':' || (reconciled_at is null) from billing.org_finance_entries, t_entry where id = manual$$),
  'ok|entry_reconciled|entry_reconciled|ok|okok|3000:new text:true',
  'a reconciled entry is frozen in amount and status until it is un-reconciled; its text stays editable');
select is(pg_temp.act('f', $$select public.finance_ledger_upsert(&aid, (select synced from t_entry), null, 1)$$)
  || '|' || pg_temp.act('f', $$select public.finance_ledger_upsert(&aid, (select synced from t_entry), null, null, null, null, null, 'grants')$$)
  || '|' || pg_temp.act('f', $$select public.finance_ledger_upsert(&kc, (select synced from t_entry), null, null, null, null, null, 'x')$$),
  'entry_locked_by_source|ok|42501', 'a mirrored entry keeps its amount; its category may change; another organization cannot touch it');
select is(pg_temp.act('f', $$select public.finance_ledger_mark(&aid, (select manual from t_entry), 'x')$$)
  || '|' || pg_temp.act('f', $$select public.finance_ledger_mark(&aid, (select manual from t_entry), 'entered twice')$$)
  || '|' || pg_temp.act('f', $$select public.finance_ledger_upsert(&aid, (select manual from t_entry), null, 1)$$)
  || '|' || pg_temp.val('c', $$select count(*) filter (where kind = 'expense') || ':' || count(*) from public.finance_ledger_list(&aid)$$)
  || '|' || pg_temp.val('c', $$select count(*) from public.finance_ledger_list(&aid, null, 'cancelled')$$)
  || '|' || pg_temp.val('c', $$select balance_agorot from public.finance_accounts_list(&aid) where kind = 'bank'$$)
  || '|' || pg_temp.audited('finance_entry_void'),
  '23514|ok|entry_voided|0:5|1|10000|1', 'void replaces delete: it needs a reason, is final, and the entry counts nowhere');
select throws_ok($$update billing.org_finance_entries set status = 'pending' where status = 'cancelled'$$, 'P0001', 'entry_voided',
  'a voided entry is frozen for every writer');

-- ── Public numbers ──────────────────────────────────────────────────────────
select is(pg_temp.val('1', $$select public.rpc_org_transparency('aid')$$), '{"enabled": false}', 'nothing is public until the organization switches a block on');
select is(pg_temp.act('a', $$select public.finance_transparency_settings_set(&aid, '{"show_totals":true,"show_all":true}')$$)
  || '|' || pg_temp.act('a', $$select public.finance_transparency_settings_set(&aid, '{"show_totals":"yes"}')$$)
  || '|' || pg_temp.act('a', $$select public.finance_transparency_settings_set(&aid, '{"show_totals":true,"show_donations_count":true}')$$)
  || '|' || pg_temp.audited('transparency_settings_set'), 'invalid_settings|invalid_settings|ok|1', 'the public blocks are switched by name, with booleans');
select is(pg_temp.val('1', $$select (t ->> 'income_agorot') || '|' || (t ->> 'expense_agorot') || '|' || (t ->> 'donations_count') || '|'
      || (t ? 'by_category') || '|' || (t::text ~* 'printer|grow|donor|user') from public.rpc_org_transparency('aid') t$$)
  || '|' || pg_temp.act('anon', $$select public.rpc_org_transparency('aid')$$),
  '6800|5000|3|false|false|42501', 'only the switched-on totals are returned, to signed-in members, with no party in them');
select is(pg_temp.val('1', $$select (p ->> 'total_raised_agorot') || '|' || (p ->> 'sec46_active') || '|' || (p::text ~* 'user|donor')
      from public.get_nonprofit_public_page('aid') p$$)
  || '|' || coalesce(pg_temp.val('1', $$select public.get_nonprofit_public_page('plain')$$), 'null')
  || '|' || pg_temp.act('anon', $$select public.get_nonprofit_public_page('aid')$$),
  '1800|false|false|null|42501', 'the nonprofit page shows what was raised, for verified nonprofits, to signed-in members');
select is(pg_temp.act('c', $$select public.finance_sec46_set(&aid, 'active', '580012345', current_date - 10, current_date + 300)$$)
  || '|' || pg_temp.act('f', $$select public.finance_sec46_set(&aid, 'active', '580012345')$$)
  || '|' || pg_temp.act('f', $$select public.finance_sec46_set(&aid, 'active', '580012345', current_date - 10, current_date + 300)$$)
  || '|' || pg_temp.event('evt-s46', jsonb_build_object('type', 'payment.succeeded', 'intent_id', pg_temp.intent('e', 'aid', 900, 'key-000e3')))
  || '|' || pg_temp.val(null, $$select r.serial || ':' || r.sec46_eligible || ':' || r.sec46_approval_number from billing.receipts r order by r.serial desc limit 1$$)
  || '|' || pg_temp.audited('finance_sec46_set'),
  '42501|23514|ok|processed|4:true:580012345|1', 'a receipt is Section 46(a) eligible only while the organization''s recorded approval is active');

-- ── Account purge and retention ─────────────────────────────────────────────
select is(pg_temp.act('service_role', $$select public.api_payment_method_save(@d, 'grow', 'tok_d', '4242', 'visa')$$)
  || pg_temp.act('d', $$select public.create_standing_order(&aid, 1500, 'order-key-2')$$)
  || pg_temp.act('d', $$select public.create_donation_intent(&aid, 600, 'key-000d9')$$), 'okokok', 'the donor has a saved method, an open order and an open intent');
create temporary table t_before as
  select (select count(*) from billing.payments) as payments, (select count(*) from billing.receipts) as receipts,
         (select count(*) from billing.ledger_entries) as ledger, (select count(*) from billing.donation_intents) as intents,
         kc_private.audit_tombstone_hash('00000000-0000-4000-8000-00000000000d') as hash;
select lives_ok($$delete from auth.users where id = '00000000-0000-4000-8000-00000000000d'$$, 'an account with money records is purged without error');
select is((select (count(*) = b.payments) || '|' || count(*) filter (where p.user_tombstone = b.hash and p.user_id is null)
             from billing.payments p, t_before b group by b.payments)
  || '|' || (select (count(*) = b.receipts) || '|' || count(*) filter (where r.user_tombstone = b.hash) from billing.receipts r, t_before b group by b.receipts)
  || '|' || (select (count(*) = b.ledger)::text from billing.ledger_entries, t_before b group by b.ledger)
  || '|' || (select (count(*) = b.intents)::text from billing.donation_intents, t_before b group by b.intents),
  'true|3|true|2|true|true', 'every payment, receipt, ledger line and intent is kept; the member reference became the tombstone');
select is((select string_agg(status, ',' order by created_at) from billing.standing_orders where user_tombstone is not null)
  || '|' || (select status from billing.donation_intents where idempotency_key = 'key-000d9')
  || '|' || (select count(*) from billing.payment_methods) || (select count(*) from billing.kyc_profiles where party_type = 'payer')
  || (select count(*) from billing.user_entitlements)
  || '|' || (select count(*) from billing.org_finance_entries e, t_before b where e.donor_tombstone = b.hash)
  || '|' || (select count(*) from billing.detached_parties d, t_before b where d.user_tombstone = b.hash)
  || '|' || pg_temp.audited('billing_user_detached'),
  'cancelled,cancelled|cancelled|000|2|1|1',
  'open orders and intents are cancelled; the token, KYC profile and entitlement leave with the account; the detachment is recorded');
select is((select count(*) from billing.settings) || pg_temp.act(null, 'insert into billing.settings (singleton) values (true)')
  || '|' || (select (retention_after_account_deletion is null)::text from billing.settings)
  || '|' || (select count(*) from kc_private.billing_detached_past_retention()),
  '123505|true|0', 'retention is one setting; while it is unset nothing is ever due');
update billing.detached_parties set detached_at = now() - interval '8 years';
update billing.settings set retention_after_account_deletion = interval '7 years';
select is((select count(*) from kc_private.billing_detached_past_retention()) || '|' || (select count(*) from billing.payments where user_tombstone is not null),
  '1|3', 'once a period is set, a detached member past it is listed; nothing is erased automatically');

-- Karma for money: a settled donation records one award event per payment (spec 07 §7.6),
-- and the amount is counted in whole tens of shekels.
select ok(exists (select 1 from kc_private.outbox_events e
                   where e.topic = 'karma' and e.payload ->> 'event_type' = 'donation'
                     and (e.payload -> 'quantity' ->> 'ils_10')::integer >= 0
                     and e.payload ->> 'subject' like 'donation:%'),
  'a settled donation records a karma award');
select is((select count(*) - count(distinct e.payload ->> 'subject')
             from kc_private.outbox_events e
            where e.topic = 'karma' and e.payload ->> 'event_type' = 'donation'),
          0::bigint, 'never more than one award per payment');

select * from finish();
rollback;
