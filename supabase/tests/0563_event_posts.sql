-- supabase/tests/0563_event_posts.sql | 0563 (G1 step 5a, D31, G18): an organization's event is a
-- time-world post with an `event_post_details` extension, and its registrations are post handoffs.
--   1. a member of an organization publishes an event: the post is of type `event` and carries
--      the extension; a non-member, or a window that ends before it starts, is refused;
--   2. automatic registration confirms at once, once per member, never the organizer's own, and
--      a full event waitlists the next member (0564);
--   3. manual registration waits for the organizer, who approves or declines; nobody else may;
--   4. verified-only registration refuses an unverified member;
--   5. cancelling frees the place; event registrations are not mirrored into giving_handoffs.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('ev_organizer') as organizer,
       kc_test.create_user('ev_outsider')  as outsider,
       kc_test.create_user('ev_guest_a')   as guest_a,
       kc_test.create_user('ev_guest_b')   as guest_b,
       gen_random_uuid()                   as org_id;

insert into public.organizations (org_id, name, slug)
select org_id, 'Event test org', 'event-test-org' from personas;
insert into public.org_memberships (org_id, user_id, role)
select org_id, organizer, 'org_volunteer' from personas;

-- Publishes an event as p_owner (create_marketplace_listing, as the create form does).
create function pg_temp.publish_event(p_owner uuid, p_org uuid, p_policy text, p_capacity int)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('time', 'org_event'), p_title => 'beach cleanup',
    p_details => jsonb_strip_nulls(jsonb_build_object(
      'org_id', p_org::text, 'registration_policy', p_policy, 'capacity', p_capacity,
      'starts_at', kc_test.iso_in(interval '2 days'), 'ends_at', kc_test.iso_in(interval '2 days 3 hours'),
      'address', 'Gordon beach')),
    p_city_id => 'tel-aviv');
end;
$$;
-- 0520: pg_temp helpers are called after act_as, so they need an explicit grant.
grant execute on function pg_temp.publish_event(uuid, uuid, text, int) to public;

-- The post of a just-published event, read in its own statement (so after the publication).
create function pg_temp.event_post(p_listing uuid)
returns uuid
language plpgsql
as $$
declare
  v_post uuid;
begin
  v_post := public.post_id_of_listing(p_listing);
  perform kc_test.assert_true(v_post is not null, 'the published event has a post');
  return v_post;
end;
$$;
grant execute on function pg_temp.event_post(uuid) to public;

-- ── T1 a member publishes; the post is an event with its extension ─────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
begin
  select * into p from personas;
  v_listing := pg_temp.publish_event(p.organizer, p.org_id, 'automatic', 2);
  v_post := public.post_id_of_listing(v_listing);
  perform kc_test.assert_true(v_post is not null, 'the published event has a post');
  perform kc_test.assert_eq((select post_type from public.posts where post_id = v_post), 'event',
    'the post is of type event');
  perform kc_test.assert_eq((select anonymity_level from public.listings where listing_id = v_listing), 3::smallint,
    'an event is public, unlike the time world''s followers-only default');
  perform kc_test.assert_eq((select org_id from public.event_post_details where post_id = v_post), p.org_id,
    'the extension names the organization');
  perform kc_test.assert_eq((select capacity from public.event_post_details where post_id = v_post), 2,
    'and the capacity');
  perform kc_test.assert_eq((select registration_policy from public.event_post_details where post_id = v_post),
    'automatic', 'and the registration policy');

  perform kc_test.assert_raises(
    format('select pg_temp.publish_event(%L, %L, %L, null)', p.outsider, p.org_id, 'automatic'),
    'event_org_required', 'a member of no such organization cannot publish its event');

  perform kc_test.act_as(p.organizer);
  perform kc_test.assert_raises(
    format($q$select public.update_my_listing(%L, p_details => jsonb_build_object(
      'org_id', %L, 'registration_policy', 'automatic',
      'starts_at', kc_test.iso_in(interval '2 days'), 'ends_at', kc_test.iso_in(interval '1 day')))$q$,
      v_listing, p.org_id::text),
    'event_window_invalid', 'an event cannot end before it starts');
end $$;

-- ── T2 automatic: confirmed at once, once, never the organizer, never past capacity ────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  v_reg public.post_handoffs;
begin
  select * into p from personas;
  v_listing := pg_temp.publish_event(p.organizer, p.org_id, 'automatic', 1);
  v_post := public.post_id_of_listing(v_listing);

  perform kc_test.act_as(p.guest_a);
  v_reg := public.register_for_event(v_post);
  perform kc_test.assert_eq(v_reg.status, 'confirmed', 'an automatic registration is confirmed at once');
  perform kc_test.assert_eq(v_reg.world_slug, 'time', 'on the time world');
  perform kc_test.assert_raises(format('select public.register_for_event(%L)', v_post),
    'already_booked', 'a member registers once');

  perform kc_test.act_as(p.guest_b);
  -- 0564: a full event waitlists instead of refusing (by listing id too).
  perform kc_test.assert_eq((public.register_for_event(v_listing)).status, 'waitlisted',
    'a full event puts the next member on its waitlist');

  perform kc_test.act_as(p.organizer);
  perform kc_test.assert_raises(format('select public.register_for_event(%L)', v_post),
    'own_listing', 'the organizer does not register for their own event');
  perform kc_test.assert_eq(
    (select count(*) from public.list_event_registrations(v_post)), 2::bigint,
    'the organizer sees the registration and the waitlisted member on the roster');

  perform kc_test.act_as(p.guest_b);
  perform kc_test.assert_raises(format('select * from public.list_event_registrations(%L)', v_post),
    'not_owner', 'nobody else reads the roster');
end $$;

-- ── T3 manual: waits for the organizer, who approves or declines ───────────────────────────
do $$
declare
  p personas;
  v_post uuid;
  v_a public.post_handoffs;
  v_b public.post_handoffs;
begin
  select * into p from personas;
  -- event_post reads in a statement of its own: STABLE post_id_of_listing would miss a post made in this one.
  v_post := pg_temp.event_post(pg_temp.publish_event(p.organizer, p.org_id, 'manual', null));

  perform kc_test.act_as(p.guest_a);
  v_a := public.register_for_event(v_post);
  perform kc_test.assert_eq(v_a.status, 'reserved', 'a manual registration waits for approval');
  perform kc_test.assert_raises(format('select public.decide_event_registration(%L, true)', v_a.handoff_id),
    'not_owner', 'the registrant cannot approve themself');

  perform kc_test.act_as(p.guest_b);
  v_b := public.register_for_event(v_post);

  perform kc_test.act_as(p.organizer);
  perform kc_test.assert_eq((public.decide_event_registration(v_a.handoff_id, true)).status, 'confirmed',
    'the organizer approves');
  v_b := public.decide_event_registration(v_b.handoff_id, false);
  perform kc_test.assert_eq(v_b.status, 'cancelled', 'or declines');
  perform kc_test.assert_eq(v_b.cancel_reason, 'declined', 'recorded as declined');
  perform kc_test.assert_raises(format('select public.decide_event_registration(%L, true)', v_a.handoff_id),
    'invalid_transition', 'a decided registration is not decided again');
end $$;

-- ── T4 verified only ────────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_post uuid;
begin
  select * into p from personas;
  -- event_post reads in a statement of its own: STABLE post_id_of_listing would miss a post made in this one.
  v_post := pg_temp.event_post(pg_temp.publish_event(p.organizer, p.org_id, 'verified_only', null));

  perform kc_test.act_as(p.guest_a);
  perform kc_test.assert_raises(format('select public.register_for_event(%L)', v_post),
    'verification_required', 'an unverified member is refused');

  update public.users set verified_at = now() where user_id = p.guest_a;
  perform kc_test.assert_eq((public.register_for_event(v_post)).status, 'confirmed',
    'a verified member is confirmed');
end $$;

-- ── T5 cancelling frees the place; no giving_handoffs row ──────────────────────────────────
do $$
declare
  p personas;
  v_post uuid;
  v_reg public.post_handoffs;
begin
  select * into p from personas;
  -- event_post reads in a statement of its own: STABLE post_id_of_listing would miss a post made in this one.
  v_post := pg_temp.event_post(pg_temp.publish_event(p.organizer, p.org_id, 'automatic', 1));

  perform kc_test.act_as(p.guest_a);
  v_reg := public.register_for_event(v_post);
  perform kc_test.assert_true(
    not exists (select 1 from public.giving_handoffs where handoff_id = v_reg.handoff_id),
    'an event registration is not mirrored into giving_handoffs');

  v_reg := public.cancel_event_registration(v_reg.handoff_id);
  perform kc_test.assert_eq(v_reg.status, 'cancelled', 'the registrant withdraws');
  perform kc_test.assert_true(v_reg.cancel_reason is null, 'a withdrawal is not a decline');

  perform kc_test.act_as(p.guest_b);
  perform kc_test.assert_eq((public.register_for_event(v_post)).status, 'confirmed',
    'the freed place is taken');
  perform kc_test.assert_raises(format('select public.cancel_event_registration(%L)', v_reg.handoff_id),
    'handoff_not_found', 'a stranger cannot cancel someone else''s registration');
end $$;

rollback;
\echo '✓ 0563_event_posts.sql passed'
