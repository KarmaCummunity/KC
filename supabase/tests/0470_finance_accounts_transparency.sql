-- supabase/tests/0470_finance_accounts_transparency.sql | 0470 (FR-FIN-003 lean, FR-FIN-022/023)
-- Covered: RPC grants (public transparency is the only anon-callable one); transparency is
-- OFF by default; the public aggregate counts only cleared, public, non-transfer, ILS entries
-- and never leaks counterparties; per-toggle blocks; settings validation + role gates;
-- account balances; account guards (name taken, inactive account); donors overview grouping;
-- ledger upsert/list round-trip of account_id + is_public.

begin;

create temp table personas as
select kc_test.create_user('fin470_super') as super_admin,
       kc_test.create_user('fin470_mod') as moderator,
       kc_test.create_user('fin470_member') as member;

-- At most one active super_admin may exist (TD-95); free the slot inside this transaction.
update public.admin_role_grants set revoked_at = now()
 where role = 'super_admin' and revoked_at is null;
insert into public.admin_role_grants (user_id, role)
select super_admin, 'super_admin' from personas;
insert into public.admin_role_grants (user_id, role)
select moderator, 'moderator' from personas;

-- ── Grants ────────────────────────────────────────────────────────────────────
do $$
begin
  perform kc_test.assert_true(
    has_function_privilege('anon', 'public.rpc_org_transparency(text)', 'execute'),
    'anon can read the public transparency aggregate');
  perform kc_test.assert_true(
    not has_function_privilege('anon', 'public.finance_accounts_list()', 'execute'),
    'anon cannot list accounts');
  perform kc_test.assert_true(
    not has_function_privilege('anon', 'public.finance_donors_summary(int)', 'execute'),
    'anon cannot read the donors overview');
  perform kc_test.assert_true(
    has_function_privilege('authenticated', 'public.finance_account_upsert(uuid, text, text, text, bigint, date, boolean, int)', 'execute'),
    'authenticated can call account upsert (role is enforced inside)');
  perform kc_test.assert_true(
    not has_function_privilege('authenticated', 'public.finance_platform_org_id()', 'execute'),
    'the platform-org helper is internal');
end $$;

-- ── Public transparency: off by default, aggregates only ──────────────────────
-- A dedicated non-platform org keeps the numbers independent of any existing ledger rows.
do $$
declare
  v_org uuid := gen_random_uuid();
  v_res jsonb;
  v_cur text := to_char(date_trunc('month', now()), 'YYYY-MM');
begin
  insert into public.organizations (org_id, name, slug, is_platform)
  values (v_org, 'Fin470 Org', 'fin470-org', false);

  v_res := public.rpc_org_transparency('fin470-org');
  perform kc_test.assert_eq(v_res, '{"enabled": false}'::jsonb, 'all toggles default to off');
  perform kc_test.assert_eq(public.rpc_org_transparency('no-such-org'), '{"enabled": false}'::jsonb,
    'unknown org exposes nothing');

  insert into public.finance_ledger_entries
    (org_id, kind, direction, amount_cents, counterparty, category, status, is_public, deleted_at)
  values
    (v_org, 'donation_in', 'in',  10000, 'Secret Donor', null,       'cleared', true,  null),
    (v_org, 'donation_in', 'in',   5000, 'Hidden Donor', null,       'cleared', false, null),
    (v_org, 'expense',     'out',  4000, 'Vendor A',     'program',  'cleared', true,  null),
    (v_org, 'expense',     'out',  1000, 'Vendor B',     'my custom','cleared', true,  null),
    (v_org, 'expense',     'out',  9999, 'Vendor C',     'program',  'pending', true,  null),
    (v_org, 'transfer',    'out',   777, 'Internal',     null,       'cleared', true,  null),
    (v_org, 'donation_in', 'in',   3333, 'Deleted One',  null,       'cleared', true,  now());

  update public.organizations
     set transparency_settings = '{"show_totals": true}'::jsonb where org_id = v_org;
  v_res := public.rpc_org_transparency('fin470-org');
  perform kc_test.assert_eq((v_res->>'income_cents')::bigint, 10000::bigint, 'only public cleared income counts');
  perform kc_test.assert_eq((v_res->>'expense_cents')::bigint, 5000::bigint, 'pending and transfer rows are excluded');
  perform kc_test.assert_eq((v_res->>'net_cents')::bigint, 5000::bigint, 'net = income - expense');
  perform kc_test.assert_true(not (v_res ? 'by_category') and not (v_res ? 'monthly')
                              and not (v_res ? 'donations_count') and not (v_res ? 'program_ratio'),
    'blocks of untouched toggles are absent');

  update public.organizations set transparency_settings = jsonb_build_object(
    'show_totals', true, 'show_program_ratio', true, 'show_category_breakdown', true,
    'show_monthly_trend', true, 'show_donations_count', true) where org_id = v_org;
  v_res := public.rpc_org_transparency('fin470-org');
  perform kc_test.assert_eq((v_res->>'program_ratio')::numeric, 0.8::numeric, 'program ratio = program / expenses');
  perform kc_test.assert_eq((v_res->>'donations_count')::bigint, 1::bigint, 'one public cleared donation');
  perform kc_test.assert_eq(jsonb_array_length(v_res->'by_category'), 2, 'program + folded other_out');
  perform kc_test.assert_eq(v_res->'by_category'->0, '{"key": "program", "cents": 4000}'::jsonb, 'largest category first');
  perform kc_test.assert_eq(v_res->'by_category'->1, '{"key": "other_out", "cents": 1000}'::jsonb, 'unknown category folds into other_out');
  perform kc_test.assert_eq(jsonb_array_length(v_res->'monthly'), 12, 'twelve trailing months');
  perform kc_test.assert_eq(
    (select (m->>'income_cents')::bigint from jsonb_array_elements(v_res->'monthly') m where m->>'month' = v_cur),
    10000::bigint, 'current month carries the income');
  -- Privacy: no counterparty ever appears in the payload.
  perform kc_test.assert_true(
    v_res::text not like '%Secret Donor%' and v_res::text not like '%Hidden Donor%'
    and v_res::text not like '%Vendor%' and v_res::text not like '%counterparty%',
    'public payload never contains counterparties');
end $$;

-- ── Settings RPCs: validation + role gates ────────────────────────────────────
do $$
declare
  v_super uuid := (select super_admin from personas);
  v_mod   uuid := (select moderator from personas);
  v_member uuid := (select member from personas);
  v_new jsonb;
begin
  perform kc_test.act_as(v_member);
  perform kc_test.assert_raises($q$select public.finance_transparency_settings_get()$q$, 'forbidden', 'member cannot read settings');

  perform kc_test.act_as(v_mod);
  perform kc_test.assert_eq(jsonb_typeof(public.finance_transparency_settings_get()), 'object', 'moderator may read settings');
  perform kc_test.assert_raises($q$select public.finance_transparency_settings_set('{"show_totals": true}')$q$,
    'forbidden', 'moderator cannot publish');

  perform kc_test.act_as(v_super);
  perform kc_test.assert_raises($q$select public.finance_transparency_settings_set('{"evil": true}')$q$,
    'invalid_settings', 'unknown key rejected');
  perform kc_test.assert_raises($q$select public.finance_transparency_settings_set('{"show_totals": "yes"}')$q$,
    'invalid_settings', 'non-boolean rejected');
  perform kc_test.assert_raises($q$select public.finance_transparency_settings_set('[]')$q$,
    'invalid_settings', 'non-object rejected');

  v_new := public.finance_transparency_settings_set('{"show_totals": true}');
  perform kc_test.assert_eq((v_new->>'show_totals')::boolean, true, 'toggle stored');
  v_new := public.finance_transparency_settings_set('{"show_monthly_trend": true}');
  perform kc_test.assert_true((v_new->>'show_totals')::boolean and (v_new->>'show_monthly_trend')::boolean,
    'partial update merges, keeps earlier toggles');
  v_new := public.finance_transparency_settings_set('{"show_totals": false, "show_monthly_trend": false}');
  perform kc_test.assert_eq(public.rpc_org_transparency(null), '{"enabled": false}'::jsonb,
    'switching every toggle off hides the platform section again');
end $$;

-- ── Accounts, balances, ledger round-trip ─────────────────────────────────────
do $$
declare
  v_mod uuid := (select moderator from personas);
  v_member uuid := (select member from personas);
  v_acc uuid;
  v_row record;
  v_entry uuid;
begin
  perform kc_test.act_as(v_member);
  perform kc_test.assert_raises($q$select * from public.finance_accounts_list()$q$, 'forbidden', 'member cannot list accounts');

  perform kc_test.act_as(v_mod);
  v_acc := public.finance_account_upsert(null, 'T470 Bank', 'bank', '1234', 100000, current_date, null, null);
  perform kc_test.assert_raises(
    $q$select public.finance_account_upsert(null, 'T470 Bank', 'cash', null, null, null, null, null)$q$,
    'account_name_taken', 'account names are unique per org');
  perform kc_test.assert_raises(
    $q$select public.finance_account_upsert(null, 'Bad Last4', 'bank', '12a4', null, null, null, null)$q$,
    'invalid_last4', 'last4 must be four digits');
  perform kc_test.assert_raises(
    $q$select public.finance_account_upsert(null, 'Bad Kind', 'crypto', null, null, null, null, null)$q$,
    'invalid_kind', 'unknown kind rejected');

  -- +25000 cleared, -5000 cleared, +99999 pending (ignored) => 100000 + 25000 - 5000
  perform public.finance_ledger_upsert(null, 'donation_in', 25000, null, null, 'Dana', null, null, null, 'cleared', v_acc, true);
  v_entry := public.finance_ledger_upsert(null, 'expense', 5000, null, null, 'Vendor', 'program', null, null, 'cleared', v_acc, false);
  perform public.finance_ledger_upsert(null, 'donation_in', 99999, null, null, 'Pending', null, null, null, 'pending', v_acc, true);

  select * into v_row from public.finance_accounts_list() where account_id = v_acc;
  perform kc_test.assert_eq(v_row.balance_cents, 120000::bigint, 'balance = opening + cleared in - cleared out');
  perform kc_test.assert_eq(v_row.entry_count, 3::bigint, 'entry_count includes every non-deleted entry');

  select * into v_row from public.finance_ledger_list(null, 'expense') where entry_id = v_entry;
  perform kc_test.assert_eq(v_row.account_id, v_acc, 'list returns account_id');
  perform kc_test.assert_eq(v_row.is_public, false, 'list returns is_public');

  -- Updating without the new params keeps them (defaults are no-ops).
  perform public.finance_ledger_upsert(v_entry, null, 6000);
  select * into v_row from public.finance_ledger_list(null, 'expense') where entry_id = v_entry;
  perform kc_test.assert_eq(v_row.amount_cents, 6000::bigint, 'amount updated');
  perform kc_test.assert_eq(v_row.account_id, v_acc, 'account kept on partial update');
  perform kc_test.assert_eq(v_row.is_public, false, 'is_public kept on partial update');

  -- Deactivated accounts cannot receive new entries; history stays.
  perform public.finance_account_upsert(v_acc, null, null, null, null, null, false, null);
  perform kc_test.assert_raises(
    format($q$select public.finance_ledger_upsert(null, 'expense', 1, null, null, null, null, null, null, null, %L, null)$q$, v_acc),
    'account_not_found', 'inactive account rejected for new entries');
  perform kc_test.assert_raises(
    $q$select public.finance_ledger_upsert(null, 'expense', 1, null, null, null, null, null, null, null, gen_random_uuid(), null)$q$,
    'account_not_found', 'unknown account rejected');
end $$;

-- ── Donors overview ───────────────────────────────────────────────────────────
do $$
declare
  v_mod uuid := (select moderator from personas);
  v_row record;
begin
  perform kc_test.act_as(v_mod);
  perform public.finance_ledger_upsert(null, 'donation_in', 7000, null, null, 'Dana', null, null, null, 'cleared', null, null);
  perform public.finance_ledger_upsert(null, 'grant_in',    3000, null, null, ' dana ', null, null, null, 'cleared', null, null);
  select * into v_row from public.finance_donors_summary(500) where lower(btrim(donor_name)) = 'dana';
  -- 25000 (account test above) + 7000 + 3000, all spelled "dana" in some casing/spacing.
  perform kc_test.assert_eq(v_row.donations_count, 3::bigint, 'spellings of one donor are grouped');
  perform kc_test.assert_eq(v_row.total_cents, 35000::bigint, 'grouped total');
  perform kc_test.assert_true(not exists (
    select 1 from public.finance_donors_summary(500) where donor_name = 'Pending'),
    'pending donations are not donor totals');
end $$;

rollback;

\echo '✓ 0470_finance_accounts_transparency.sql passed'
