-- supabase/tests/0717_fsm_review_queues.sql
-- Wave 4c (#1989): the review queues follow the kernel machines `review_decision` and
-- `donation_link_review` through the generic status trigger. Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('w4c_applicant') as applicant,
       kc_test.create_user('w4c_owner')     as owner;

-- ── 1. A review decision is final ──────────────────────────────────────────────
do $$
declare
  p personas;
  v_app uuid;
  v_review uuid;
  v_claim uuid;
begin
  select * into p from personas;

  insert into public.org_applications (applicant_user_id, org_name)
  values (p.applicant, 'W4c Org') returning application_id into v_app;
  update public.org_applications set status = 'approved' where application_id = v_app;
  perform kc_test.assert_raises(
    format('update public.org_applications set status = %L where application_id = %L', 'rejected', v_app),
    'org_application_transition_invalid', 'an approved application is not rejected afterwards');

  insert into public.bot_admin_review_items (reason) values ('low_confidence') returning review_id into v_review;
  update public.bot_admin_review_items set status = 'rejected' where review_id = v_review;
  perform kc_test.assert_raises(
    format('update public.bot_admin_review_items set status = %L where review_id = %L', 'pending', v_review),
    'bot_review_transition_invalid', 'a decided bot review is not reopened');

  perform kc_test.create_listing(
    p.owner, 'items', 'give_item', 'give', 'Claimed lamp',
    '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb);
  insert into public.claim_requests (listing_id, requester_id)
  select post_id, p.applicant from public.posts where owner_id = p.owner limit 1
  returning claim_id into v_claim;
  update public.claim_requests set status = 'approved' where claim_id = v_claim;
  perform kc_test.assert_raises(
    format('update public.claim_requests set status = %L where claim_id = %L', 'rejected', v_claim),
    'claim_request_transition_invalid', 'a decided claim is not flipped');
end $$;

-- ── 2. A donation link is reviewed again after an edit, never flipped directly ──
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  insert into public.donation_links (category_slug, url, display_name, submitted_by, validated_at)
  values ('food', 'https://example.org/w4c', 'W4c bank', p.owner, now())
  returning id into v;

  update public.donation_links set review_status = 'approved' where id = v;
  perform kc_test.assert_raises(
    format('update public.donation_links set review_status = %L where id = %L', 'rejected', v),
    'donation_link_review_transition_invalid', 'an approval is not flipped to a rejection');

  update public.donation_links set url = 'https://example.org/w4c-moved' where id = v;
  perform kc_test.assert_eq(
    (select review_status from public.donation_links where id = v), 'pending',
    'an edit sends the approved link back to review');
  update public.donation_links set review_status = 'rejected' where id = v;
  perform kc_test.assert_eq(
    (select review_status from public.donation_links where id = v), 'rejected', 'and it is reviewed again');
end $$;

rollback;

\echo '✓ 0717_fsm_review_queues.sql passed'
