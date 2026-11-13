-- Housing stays lifecycle (H1, 0600–0603; docs/spec/requirements/21_housing.md):
-- eligibility/conduct, offer/request rules, booking guards, approval, cancellation, completion, sweep.
begin;

create temp table personas as
select kc_test.create_housing_member('housing_host') as host,
       kc_test.create_housing_member('housing_host2') as host2,
       kc_test.create_housing_member('housing_guest') as guest,
       kc_test.create_housing_member('housing_guest2') as guest2,
       kc_test.create_user('housing_unverified') as unverified,
       kc_test.create_user('housing_stranger') as stranger;

create temp table no_conduct as select kc_test.create_user('housing_no_conduct') as id;
update public.users set verified_at = now(), verification_method = 'manual' where user_id = (select id from no_conduct);

create function pg_temp.h_seats(p_h uuid) returns int language sql stable as $$
  select coalesce((select seats from public.giving_handoffs where handoff_id = p_h),
                  (select seats from public.post_handoffs where handoff_id = p_h))
$$;
create function pg_temp.h_cancel_reason(p_h uuid) returns text language sql stable as $$
  select coalesce((select cancel_reason from public.giving_handoffs where handoff_id = p_h),
                  (select cancel_reason from public.post_handoffs where handoff_id = p_h))
$$;
create function pg_temp.h_confirm_by(p_h uuid) returns timestamptz language sql stable as $$
  select coalesce((select confirm_by from public.giving_handoffs where handoff_id = p_h),
                  (select confirm_by from public.post_handoffs where handoff_id = p_h))
$$;

-- 1) Eligibility (FR-HOUSING-003): verification first, then the code of conduct.
do $$
declare
  p personas;
  v_nc uuid := (select id from no_conduct);
  v_offer uuid;
begin
  select * into p from personas;
  perform kc_test.assert_raises(format('select kc_test.create_housing_offer(%L)', p.unverified),
    'world_permission_denied', 'an unverified member cannot publish in housing');
  perform kc_test.assert_raises(format('select kc_test.create_housing_offer(%L)', v_nc),
    'housing_conduct_required', 'a verified member must accept the code of conduct first');

  perform kc_test.act_as(v_nc);
  perform kc_test.assert_raises('select public.accept_housing_conduct(public.housing_conduct_version() + 1)',
    'housing_conduct_version_stale', 'only the current conduct version can be accepted');
  perform public.accept_housing_conduct(public.housing_conduct_version());
  perform public.accept_housing_conduct(public.housing_conduct_version());
  v_offer := kc_test.create_housing_offer(v_nc);
  perform kc_test.assert_eq((select c.slug from public.listings l join public.categories c on c.category_id = l.category_id
    where l.listing_id = v_offer), 'stays', 'a stay offer lands in the stays sub-category');
  perform kc_test.assert_eq((select visibility from public.listings where listing_id = v_offer), 'Public', 'public by default');
  perform kc_test.assert_true((select expires_at is null from public.listings where listing_id = v_offer), 'ongoing offer never expires');
end $$;

-- 2) Offer and request rules beyond the schema (FR-HOUSING-005, 006, 011).
do $$
declare
  p personas;
  v_window uuid;
  v_request uuid;
begin
  select * into p from personas;
  perform kc_test.assert_raises(format('select kc_test.create_housing_offer(%L, %L::jsonb)', p.host, '{"min_nights":5,"max_nights":2}'),
    'housing_nights_out_of_range', 'min nights cannot exceed max nights');
  perform kc_test.assert_raises(format('select kc_test.create_housing_offer(%L, %L::jsonb)', p.host, '{"place_type":"couch","exclusive":true}'),
    'housing_details_invalid', 'a couch cannot be exclusive');
  perform kc_test.assert_raises(format('select kc_test.create_housing_offer(%L, %L::jsonb)', p.host, '{"place_type":"tent_pitch"}'),
    'housing_tent_facilities_required', 'a tent pitch states its facilities');
  perform kc_test.assert_raises(format('select kc_test.create_housing_offer(%L, %L::jsonb)', p.host, '{"place_type":"castle"}'),
    'listing_details_schema_mismatch', 'rejects unknown place types');

  v_window := kc_test.create_housing_offer(p.host, jsonb_build_object('availability', jsonb_build_object(
    'mode', 'window', 'from', public.housing_today()::text, 'until', (public.housing_today() + 10)::text)));
  perform kc_test.assert_eq((select expires_at from public.listings where listing_id = v_window),
    public.housing_local_midnight(public.housing_today() + 11), 'window offer expires after its last night');

  perform kc_test.assert_raises(format($sql$select kc_test.create_listing(%L, 'housing', 'stay_request', 'request', 'Need a bed',
    jsonb_build_object('stay_purpose','trail_walk','adults',1,'minors',0,'check_in_date', (public.housing_today() + 3)::text, 'check_out_date', (public.housing_today() + 3)::text))$sql$,
    p.guest), 'housing_nights_out_of_range', 'needs at least one night');
  perform kc_test.assert_raises(format($sql$select kc_test.create_listing(%L, 'housing', 'stay_request', 'request', 'Need a bed',
    jsonb_build_object('stay_purpose','trail_walk','adults',1,'minors',0,'check_in_date', (public.housing_today() - 1)::text, 'check_out_date', (public.housing_today() + 1)::text))$sql$,
    p.guest), 'housing_dates_invalid', 'cannot start in past');
  v_request := kc_test.create_listing(p.guest, 'housing', 'stay_request', 'request', 'Need a bed',
    jsonb_build_object('stay_purpose', 'trail_walk', 'adults', 2, 'minors', 0, 'flexible_days', 1,
      'check_in_date', (public.housing_today() + 3)::text, 'check_out_date', (public.housing_today() + 5)::text));
  perform kc_test.assert_eq((select expires_at from public.listings where listing_id = v_request),
    public.housing_local_midnight(public.housing_today() + 7), 'request expires after latest check-out day');
end $$;

-- 3) Booking request guards (FR-HOUSING-015).
do $$
declare
  p personas;
  v_offer uuid;
  v_h uuid;
begin
  select * into p from personas;
  v_offer := kc_test.create_housing_offer(p.host, '{"max_nights":3}');
  perform kc_test.assert_raises(format('select kc_test.request_stay(%L, %L)', p.host, v_offer), 'own_listing', 'host cannot book own offer');
  perform kc_test.assert_raises(format('select kc_test.request_stay(%L, %L)', p.unverified, v_offer), 'world_permission_denied', 'unverified cannot book');
  perform kc_test.assert_raises(format('select kc_test.request_stay(%L, %L, 3, 5)', p.guest, v_offer), 'housing_nights_out_of_range', 'above max refused');
  perform kc_test.assert_raises(format('select kc_test.request_stay(%L, %L, 3, 2)', p.guest, kc_test.create_housing_offer(p.host,
    jsonb_build_object('blackout_dates', jsonb_build_array((public.housing_today() + 4)::text)))), 'housing_dates_unavailable', 'blackout night');
  perform kc_test.assert_raises(format('select kc_test.request_stay(%L, %L, 3, 2, 1, 1)', p.guest,
    kc_test.create_housing_offer(p.host, '{"children_ok":false}')), 'housing_policy_mismatch', 'children policy mismatch');
  perform kc_test.act_as(p.guest);
  perform kc_test.assert_raises(format($sql$select public.request_housing_booking(%L, public.housing_today() + 3, public.housing_today() + 5, 1, 1, 'hi', false)$sql$,
    v_offer), 'housing_minor_unaccompanied', 'guardian ack required');
  perform kc_test.assert_raises(format($sql$select public.request_housing_booking(%L, public.housing_today() + 3, public.housing_today() + 5, 1, 0, '  ', false)$sql$,
    v_offer), 'housing_message_required', 'message required');

  v_h := kc_test.request_stay(p.guest, v_offer, 3, 2, 2, 0);
  perform kc_test.assert_eq(kc_test.handoff_status(v_h), 'reserved', 'waits for host');
  perform kc_test.assert_eq(pg_temp.h_seats(v_h), 2, 'seats hold the party');
  perform kc_test.assert_true(pg_temp.h_confirm_by(v_h) <= now() + interval '24 hours', 'unanswered request expires within 24h');
  perform kc_test.assert_raises(format('select kc_test.request_stay(%L, %L)', p.guest, v_offer), 'already_booked', 'one active booking');

  perform kc_test.request_stay(p.guest, kc_test.create_housing_offer(p.host2), 20, 1);
  perform kc_test.request_stay(p.guest, kc_test.create_housing_offer(p.host2), 30, 1);
  perform kc_test.assert_raises(format('select kc_test.request_stay(%L, %L, 40, 1)', p.guest, kc_test.create_housing_offer(p.host2)),
    'housing_pending_cap', 'fourth waiting request refused');
end $$;

-- 4) Capacity and approval; first confirmation wins (FR-HOUSING-015 AC3, 016).
do $$
declare
  p personas;
  v_small uuid;
  v_exclusive uuid;
  v_a uuid;
  v_b uuid;
  v_super uuid;
begin
  select * into p from personas;
  update public.giving_handoffs set status = 'cancelled', cancel_reason = 'system' where world_slug = 'housing' and status = 'reserved';
  update public.post_handoffs set status = 'cancelled', cancel_reason = 'system' where world_slug = 'housing' and status = 'reserved';

  v_small := kc_test.create_housing_offer(p.host, '{"capacity":2}');
  v_a := kc_test.request_stay(p.guest, v_small, 5, 2, 2, 0);
  perform kc_test.act_as(p.guest2);
  perform kc_test.assert_raises(format('select public.decide_housing_booking(%L, true)', v_a), 'owner_only', 'only host decides');
  perform kc_test.approve_stay(p.host, v_a);
  perform kc_test.assert_eq(kc_test.handoff_status(v_a), 'confirmed', 'host approves');
  perform kc_test.assert_raises(format('select kc_test.request_stay(%L, %L, 6, 1)', p.guest2, v_small), 'housing_capacity_exceeded', 'night already full');

  v_exclusive := kc_test.create_housing_offer(p.host, '{"place_type":"whole_unit","capacity":4,"exclusive":true}');
  v_b := kc_test.request_stay(p.guest2, v_exclusive, 10, 2);
  perform kc_test.approve_stay(p.host, v_b);
  perform kc_test.assert_raises(format('select kc_test.request_stay(%L, %L, 11, 1)', p.stranger, v_exclusive), 'world_permission_denied', 'unverified');
  perform kc_test.assert_raises(format('select kc_test.request_stay(%L, %L, 11, 1)', p.guest, v_exclusive), 'housing_capacity_exceeded', 'exclusive place');

  v_a := kc_test.request_stay(p.guest, kc_test.create_housing_offer(p.host), 50, 2);
  v_super := kc_test.request_stay(p.guest, kc_test.create_housing_offer(p.host2), 51, 2);
  perform kc_test.approve_stay(p.host, v_a);
  perform kc_test.assert_eq(kc_test.handoff_status(v_super), 'cancelled', 'overlapping request withdrawn');
  perform kc_test.assert_eq(pg_temp.h_cancel_reason(v_super), 'superseded', 'marked superseded');
  perform kc_test.act_as(p.host2);
  perform kc_test.assert_raises(format('select public.decide_housing_booking(%L, true)', v_super), 'invalid_status', 'other host cannot approve');
  perform kc_test.assert_raises(format('select kc_test.request_stay(%L, %L, 51, 1)', p.guest, kc_test.create_housing_offer(p.host2)),
    'housing_booking_overlap', 'guest cannot double-book');
end $$;

-- 5) Private details: exact place only for confirmed guest (FR-HOUSING-012).
do $$
declare
  p personas;
  v_offer uuid;
  v_h uuid;
  v_city text;
  v_street int;
  v_true extensions.geography := extensions.st_setsrid(extensions.st_makepoint(34.99, 32.79), 4326)::extensions.geography;
  v_dist double precision;
begin
  select * into p from personas;
  select city_id, street_id into v_city, v_street from public.streets limit 1;
  v_offer := kc_test.create_housing_offer(p.host);
  update public.listings set city_id = v_city where listing_id = v_offer;

  perform kc_test.act_as(p.stranger);
  perform kc_test.assert_raises(format('select public.set_housing_private_details(%L, %s, %L)', v_offer, v_street, '12'), 'owner_only', 'host only');
  perform kc_test.act_as(p.host);
  perform public.set_housing_private_details(v_offer, v_street, '12', null, '2', 'Blue door', 'Key box 1234', 32.79, 34.99);
  v_dist := extensions.st_distance((select geo from public.listings where listing_id = v_offer), v_true);
  perform kc_test.assert_true(v_dist between 290 and 710, format('public point is 300–700 m away (%s)', v_dist));

  v_h := kc_test.request_stay(p.guest2, v_offer, 60, 2);
  perform kc_test.assert_raises(format('select * from public.get_housing_private_details(%L)', v_offer), 'housing_private_details_hidden', 'waiting hidden');
  perform kc_test.approve_stay(p.host, v_h);
  perform kc_test.act_as(p.guest2);
  perform kc_test.assert_eq((select access_instructions from public.get_housing_private_details(v_offer)), 'Key box 1234', 'confirmed sees instructions');
  perform kc_test.act_as(p.guest);
  perform kc_test.assert_raises(format('select * from public.get_housing_private_details(%L)', v_offer), 'housing_private_details_hidden', 'stranger hidden');
end $$;

-- 6) Cancellation and late marks (FR-HOUSING-018).
do $$
declare
  p personas;
  v_h uuid;
begin
  select * into p from personas;
  v_h := kc_test.request_stay(p.guest2, kc_test.create_housing_offer(p.host), 70, 2);
  perform kc_test.approve_stay(p.host, v_h);
  perform kc_test.act_as(p.guest2);
  perform kc_test.assert_raises(format('select public.cancel_giving_handoff(%L)', v_h), 'housing_use_booking_cancel', 'generic cancel refuses');
  perform public.cancel_housing_booking(v_h);
  perform kc_test.assert_eq(pg_temp.h_cancel_reason(v_h), 'guest_cancelled', 'guest cancelled');
  perform kc_test.assert_true(not (select late_cancel from public.housing_booking_details where handoff_id = v_h), 'weeks ahead not late');

  v_h := kc_test.request_stay(p.guest2, kc_test.create_housing_offer(p.host), 80, 2);
  perform kc_test.approve_stay(p.host, v_h);
  update public.giving_handoffs set slot_starts_at = now() + interval '30 hours' where handoff_id = v_h;
  update public.post_handoffs set slot_starts_at = now() + interval '30 hours' where handoff_id = v_h;
  perform kc_test.act_as(p.host);
  perform kc_test.assert_raises(format('select public.cancel_housing_booking(%L)', v_h), 'housing_cancel_reason_required', 'reason required');
  perform public.cancel_housing_booking(v_h, 'Family emergency');
  perform kc_test.assert_true((select late_cancel from public.housing_booking_details where handoff_id = v_h), 'marked late');

  v_h := kc_test.request_stay(p.guest2, kc_test.create_housing_offer(p.host), 90, 2);
  perform kc_test.approve_stay(p.host, v_h);
  perform kc_test.shift_stay(v_h, -interval '92 days');
  perform kc_test.act_as(p.guest2);
  perform kc_test.assert_raises(format('select public.cancel_housing_booking(%L)', v_h), 'housing_booking_started', 'started stay completed');
end $$;

-- 7) Completion, karma, ratings and no-show (FR-HOUSING-019, 020, 021, 022).
do $$
declare
  p personas;
  v_h uuid;
  v_karma_before int;
  v_ns uuid;
begin
  select * into p from personas;
  v_h := kc_test.request_stay(p.guest, kc_test.create_housing_offer(p.host), 100, 3);
  perform kc_test.approve_stay(p.host, v_h);
  perform kc_test.act_as(p.host);
  perform kc_test.assert_raises(format('select public.complete_housing_booking(%L)', v_h), 'housing_not_in_window', 'not before check-in');

  update public.housing_booking_details set check_in_date = public.housing_today() - 3, check_out_date = public.housing_today() where handoff_id = v_h;
  update public.giving_handoffs set slot_starts_at = now() - interval '3 days', slot_ends_at = now() - interval '1 hour' where handoff_id = v_h;
  update public.post_handoffs set slot_starts_at = now() - interval '3 days', slot_ends_at = now() - interval '1 hour' where handoff_id = v_h;
  v_karma_before := (select karma_points from public.users where user_id = p.host);
  perform public.complete_housing_booking(v_h);
  perform kc_test.assert_eq(kc_test.handoff_status(v_h), 'handed_over', 'host completes stay');
  perform kc_test.assert_eq((select karma_points from public.users where user_id = p.host) - v_karma_before, 90, 'earns 30 karma/night');
  perform kc_test.assert_raises(format('select public.complete_housing_booking(%L)', v_h), 'invalid_status', 'completed once');
  perform kc_test.act_as(p.guest);
  perform public.rate_giving_handoff(v_h, 5::smallint, 'Lovely host');
  perform kc_test.assert_row_count(format('select 1 from public.giving_handoff_ratings where handoff_id = %L', v_h), 1, 'rated');

  v_ns := kc_test.request_stay(p.guest2, kc_test.create_housing_offer(p.host), 110, 2);
  perform kc_test.approve_stay(p.host, v_ns);
  perform kc_test.act_as(p.host);
  perform kc_test.assert_raises(format('select public.mark_housing_no_show(%L)', v_ns), 'housing_not_in_window', 'only 3h after checkin');
  update public.giving_handoffs set slot_starts_at = now() - interval '4 hours' where handoff_id = v_ns;
  update public.post_handoffs set slot_starts_at = now() - interval '4 hours' where handoff_id = v_ns;
  perform public.mark_housing_no_show(v_ns);
  perform kc_test.assert_eq(kc_test.handoff_status(v_ns), 'no_show', 'host marks no-show');
end $$;

-- 8) Sweep and lists (FR-HOUSING-017, 019 AC5, 036, 037).
do $$
declare
  p personas;
  v_offer uuid;
  v_waiting uuid;
  v_stale uuid;
begin
  select * into p from personas;
  v_offer := kc_test.create_housing_offer(p.host2);
  v_waiting := kc_test.request_stay(p.guest, v_offer, 120, 1);
  v_stale := kc_test.request_stay(p.guest2, v_offer, 130, 1);
  perform kc_test.approve_stay(p.host2, v_stale);
  update public.giving_handoffs set confirm_by = now() - interval '1 minute' where handoff_id = v_waiting;
  update public.post_handoffs set confirm_by = now() - interval '1 minute' where handoff_id = v_waiting;
  update public.giving_handoffs set slot_ends_at = now() - interval '8 days' where handoff_id = v_stale;
  update public.post_handoffs set slot_ends_at = now() - interval '8 days' where handoff_id = v_stale;

  perform kc_test.act_as(p.host2);
  perform kc_test.assert_row_count(format('select * from public.list_housing_bookings(%L)', v_offer), 2, 'lists bookings');
  perform kc_test.act_as(p.guest);
  perform kc_test.assert_raises(format('select * from public.list_housing_bookings(%L)', v_offer), 'owner_only', 'host only');

  perform public.housing_bookings_sweep();
  perform kc_test.assert_eq(pg_temp.h_cancel_reason(v_waiting), 'expired', 'request expires');
  perform kc_test.assert_eq(pg_temp.h_cancel_reason(v_stale), 'not_completed', 'not completed');

  perform kc_test.act_as(p.guest2);
  perform kc_test.assert_true((select count(*) > 0 from public.list_my_housing_stays()), 'guest lists stays');

  if exists (select 1 from pg_trigger where tgname = 'giving_handoffs_post_handoffs_sync') then
    perform kc_test.assert_eq((public.post_unification_report() ->> 'handoff_field_mismatches')::int, 0, 'no mismatches');
    perform kc_test.assert_eq((public.post_unification_report() ->> 'handoff_rows_missing')::int, 0, 'no missing');
  end if;
end $$;

\echo '✓ housing_lifecycle passed'
rollback;
