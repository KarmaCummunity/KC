-- supabase/tests/0719_fsm_recurring.sql
-- Wave 6a (#1989): ride series and standing orders follow the kernel machines `ride_series` and
-- `standing_order`; a second cancel of a standing order changes nothing.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('w6a_driver') as driver,
       kc_test.create_user('w6a_donor')  as donor,
       gen_random_uuid()                 as org_id;

insert into public.organizations (org_id, name, slug)
select org_id, 'W6a Org', 'w6a-org-' || left(org_id::text, 8) from personas;

-- ── 1. A ride series pauses, resumes and cancels for good ──────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  insert into public.ride_series (owner_id, kind_id, direction, title, depart_time, weekdays)
  values (p.driver, kc_test.listing_kind_id('rides', 'ride_offer'), 'give', 'W6a commute', '07:30', 31)
  returning series_id into v;

  update public.ride_series set status = 'paused' where series_id = v;
  update public.ride_series set status = 'active' where series_id = v;
  update public.ride_series set status = 'cancelled' where series_id = v;
  perform kc_test.assert_raises(
    format('update public.ride_series set status = %L where series_id = %L', 'active', v),
    'ride_series_transition_invalid', 'a cancelled series is not resumed by any writer');
  perform kc_test.assert_raises(
    format('update public.ride_series set status = %L where series_id = %L', 'paused', v),
    'ride_series_transition_invalid', 'a cancelled series is not paused');
end $$;

-- ── 2. A standing order: the RPCs walk the graph, a cancel is final and idempotent ──
do $$
declare
  p personas;
  v uuid;
  v_first timestamptz;
begin
  select * into p from personas;
  insert into public.standing_orders (user_id, org_id, amount_ils, cadence, idempotency_key)
  values (p.donor, p.org_id, 50, 'monthly', 'w6a-' || gen_random_uuid()::text)
  returning order_id into v;

  perform kc_test.act_as(p.donor);
  perform public.pause_standing_order(v);
  perform public.resume_standing_order(v);
  perform public.cancel_standing_order(v);
  perform kc_test.assert_true(
    (select cancelled_at from public.standing_orders where order_id = v) is not null,
    'the cancel is stamped');

  -- now() is fixed inside the test transaction, so date the first cancel back to tell it apart.
  v_first := now() - interval '1 day';
  update public.standing_orders set cancelled_at = v_first where order_id = v;

  -- A second cancel returns the order as it is.
  perform public.cancel_standing_order(v);
  perform kc_test.assert_eq(
    (select cancelled_at from public.standing_orders where order_id = v), v_first,
    'a second cancel keeps the first cancellation time');
  perform kc_test.assert_raises(
    format('select public.resume_standing_order(%L)', v),
    'order_not_found', 'a cancelled order is not resumed');
end $$;

-- ── 3. Any other writer is held to the standing-order graph ────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  insert into public.standing_orders (user_id, org_id, amount_ils, cadence, status, idempotency_key)
  values (p.donor, p.org_id, 20, 'monthly', 'cancelled', 'w6a-' || gen_random_uuid()::text)
  returning order_id into v;
  perform kc_test.assert_raises(
    format('update public.standing_orders set status = %L where order_id = %L', 'active', v),
    'standing_order_transition_invalid', 'a cancelled order is not reactivated directly');
end $$;

rollback;
