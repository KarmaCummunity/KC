-- supabase/tests/0689_money_sandbox_gate_org_membership_writes.sql
-- Sandbox completion follows the sandbox_payments flag; org memberships have no client writes.

begin;

do $$
begin
  -- Clients hold no write privilege on org_memberships and no insert policy remains.
  perform kc_test.assert_true(not has_table_privilege('authenticated', 'public.org_memberships', 'INSERT'),
    'authenticated must not insert org_memberships');
  perform kc_test.assert_true(not has_table_privilege('authenticated', 'public.org_memberships', 'UPDATE'),
    'authenticated must not update org_memberships');
  perform kc_test.assert_true(not has_table_privilege('authenticated', 'public.org_memberships', 'DELETE'),
    'authenticated must not delete org_memberships');
  perform kc_test.assert_true(
    not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = 'org_memberships' and cmd in ('INSERT', 'ALL')
    ),
    'org_memberships has no insert policy');

  -- The internal body is not callable by clients.
  perform kc_test.assert_true(
    not has_function_privilege('authenticated', 'kc_private.complete_sandbox_donation_unchecked(uuid)', 'EXECUTE'),
    'authenticated must not execute complete_sandbox_donation_unchecked');
end $$;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_user uuid := kc_test.create_user('sandbox689');
  v_intent public.donation_intents;
  v_done jsonb;
begin
  update public.organizations set is_verified_nonprofit = true where org_id = v_org;
  perform kc_test.act_as(v_user);
  v_intent := public.create_donation_intent(v_org, 36, 'idem-689-1', null);

  -- Flag off (the default outside kc-dev): completion is refused and nothing is paid.
  update public.app_flags set enabled = false where key = 'sandbox_payments';
  perform kc_test.assert_raises(
    format('select public.complete_sandbox_donation(%L)', v_intent.intent_id),
    'sandbox_payments_disabled',
    'sandbox completion refused while the flag is off');
  perform kc_test.assert_eq(
    (select status from public.donation_intents where intent_id = v_intent.intent_id),
    'checkout',
    'intent stays in checkout');

  -- Missing flag row fails closed too.
  delete from public.app_flags where key = 'sandbox_payments';
  perform kc_test.assert_raises(
    format('select public.complete_sandbox_donation(%L)', v_intent.intent_id),
    'sandbox_payments_disabled',
    'missing flag row counts as off');

  -- Flag on: the 0362 behaviour is unchanged.
  insert into public.app_flags (key, enabled) values ('sandbox_payments', true);
  v_done := public.complete_sandbox_donation(v_intent.intent_id);
  perform kc_test.assert_eq(v_done->>'status', 'paid', 'sandbox completion pays while the flag is on');
end $$;

rollback;

\echo '✓ 0689_money_sandbox_gate_org_membership_writes.sql passed'
