-- supabase/tests/0542_admin_world_flow_funnel.sql | 0542 (G43): the per-world flow funnel.
-- Access control, the cohort window and its clamp, every stage of the items offer funnel
-- (nested counts, the all-cancelled rule, the medians), the separate request row, and null
-- handoff columns for a world that does not hand off through giving_handoffs.
--
-- Posts and listings already on the stack (seed data) are deleted inside this transaction so
-- the cohort holds only this file's fixtures; everything is rolled back at the end. Since 0565
-- the cohort is the posts (created when their listing is published) and the stages read
-- post_handoffs, which the giving_handoffs inserts below reach through the 0553 sync.

begin;

delete from public.posts;
delete from public.listings;

create temp table personas as
select kc_test.create_user('funnel_giver') as giver,
       kc_test.create_user('funnel_taker') as taker,
       kc_test.create_user('funnel_second_taker') as second_taker,
       kc_test.create_user('funnel_moderator') as moderator,
       kc_test.create_user('funnel_member') as member;

insert into public.admin_role_grants (user_id, role) select moderator, 'moderator' from personas;

-- The 30-day result, read once as the moderator and asserted by the blocks below.
create temp table funnel_rows (
  world_slug text, world_label_he text, world_label_en text, direction text,
  published integer, booked integer, confirmed integer, completed integer, cancelled integer,
  closed integer, median_hours_to_booking numeric, median_hours_to_completion numeric
) on commit drop;

-- An items offer published `p_days_ago` days ago, with no handoff yet.
create function pg_temp.item_offer(p_owner uuid, p_title text, p_days_ago integer)
returns uuid language plpgsql as $$
declare v_listing uuid;
begin
  v_listing := kc_test.create_listing(p_owner, 'items', 'give_item', 'give', p_title,
    '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb,
    now() + interval '60 days');
  update public.listings set published_at = now() - make_interval(days => p_days_ago)
   where listing_id = v_listing;
  -- 0565: the funnel dates the cohort by the post, created when the listing was published.
  update public.posts set created_at = now() - make_interval(days => p_days_ago)
   where listing_id = v_listing or post_id = v_listing;
  return v_listing;
end $$;

-- A handoff on `p_listing` reserved `p_booked_after` hours after publication. A status past
-- `reserved` stamps its own timestamp `p_done_after` hours after publication.
create function pg_temp.handoff(
  p_listing uuid, p_recipient uuid, p_status text, p_booked_after integer, p_done_after integer default null
) returns void language plpgsql as $$
declare
  v_published timestamptz := (select published_at from public.listings where listing_id = p_listing);
  v_done timestamptz := v_published + make_interval(hours => coalesce(p_done_after, p_booked_after));
begin
  if (select relkind from pg_class where relname = 'giving_handoffs' and relnamespace = 'public'::regnamespace) = 'r' then
    insert into public.giving_handoffs (
      listing_id, owner_id, recipient_id, world_slug, status,
      reserved_at, confirmed_at, handed_over_at, cancelled_at
    )
    select p_listing, l.owner_id, p_recipient, l.world_slug, p_status,
           v_published + make_interval(hours => p_booked_after),
           case when p_status in ('confirmed', 'handed_over') then v_done end,
           case when p_status = 'handed_over' then v_done end,
           case when p_status = 'cancelled' then v_done end
      from public.listings l
     where l.listing_id = p_listing;
  else
    insert into public.post_handoffs (
      post_id, owner_id, recipient_id, world_slug, status,
      reserved_at, confirmed_at, handed_over_at, cancelled_at
    )
    select coalesce((select post_id from public.posts where listing_id = p_listing), l.legacy_post_id, p_listing), l.owner_id, p_recipient, l.world_slug, p_status,
           v_published + make_interval(hours => p_booked_after),
           case when p_status in ('confirmed', 'handed_over') then v_done end,
           case when p_status = 'handed_over' then v_done end,
           case when p_status = 'cancelled' then v_done end
      from public.listings l
     where l.listing_id = p_listing;
    return;
  end if;

  insert into public.post_handoffs (
    post_id, owner_id, recipient_id, world_slug, status,
    reserved_at, confirmed_at, handed_over_at, cancelled_at
  )
  select coalesce((select post_id from public.posts where listing_id = p_listing), l.legacy_post_id, p_listing), l.owner_id, p_recipient, l.world_slug, p_status,
         v_published + make_interval(hours => p_booked_after),
         case when p_status in ('confirmed', 'handed_over') then v_done end,
         case when p_status = 'handed_over' then v_done end,
         case when p_status = 'cancelled' then v_done end
    from public.listings l
   where l.listing_id = p_listing;
end $$;

-- ── access control ──────────────────────────────────────────────────────────
do $$
declare p personas;
begin
  select * into p from personas;
  perform kc_test.assert_true(
    not has_function_privilege('anon', 'public.admin_world_flow_funnel(integer)', 'execute'),
    'anon cannot execute the funnel');
  perform kc_test.act_as(p.member);
  perform kc_test.assert_raises('select * from public.admin_world_flow_funnel(30)', 'forbidden',
    'a member without an admin role is refused');
end $$;

-- ── fixtures: the items offer funnel, one request, one time offer ───────────
do $$
declare
  p personas;
  v_completed uuid;
  v_recovered uuid;
begin
  select * into p from personas;
  perform pg_temp.item_offer(p.giver, 'never booked', 10);
  perform pg_temp.handoff(pg_temp.item_offer(p.giver, 'reserved', 10), p.taker, 'reserved', 2);
  perform pg_temp.handoff(pg_temp.item_offer(p.giver, 'confirmed', 10), p.taker, 'confirmed', 4, 6);
  v_completed := pg_temp.item_offer(p.giver, 'handed over', 10);
  perform pg_temp.handoff(v_completed, p.taker, 'handed_over', 6, 30);
  perform pg_temp.handoff(pg_temp.item_offer(p.giver, 'cancelled', 10), p.taker, 'cancelled', 8, 9);
  -- A first reservation cancelled, then a second taker completed: completed, not cancelled.
  v_recovered := pg_temp.item_offer(p.giver, 'recovered', 10);
  perform pg_temp.handoff(v_recovered, p.taker, 'cancelled', 1, 3);
  perform pg_temp.handoff(v_recovered, p.second_taker, 'handed_over', 10, 50);
  -- Both completed listings closed, as the handover flow leaves them.
  update public.listings set status = 'closed' where listing_id in (v_completed, v_recovered);
  update public.posts set status = 'closed_delivered'
   where listing_id in (v_completed, v_recovered)
      or post_id in (select legacy_post_id from public.listings where listing_id in (v_completed, v_recovered));
  -- Published 40 days ago: outside the 30-day cohort, inside a 60-day one.
  perform pg_temp.handoff(pg_temp.item_offer(p.giver, 'old', 40), p.taker, 'handed_over', 1, 2);

  perform kc_test.create_listing(p.taker, 'items', 'request_item', 'request', 'needs a chair', '{}'::jsonb);
  perform kc_test.create_listing(p.giver, 'time', 'volunteer_shift', 'give', 'tutoring',
    '{"duration_minutes":60,"skills":["tutoring"],"org_host_slug":"community"}'::jsonb);

  perform kc_test.act_as(p.moderator);
  insert into funnel_rows select * from public.admin_world_flow_funnel(30);
end $$;

-- ── the items offer row: nested stages, cancellations, medians ──────────────
do $$
declare r record;
begin
  select * into r from funnel_rows where world_slug = 'items' and direction = 'give';
  perform kc_test.assert_eq(r.published, 6, 'published: the six offers in the window (not the 40-day one)');
  perform kc_test.assert_eq(r.booked, 5, 'booked: every offer with a handoff');
  perform kc_test.assert_eq(r.confirmed, 3, 'confirmed: confirmed or handed over');
  perform kc_test.assert_eq(r.completed, 2, 'completed: handed over, including after a cancelled try');
  perform kc_test.assert_eq(r.cancelled, 1, 'cancelled: only the offer whose every handoff was cancelled');
  perform kc_test.assert_eq(r.closed, 2, 'closed: the two completed offers');
  -- First bookings at 2, 4, 6, 8 and 1 hours → median 4; first handovers at 30 and 50 → 40.
  perform kc_test.assert_eq(r.median_hours_to_booking, 4.0, 'median hours to the first booking');
  perform kc_test.assert_eq(r.median_hours_to_completion, 40.0, 'median hours to the first handover');
  perform kc_test.assert_true(r.world_label_he is not null and r.world_label_en is not null, 'world labels');
end $$;

-- ── the request row and a world without handoffs ────────────────────────────
do $$
declare r record;
begin
  select * into r from funnel_rows where world_slug = 'items' and direction = 'request';
  perform kc_test.assert_eq(r.published, 1, 'the items request has its own row');
  perform kc_test.assert_eq(r.booked, 0, 'an unbooked request counts zero, not null');

  select * into r from funnel_rows where world_slug = 'time';
  perform kc_test.assert_eq(r.published, 1, 'the time offer is published');
  perform kc_test.assert_true(
    r.booked is null and r.confirmed is null and r.completed is null and r.cancelled is null
      and r.median_hours_to_booking is null and r.median_hours_to_completion is null,
    'handoff columns are null for a world without giving handoffs');
  perform kc_test.assert_eq(r.closed, 0, 'closed is counted in every world');
end $$;

-- ── the window: a wider cohort and the 1..365 clamp ─────────────────────────
do $$
declare p personas;
begin
  select * into p from personas;
  perform kc_test.act_as(p.moderator);
  perform kc_test.assert_eq(
    (select published from public.admin_world_flow_funnel(60) where world_slug = 'items' and direction = 'give'),
    7, 'a 60-day window takes in the 40-day-old offer');
  perform kc_test.assert_eq(
    (select completed from public.admin_world_flow_funnel(60) where world_slug = 'items' and direction = 'give'),
    3, 'and its handover');
  perform kc_test.assert_eq(
    (select published from public.admin_world_flow_funnel(100000) where world_slug = 'items' and direction = 'give'),
    7, 'an oversized window is clamped, not rejected');
  -- Only the request and the time offer were published today.
  perform kc_test.assert_eq(
    (select sum(published)::integer from public.admin_world_flow_funnel(0)), 2,
    'a zero window is clamped to one day');
end $$;

rollback;

\echo '✓ 0542_admin_world_flow_funnel.sql passed'
