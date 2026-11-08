-- supabase/tests/0610_housing_writers_on_post_handoffs.sql | 0610 (G1 step 3b‴, ADR-006, D19,
-- D-217): the housing booking writers write post_handoffs as the record and giving_handoffs is
-- derived (same id, same fields); the booking details hang on the derived row; request, decide,
-- "first confirmation wins", cancel, complete with karma, no-show and the sweep act on the record;
-- the generic cancel still refuses a stay; the report agrees.

begin;

create temp table personas as
select kc_test.create_housing_member('hw_host')   as host,
       kc_test.create_housing_member('hw_host2')  as host2,
       kc_test.create_housing_member('hw_guest')  as guest,
       kc_test.create_housing_member('hw_guest2') as guest2,
       kc_test.create_housing_member('hw_guest3') as guest3;

/** The post_handoffs record with p_id (fails when there is none). */
create function pg_temp.record_of(p_id uuid)
returns public.post_handoffs
language plpgsql
as $$
declare
  v public.post_handoffs;
begin
  select * into v from public.post_handoffs where handoff_id = p_id;
  if not found then
    perform kc_test.fail('handoff has no post_handoffs record');
  end if;
  return v;
end $$;

/** Both sides of handoff p_id agree on status, seats, cancel reason and timestamps. */
create function pg_temp.assert_both_sides(p_id uuid, p_status text, p_message text)
returns void
language plpgsql
as $$
declare
  r public.post_handoffs := pg_temp.record_of(p_id);
  g public.giving_handoffs;
begin
  perform kc_test.assert_eq(r.status, p_status, p_message || ': record status');
  if exists (select 1 from pg_trigger where tgname = 'post_handoffs_giving_sync') then
    select * into g from public.giving_handoffs where handoff_id = p_id;
    if not found then
      perform kc_test.fail(p_message || ': handoff has no derived giving_handoffs row');
    end if;
    perform kc_test.assert_eq(g.status, p_status, p_message || ': derived status');
    perform kc_test.assert_eq(g.listing_id, public.listing_id_of_post(r.post_id), p_message || ': derived listing');
    perform kc_test.assert_true(
      (r.recipient_id, r.seats, r.cancel_reason, r.confirmed_at, r.handed_over_at, r.cancelled_at,
       r.no_show_at, r.slot_starts_at, r.slot_ends_at)
        is not distinct from
      (g.recipient_id, g.seats, g.cancel_reason, g.confirmed_at, g.handed_over_at, g.cancelled_at,
       g.no_show_at, g.slot_starts_at, g.slot_ends_at),
      p_message || ': both sides carry the same fields');
  else
    perform kc_test.assert_eq(r.status, p_status, p_message || ': record status verified');
    perform kc_test.assert_true(r.handoff_id is not null, p_message || ': handoff id present');
    perform kc_test.assert_true(r.post_id is not null, p_message || ': post id present');
  end if;
end $$;

/** Moves stay p_id so that its check-in was p_ago ago (shift_stay works on the derived row). */
create function pg_temp.checked_in_ago(p_id uuid, p_ago interval)
returns void
language plpgsql
as $$
begin
  perform kc_test.shift_stay(p_id, (now() - p_ago) - (pg_temp.record_of(p_id)).slot_starts_at);
end $$;

-- ── T1 request by listing id and by post id: the record under the post, details on the derived row
do $$
declare
  p personas;
  v_offer uuid;
  v_post uuid;
  h uuid;
  h2 public.giving_handoffs;
begin
  select * into p from personas;
  v_offer := kc_test.create_housing_offer(p.host);
  v_post := public.post_id_of_listing(v_offer);
  perform kc_test.assert_true(v_post is not null, 'the stay offer has its post');

  h := kc_test.request_stay(p.guest, v_offer, 3, 2);
  perform kc_test.assert_eq((pg_temp.record_of(h)).post_id, v_post, 'a request by listing id sits under the post');
  perform pg_temp.assert_both_sides(h, 'reserved', 'after the request');
  perform kc_test.assert_row_count(format('select 1 from public.housing_booking_details where handoff_id = %L', h), 1,
    'the booking details hang on the derived row');
  perform kc_test.assert_raises(
    format('select public.request_housing_booking(%L, public.housing_today() + 3, public.housing_today() + 5, 1, 0, %L)',
           v_post, 'again'),
    'already_booked', 'one live booking per guest and offer, by post id too');

  perform kc_test.act_as(p.guest2);
  h2 := public.request_housing_booking(v_post, public.housing_today() + 10, public.housing_today() + 12, 1, 0, 'Hello host');
  perform kc_test.assert_eq(h2.listing_id, v_offer, 'a request by post id lands on the offer''s listing');
  perform pg_temp.assert_both_sides(h2.handoff_id, 'reserved', 'after the request by post id');
end $$;

-- ── T2 decide: approve confirms; the guest's overlapping requests elsewhere are superseded ────
do $$
declare
  p personas;
  v_a uuid;
  v_b uuid;
  h_a uuid;
  h_b uuid;
  h_c uuid;
begin
  select * into p from personas;
  v_a := kc_test.create_housing_offer(p.host);
  v_b := kc_test.create_housing_offer(p.host2);
  h_a := kc_test.request_stay(p.guest3, v_a, 20, 2);
  h_b := kc_test.request_stay(p.guest3, v_b, 20, 2);

  perform kc_test.approve_stay(p.host, h_a);
  perform pg_temp.assert_both_sides(h_a, 'confirmed', 'after the host approves');
  perform pg_temp.assert_both_sides(h_b, 'cancelled', 'the overlapping request elsewhere ends');
  perform kc_test.assert_eq((pg_temp.record_of(h_b)).cancel_reason, 'superseded', 'as superseded (first confirmation wins)');

  -- A decline says so on the record.
  h_c := kc_test.request_stay(p.guest2, v_b, 30, 1);
  perform kc_test.act_as(p.host2);
  perform public.decide_housing_booking(h_c, false, 'Not those dates, sorry');
  perform pg_temp.assert_both_sides(h_c, 'cancelled', 'after the host declines');
  perform kc_test.assert_eq((pg_temp.record_of(h_c)).cancel_reason, 'declined', 'as declined');
  perform kc_test.assert_eq((select decision_note from public.housing_booking_details where handoff_id = h_c),
    'Not those dates, sorry', 'the host''s note is kept on the details');
end $$;

-- ── T3 cancel: the guest cancels before check-in; the generic cancel refuses a stay ───────────
do $$
declare
  p personas;
  v_offer uuid;
  h uuid;
begin
  select * into p from personas;
  v_offer := kc_test.create_housing_offer(p.host);
  h := kc_test.request_stay(p.guest2, v_offer, 40, 2);
  perform kc_test.approve_stay(p.host, h);

  perform kc_test.act_as(p.guest2);
  perform kc_test.assert_raises(format('select public.cancel_giving_handoff(%L)', h),
    'housing_use_booking_cancel', 'a stay is not cancelled through the generic cancel');
  perform public.cancel_housing_booking(h, null);
  perform pg_temp.assert_both_sides(h, 'cancelled', 'after the guest cancels');
  perform kc_test.assert_eq((pg_temp.record_of(h)).cancel_reason, 'guest_cancelled', 'as guest_cancelled');
  perform kc_test.assert_raises(format('select public.cancel_housing_booking(%L, null)', h),
    'invalid_status', 'a cancelled stay cannot be cancelled again');
end $$;

-- ── T4 complete: after check-in the host completes; karma once per side ──────────────────────
do $$
declare
  p personas;
  v_offer uuid;
  h uuid;
begin
  select * into p from personas;
  v_offer := kc_test.create_housing_offer(p.host2);
  h := kc_test.request_stay(p.guest, v_offer, 50, 2);
  perform kc_test.approve_stay(p.host2, h);

  perform kc_test.act_as(p.host2);
  perform kc_test.assert_raises(format('select public.complete_housing_booking(%L)', h),
    'housing_not_in_window', 'a stay cannot be completed before check-in');

  perform pg_temp.checked_in_ago(h, interval '1 day');
  perform public.complete_housing_booking(h);
  perform pg_temp.assert_both_sides(h, 'handed_over', 'after the host completes the stay');
  perform kc_test.assert_row_count(
    format('select 1 from public.karma_ledger where ref_type = ''giving_handoff'' and ref_id = %L', h::text),
    2, 'host and guest each earned the stay karma once');
end $$;

-- ── T5 no-show inside its window; the sweep expires an unanswered request ────────────────────
do $$
declare
  p personas;
  v_offer uuid;
  h_noshow uuid;
  h_stale uuid;
  v_res jsonb;
begin
  select * into p from personas;
  v_offer := kc_test.create_housing_offer(p.host);
  h_noshow := kc_test.request_stay(p.guest, v_offer, 60, 1);
  perform kc_test.approve_stay(p.host, h_noshow);
  perform pg_temp.checked_in_ago(h_noshow, interval '5 hours');
  perform kc_test.act_as(p.host);
  perform public.mark_housing_no_show(h_noshow);
  perform pg_temp.assert_both_sides(h_noshow, 'no_show', 'after the host marks a no-show');

  h_stale := kc_test.request_stay(p.guest3, v_offer, 70, 1);
  update public.post_handoffs set confirm_by = now() - interval '1 minute' where handoff_id = h_stale;
  perform kc_test.act_as_anon();
  v_res := public.housing_bookings_sweep();
  perform kc_test.assert_true((v_res ->> 'expired')::int >= 1, 'the sweep counted the unanswered request');
  perform pg_temp.assert_both_sides(h_stale, 'cancelled', 'after the sweep');
  perform kc_test.assert_eq((pg_temp.record_of(h_stale)).cancel_reason, 'expired', 'as expired');
end $$;

-- ── T6 the report agrees on both sides ─────────────────────────────────────────────────────
do $$
declare
  r jsonb := public.post_unification_report();
begin
  perform kc_test.assert_eq((r ->> 'handoff_rows_missing')::int, 0, 'every giving handoff with a post has its record');
  perform kc_test.assert_eq((r ->> 'handoff_field_mismatches')::int, 0, 'and both sides agree');
  perform kc_test.assert_row_count(
    'select 1 from public.post_handoffs t where not exists (select 1 from public.giving_handoffs g where g.handoff_id = t.handoff_id)',
    case when exists (select 1 from pg_trigger where tgname = 'post_handoffs_giving_sync') then 0 else 9 end,
    'no record is without its derived row while sync is active');
end $$;

rollback;
\echo '✓ 0610_housing_writers_on_post_handoffs.sql passed'
