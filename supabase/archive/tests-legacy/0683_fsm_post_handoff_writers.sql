-- supabase/tests/0683_fsm_post_handoff_writers.sql
-- Wave 1b-ii (#1989): handoff writers close a post only where the post graph allows, and the
-- handed-over step belongs to the worlds that offer it. One block per regression.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('handoff_owner') as owner,
       kc_test.create_user('handoff_taker') as taker;

create function pg_temp.new_post(p_owner uuid, p_world text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.posts (
    owner_id, title, description, category, type, status,
    location_display_level, city, street, street_number, visibility, world_slug, expires_at
  ) values (
    p_owner, 'Handoff wave 1b', 'Description', 'Furniture', 'Give', 'open',
    -- A food offer requires its expiry (D28); a day ahead keeps the post open.
    'CityOnly', 'tel-aviv', 'Herzl', '1', 'Public', p_world, now() + interval '1 day'
  ) returning post_id into v_id;
  return v_id;
end $$;

create function pg_temp.confirmed_handoff(p_post uuid, p_owner uuid, p_taker uuid, p_world text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.post_handoffs (post_id, owner_id, recipient_id, world_slug, status, confirmed_at)
  values (p_post, p_owner, p_taker, p_world, 'confirmed', now())
  returning handoff_id into v_id;
  return v_id;
end $$;

create function pg_temp.post_status(p_post uuid) returns text
language sql as $$ select status from public.posts where post_id = p_post $$;

create function pg_temp.handoff_status(p_handoff uuid) returns text
language sql as $$ select status from public.post_handoffs where handoff_id = p_handoff $$;

-- ── 1. Handed over on an expired post completes the handoff and leaves the post expired ──
-- Before 0683 the post update hit the graph (expired -> closed_delivered) and rolled back.
do $$
declare
  p personas;
  v_food uuid;
  v_item uuid;
  h_food uuid;
  h_item uuid;
begin
  select * into p from personas;
  v_food := pg_temp.new_post(p.owner, 'food');
  h_food := pg_temp.confirmed_handoff(v_food, p.owner, p.taker, 'food');
  update public.posts set status = 'expired' where post_id = v_food;

  v_item := pg_temp.new_post(p.owner, 'items');
  h_item := pg_temp.confirmed_handoff(v_item, p.owner, p.taker, 'items');
  update public.posts set status = 'expired' where post_id = v_item;

  perform kc_test.act_as(p.owner);
  perform public.mark_giving_handed_over(h_food);
  perform kc_test.assert_eq(pg_temp.handoff_status(h_food), 'handed_over', 'food handoff completes');
  perform kc_test.assert_eq(pg_temp.post_status(v_food), 'expired', 'expired food post stays expired');

  -- The items path closes through post_close_from_handoff (G34), which wrote the listings view.
  perform public.mark_giving_handed_over(h_item);
  perform kc_test.assert_eq(pg_temp.handoff_status(h_item), 'handed_over', 'item handoff completes');
  perform kc_test.assert_eq(pg_temp.post_status(v_item), 'expired', 'expired item post stays expired');
end $$;

-- ── 2. A live post closes; a post under review stays hidden ─────────────────────────────
do $$
declare
  p personas;
  v_open uuid;
  v_hidden uuid;
  h_open uuid;
  h_hidden uuid;
begin
  select * into p from personas;
  v_open := pg_temp.new_post(p.owner, 'food');
  h_open := pg_temp.confirmed_handoff(v_open, p.owner, p.taker, 'food');
  v_hidden := pg_temp.new_post(p.owner, 'food');
  h_hidden := pg_temp.confirmed_handoff(v_hidden, p.owner, p.taker, 'food');
  update public.posts set status = 'hidden_pending_review' where post_id = v_hidden;

  perform kc_test.act_as(p.taker);
  perform public.mark_giving_handed_over(h_open);
  perform kc_test.assert_eq(pg_temp.post_status(v_open), 'closed_delivered', 'live post closes as delivered');

  perform public.mark_giving_handed_over(h_hidden);
  perform kc_test.assert_eq(pg_temp.handoff_status(h_hidden), 'handed_over', 'handoff under review completes');
  perform kc_test.assert_eq(pg_temp.post_status(v_hidden), 'hidden_pending_review',
    'a post under review is not reopened to the public by closing it');
end $$;

-- ── 3. Rides, housing and events complete through their own RPCs ──────────────────────
do $$
declare
  p personas;
  v uuid;
  h uuid;
  w text;
begin
  select * into p from personas;
  -- The RPC decides by the handoff's world; an items post keeps the fixture free of the
  -- world-specific post rules (e.g. a ride post needs ride details).
  foreach w in array array['rides', 'housing', 'time'] loop
    v := pg_temp.new_post(p.owner, 'items');
    h := pg_temp.confirmed_handoff(v, p.owner, p.taker, w);
    perform kc_test.act_as(p.owner);
    perform kc_test.assert_raises(
      format('select public.mark_giving_handed_over(%L)', h),
      'handoff_world_not_supported', format('%s handoff refused', w));
    perform kc_test.assert_eq(pg_temp.handoff_status(h), 'confirmed', format('%s handoff unchanged', w));
    perform kc_test.assert_eq(pg_temp.post_status(v), 'open', format('%s post unchanged', w));
  end loop;
end $$;

-- ── 4. One owner-assigns-a-recipient RPC ───────────────────────────────────────────────
do $$
begin
  perform kc_test.assert_true(
    to_regprocedure('public.owner_complete_offer_with_user(uuid, uuid)') is null,
    'the two-argument overload is gone');
  perform kc_test.assert_true(
    to_regprocedure('public.owner_complete_offer_with_user(uuid, uuid, text)') is not null,
    'the live three-argument RPC remains');
end $$;

rollback;

\echo '✓ 0683_fsm_post_handoff_writers.sql passed'
