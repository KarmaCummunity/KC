-- Billing ledger and receipts: a ledger transaction must balance when the database
-- transaction commits; a ledger line is never changed or removed by any role; posting is
-- idempotent per business record; receipts are numbered per organization without gaps,
-- also when an issue fails or is repeated, and are never rewritten.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as a role: 'ok', the P0001 message, or the SQLSTATE.
create function pg_temp.as_role(p_role text, p_sql text)
returns text
language plpgsql
as $$
begin
  begin
    perform set_config('role', p_role, true);
    execute p_sql;
    perform set_config('role', 'none', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'none', true);
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- A donation of the member to an organization that the provider settled; returns the payment id.
create function pg_temp.donate(p_org text, p_agorot bigint, p_key text)
returns uuid
language plpgsql
as $$
declare
  v_intent_id uuid;
begin
  insert into billing.donation_intents (user_id, org_id, amount_agorot, status, provider_id, idempotency_key)
  select '00000000-0000-4000-8000-00000000000a', o.id, p_agorot, 'checkout', p.id, p_key
    from public.organizations o, billing.payment_providers p where o.slug = p_org
  returning id into v_intent_id;
  return kc_private.billing_payment_settle(v_intent_id, true, 'grow:' || p_key, null);
end;
$$;

-- One value read after the statements before it in the same query.
create function pg_temp.one(p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  execute p_sql into v_value;
  return v_value;
end;
$$;

-- Serials of an organization's receipts, in order.
create function pg_temp.serials(p_org text)
returns text
language sql
as $$
  select string_agg(r.serial::text, ',' order by r.serial)
    from billing.receipts r join public.organizations o on o.id = r.org_id where o.slug = p_org;
$$;

select plan(27);

insert into auth.users (id, email, raw_app_meta_data)
values ('00000000-0000-4000-8000-00000000000a', 'a@example.test', '{"provider":"google"}');
insert into public.organizations (id, slug, name, is_verified_nonprofit) values
  ('60000000-0000-4000-8000-000000000001', 'aid', 'Aid', true), ('60000000-0000-4000-8000-000000000002', 'care', 'Care', true);
insert into billing.payment_providers (slug, display_name, is_default) values ('grow', 'Grow', true);

-- ── Balance at commit ───────────────────────────────────────────────────────
select is((select tgdeferrable and tginitdeferred from pg_trigger where tgname = 'ledger_entries_balanced'), true,
  'the balance check is a constraint trigger deferred to commit');
select lives_ok($q$do $do$ begin
    insert into billing.ledger_entries (txn_id, account, org_id, debit_agorot, ref_type, ref_id)
    values ('a0000000-0000-4000-8000-000000000001', 'provider_clearing', '60000000-0000-4000-8000-000000000001', 700, 'payment', 'b0000000-0000-4000-8000-000000000001');
    insert into billing.ledger_entries (txn_id, account, org_id, credit_agorot, ref_type, ref_id)
    values ('a0000000-0000-4000-8000-000000000001', 'org_payable', '60000000-0000-4000-8000-000000000001', 700, 'payment', 'b0000000-0000-4000-8000-000000000001');
    set constraints all immediate;
    set constraints all deferred;
  end $do$ $q$, 'lines may be written one by one: the transaction only has to balance at the end');
select throws_ok($q$do $do$ begin
    insert into billing.ledger_entries (txn_id, account, org_id, debit_agorot, ref_type, ref_id)
    values ('a0000000-0000-4000-8000-000000000002', 'provider_clearing', '60000000-0000-4000-8000-000000000001', 500, 'payment', 'b0000000-0000-4000-8000-000000000002');
    set constraints all immediate;
  end $do$ $q$, 'P0001', 'ledger_unbalanced', 'a one-legged transaction is rejected at commit');
select throws_ok($q$do $do$ begin
    insert into billing.ledger_entries (txn_id, account, org_id, debit_agorot, credit_agorot, ref_type, ref_id) values
      ('a0000000-0000-4000-8000-000000000003', 'provider_clearing', '60000000-0000-4000-8000-000000000001', 500, 0, 'payment', 'b0000000-0000-4000-8000-000000000003'),
      ('a0000000-0000-4000-8000-000000000003', 'org_payable', '60000000-0000-4000-8000-000000000001', 0, 499, 'payment', 'b0000000-0000-4000-8000-000000000003');
    set constraints all immediate;
  end $do$ $q$, 'P0001', 'ledger_unbalanced', 'debits must equal credits to the agora');
set constraints all deferred;
select is((select count(*) from billing.ledger_entries), 2::bigint, 'the rejected transactions left nothing behind');
select throws_ok($$insert into billing.ledger_entries (txn_id, account, org_id, debit_agorot, credit_agorot, ref_type, ref_id)
    values (gen_random_uuid(), 'org_payable', '60000000-0000-4000-8000-000000000001', 5, 5, 'payment', gen_random_uuid())$$,
  '23514', null, 'a line is a debit or a credit, not both');
select throws_ok($$insert into billing.ledger_entries (txn_id, account, org_id, debit_agorot, ref_type, ref_id)
    values (gen_random_uuid(), 'slush_fund', '60000000-0000-4000-8000-000000000001', 5, 'payment', gen_random_uuid())$$,
  '23514', null, 'only the known accounts exist');
select throws_ok($$insert into billing.ledger_entries (txn_id, account, org_id, debit_agorot, ref_type, ref_id)
    values (gen_random_uuid(), 'org_payable', '60000000-0000-4000-8000-000000000001', -5, 'payment', gen_random_uuid())$$,
  '23514', null, 'amounts are never negative');

-- ── Posting once ────────────────────────────────────────────────────────────
select lives_ok($$select kc_private.ledger_post('payout', 'b0000000-0000-4000-8000-000000000009',
    '60000000-0000-4000-8000-000000000001', 'org_payable', 'provider_clearing', 300)$$, 'a payout is posted');
select lives_ok($$select kc_private.ledger_post('payout', 'b0000000-0000-4000-8000-000000000009',
    '60000000-0000-4000-8000-000000000001', 'org_payable', 'provider_clearing', 300)$$, 'posting the same record again is accepted');
select is((select count(*) || '|' || count(distinct txn_id) from billing.ledger_entries where ref_type = 'payout'), '2|1',
  '… and adds no line');
select is(kc_private.billing_org_balance('60000000-0000-4000-8000-000000000001'), 400::bigint,
  'the balance owed to an organization is read from the ledger');

-- ── Append-only for every role ──────────────────────────────────────────────
-- Run the pending balance checks now, as a commit would.
set constraints all immediate;
set constraints all deferred;
select throws_ok($$update billing.ledger_entries set debit_agorot = debit_agorot + 1$$, 'P0001', 'append_only', 'the owner cannot change a line');
select throws_ok($$delete from billing.ledger_entries$$, 'P0001', 'append_only', 'the owner cannot remove a line');
select throws_ok($$truncate billing.ledger_entries$$, 'P0001', 'append_only', 'the owner cannot empty the ledger');
select is(pg_temp.as_role('service_role', 'update billing.ledger_entries set credit_agorot = 0')
  || pg_temp.as_role('service_role', 'delete from billing.ledger_entries')
  || pg_temp.as_role('service_role', 'truncate billing.ledger_entries')
  || pg_temp.as_role('service_role', $$insert into billing.ledger_entries (txn_id, account, org_id, debit_agorot, ref_type, ref_id)
       values (gen_random_uuid(), 'org_payable', '60000000-0000-4000-8000-000000000001', 5, 'payment', gen_random_uuid())$$)
  || pg_temp.as_role('service_role', 'select count(*) from billing.ledger_entries'),
  '42501425014250142501ok', 'the service role reads the ledger and can do nothing else to it');
select is(pg_temp.as_role('authenticated', 'select 1 from billing.ledger_entries')
  || pg_temp.as_role('authenticated', 'delete from billing.ledger_entries')
  || pg_temp.as_role('anon', 'update billing.ledger_entries set credit_agorot = 0'),
  '425014250142501', 'client roles cannot address it at all');
select is((select count(*) || '|' || sum(debit_agorot) || '|' || sum(credit_agorot) from billing.ledger_entries), '4|1000|1000',
  'after every attempt the ledger is intact and balanced');

-- ── Gapless receipts ────────────────────────────────────────────────────────
select is((select count(*) from (select pg_temp.donate('aid', 1000, 'gapless-1'), pg_temp.donate('aid', 2000, 'gapless-2'),
                                        pg_temp.donate('care', 3000, 'gapless-3')) d)
  || '|' || pg_temp.serials('aid') || '|' || pg_temp.serials('care'), '1|1,2|1', 'each organization numbers its receipts from 1');
select is((select c.xmin::text::bigint = pg_current_xact_id()::text::bigint % 4294967296 from billing.receipt_counters c
            where c.org_id = '60000000-0000-4000-8000-000000000001'), true,
  'the issuing transaction holds the organization''s counter row until it ends, so a competing issue waits for it');
select throws_ok($q$do $do$ begin
    perform pg_temp.donate('aid', 1500, 'gapless-fail');
    raise exception 'provider_timeout' using errcode = 'P0001';
  end $do$ $q$, 'P0001', 'provider_timeout', 'a donation whose transaction fails after its receipt was numbered …');
select is((select pg_temp.donate('aid', 1500, 'gapless-4') is not null)::text || '|' || pg_temp.serials('aid')
  || '|' || pg_temp.one($$select last_serial from billing.receipt_counters where org_id = '60000000-0000-4000-8000-000000000001'$$),
  'true|1,2,3|3', '… gives its number back: the next receipt continues without a gap');
select is((select (kc_private.billing_receipt_issue(r.payment_id)).serial from billing.receipts r where r.serial = 2 and r.amount_agorot = 2000)
  || '|' || pg_temp.serials('aid'), '2|1,2,3', 'issuing again for the same payment returns the same receipt and consumes no number');
select throws_ok($$select kc_private.billing_receipt_issue(gen_random_uuid())$$, 'P0001', 'payment_not_found', 'only a succeeded payment gets a receipt');
select throws_ok($$insert into billing.receipts (org_id, serial, payment_id, user_id, amount_agorot)
    select org_id, 2, id, user_id, amount_agorot from billing.payments limit 1$$, '23505', null,
  'a serial is used once within an organization, and a payment has one receipt');

-- ── Receipts are never rewritten ────────────────────────────────────────────
select is((select count(*) from pg_proc p where p.proname = 'receipts_guard')
  || pg_temp.as_role('none', 'update billing.receipts set amount_agorot = 1')
  || '|' || pg_temp.as_role('none', 'update billing.receipts set serial = serial + 10')
  || '|' || pg_temp.as_role('none', 'delete from billing.receipts')
  || '|' || pg_temp.as_role('none', 'truncate billing.receipts')
  || '|' || pg_temp.as_role('service_role', 'delete from billing.receipts'),
  '1append_only|append_only|append_only|append_only|42501', 'no role changes, renumbers or removes a receipt');
select is(pg_temp.as_role('none', $$update billing.receipts set user_id = null, user_tombstone = sha256('x')$$)
  || '|' || pg_temp.serials('aid') || '|' || pg_temp.one('select count(*) from billing.receipts where user_tombstone is not null'),
  'ok|1,2,3|4', 'the only change a receipt admits is the swap of its member reference for a tombstone');

select * from finish();
rollback;
