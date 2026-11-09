-- supabase/tests/0701_knowledge_post_kinds.sql | 0701 (#2034, FR-KNOW-003, FR-KNOW-004 AC1,
-- FR-KNOW-012 AC1): the six knowledge kinds, slots as rows, slot rules, offer expiry, the
-- consulting-hour identity gate, and owner edits that would strand a learner.

begin;

create temp table personas as
select kc_test.create_knowledge_member('kk_giver') as giver,
       kc_test.create_knowledge_member('kk_lawyer_unverified', false) as unverified,
       kc_test.create_knowledge_member('kk_learner') as learner;

-- ── Kinds ──────────────────────────────────────────────────────────────────────────────────────
select kc_test.assert_eq(
  (select string_agg(slug, ',' order by sort_order) from public.listing_kinds
    where world_slug = 'knowledge' and is_active),
  'lesson_offer,mentoring_offer,consulting_hour,learning_request,mentoring_request,question'::text,
  'the knowledge world offers exactly the six spec kinds, in display order');
select kc_test.assert_eq(
  (select count(*)::int from public.listing_kinds
    where world_slug = 'knowledge' and slug in ('course', 'private_lesson', 'mentorship_request') and not is_active),
  3, 'the legacy kinds are kept but no longer offered');
select kc_test.assert_eq(
  (select string_agg(slug || ':' || direction, ',' order by sort_order) from public.listing_kinds
    where world_slug = 'knowledge' and is_active and direction = 'give'),
  'lesson_offer:give,mentoring_offer:give,consulting_hour:give'::text,
  'three offer kinds');

-- ── Publishing a lesson offer ─────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_post uuid;
begin
  select * into p from personas;
  v_post := kc_test.create_lesson_offer(p.giver, 2, interval '1 day', interval '2 days');

  perform kc_test.assert_eq(
    (select count(*)::int from public.knowledge_slots where post_id = v_post and status = 'open'), 2,
    'each listed slot becomes a bookable row');
  perform kc_test.assert_eq(
    (select min(capacity)::int from public.knowledge_slots where post_id = v_post), 2,
    'with the capacity per slot');
  perform kc_test.assert_true(
    (select expires_at between now() + interval '2 days 1 hour 29 minutes' and now() + interval '2 days 1 hour 31 minutes'
       from public.posts where post_id = v_post),
    'the offer expires 30 minutes after its last slot ends');

  -- The owner adds a slot: a new row, and the expiry follows the new last slot.
  perform kc_test.act_as(p.giver);
  update public.posts
     set details = jsonb_set(details, '{slots}', (details->'slots') || kc_test.knowledge_slots(interval '4 days'))
   where post_id = v_post;
  perform kc_test.assert_eq(
    (select count(*)::int from public.knowledge_slots where post_id = v_post and status = 'open'), 3,
    'an added slot becomes a row');
  perform kc_test.assert_true(
    (select expires_at > now() + interval '4 days' from public.posts where post_id = v_post),
    'the expiry moves with the last slot');

  -- The owner removes an unbooked slot: it is cancelled, not deleted.
  update public.posts
     set details = jsonb_set(details, '{slots}', (details->'slots') - 0)
   where post_id = v_post;
  perform kc_test.assert_eq(
    (select count(*)::int from public.knowledge_slots where post_id = v_post and status = 'cancelled'), 1,
    'a removed unbooked slot is cancelled');

  -- A learner books the (now) first slot; the owner can no longer remove or shorten it,
  -- nor shrink capacity below the seats held.
  perform kc_test.book_knowledge_seat(p.learner, kc_test.knowledge_slot(v_post, 1));
  perform kc_test.book_knowledge_seat(kc_test.create_knowledge_member('kk_learner2'), kc_test.knowledge_slot(v_post, 1));
  perform kc_test.act_as(p.giver);
  perform kc_test.assert_raises(
    format($q$update public.posts set details = jsonb_set(details, '{slots}', (details->'slots') - 0) where post_id = %L$q$, v_post),
    'knowledge_slot_has_booking', 'a booked slot cannot be removed');
  perform kc_test.assert_raises(
    -- Two hours instead of one: a valid duration, so only the booking guard can refuse it.
    format($q$update public.posts set details = jsonb_set(details, '{slots,0,ends_at}',
      to_jsonb(to_char(((details->'slots'->0->>'starts_at')::timestamptz + interval '2 hours') at time zone 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) where post_id = %L$q$, v_post),
    'knowledge_slot_has_booking', 'a booked slot cannot change its end');
  perform kc_test.assert_raises(
    format($q$update public.posts set details = jsonb_set(details, '{capacity_per_slot}', '1') where post_id = %L$q$, v_post),
    'knowledge_slot_capacity_below_bookings', 'capacity cannot drop below the seats already held');
end $$;

-- ── Slot rules ────────────────────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  -- Publishes a lesson offer with these details through the listing fixture.
  v_publish text := 'select kc_test.create_listing(%L, ''knowledge'', ''lesson_offer'', ''give'', ''x'', %L, null)';
begin
  select * into p from personas;
  perform kc_test.assert_raises(format(v_publish, p.giver,
      jsonb_build_object('modality', 'video', 'capacity_per_slot', 1, 'slots', kc_test.knowledge_slots(interval '-2 hours'))),
    'knowledge_slot_in_past', 'a new slot must lie in the future');
  perform kc_test.assert_raises(format(v_publish, p.giver,
      jsonb_build_object('modality', 'video', 'capacity_per_slot', 1, 'slots', kc_test.knowledge_slots(interval '1 day', interval '1 day 30 minutes'))),
    'knowledge_slots_overlap', 'slots of one post may not overlap');
  perform kc_test.assert_raises(format(v_publish, p.giver,
      '{"modality":"video","capacity_per_slot":1,"slots":[{"starts_at":"2030-01-01T10:00:00Z","ends_at":"2030-01-01T10:05:00Z"}]}'),
    'knowledge_slot_duration_invalid', 'a session lasts at least 15 minutes');
  perform kc_test.assert_raises(format(v_publish, p.giver,
      '{"modality":"video","capacity_per_slot":1,"slots":[{"starts_at":"2030-01-01T10:00:00Z","ends_at":"2030-01-01T19:00:00Z"}]}'),
    'knowledge_slot_duration_invalid', 'and at most 8 hours');
  perform kc_test.assert_raises(format(v_publish, p.giver,
      '{"modality":"video","capacity_per_slot":1,"slots":[{"starts_at":"soon","ends_at":"2030-01-01T11:00:00Z"}]}'),
    'knowledge_slot_invalid', 'a slot time must be a timestamp');
end $$;

-- ── Expiry of the other kinds ─────────────────────────────────────────────────────────────────
-- Each post is created before it is read: a volatile helper inside the WHERE clause would run
-- once per scanned row and never match the row it is compared with.
do $$
declare
  p personas;
  v_question uuid;
  v_mentoring uuid;
begin
  select * into p from personas;
  v_question := kc_test.create_knowledge_post(p.learner, 'question', '{"topic":"Chess"}', 'How do I start?');
  v_mentoring := kc_test.create_knowledge_post(p.giver, 'mentoring_offer',
    '{"cadence":"weekly","seats":2,"modality":"video"}', 'Career mentoring');
  perform kc_test.assert_true(
    (select expires_at is null from public.posts where post_id = v_question), 'a question never expires');
  perform kc_test.assert_true(
    (select expires_at is null from public.posts where post_id = v_mentoring), 'a mentoring offer never expires');
end $$;

-- ── Consulting hour: identity verification required (FR-KNOW-012 AC1) ────────────────────────
do $$
declare
  p personas;
  v_details jsonb;
begin
  select * into p from personas;
  v_details := jsonb_build_object('profession', 'lawyer', 'modality', 'video', 'capacity_per_slot', 1,
                                  'disclaimer_accepted', true, 'slots', kc_test.knowledge_slots(interval '1 day'));
  perform kc_test.assert_raises(
    format('select kc_test.create_knowledge_post(%L, ''consulting_hour'', %L)', p.unverified, v_details),
    'consulting_requires_id_verification', 'a member below identity verification cannot offer a consulting hour');
  perform kc_test.assert_true(
    kc_test.create_knowledge_post(p.giver, 'consulting_hour', v_details) is not null,
    'an identity-verified member can');
  perform kc_test.assert_raises(
    format('select kc_test.create_knowledge_post(%L, ''consulting_hour'', %L)', p.giver,
           v_details - 'disclaimer_accepted'),
    'listing_details_schema_mismatch', 'the not-binding-advice disclaimer must be accepted');
end $$;

-- ── Privileges ────────────────────────────────────────────────────────────────────────────────
select kc_test.assert_true(not has_function_privilege('authenticated', 'public.knowledge_check_slots(uuid,jsonb)', 'execute'),
  'slot validation is internal');
select kc_test.assert_true(not has_function_privilege('authenticated', 'public.posts_knowledge_slots_sync()', 'execute'),
  'the sync trigger function is internal');

rollback;
\echo '✓ 0701_knowledge_post_kinds.sql passed'
