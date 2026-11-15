-- supabase/tests/0694_fsm_handoffs.sql
-- Wave 2 (#1989): every post_handoffs status write follows the kernel machine of its world
-- (giving_handoff, ride_booking, housing_booking, event_registration). Each case inserts a
-- handoff in the `from` status on a post of its world and writes the `to` status. Runs in a
-- rolled-back transaction.

begin;

-- The owner publishes in every world, housing included, so it is a verified housing member.
create temp table personas as
select kc_test.create_housing_member('w2_owner') as owner,
       kc_test.create_user('w2_recipient')       as recipient;

-- One post per machine; a handoff's machine follows its own `world_slug`.
create temp table world_posts as
select 'items' as world_slug,
       kc_test.create_listing(owner, 'items', 'give_item', 'give', 'a lamp',
         '{"item_condition":"Good","image_url":"https://example.test/i.jpg"}'::jsonb,
         now() + interval '30 days') as post_id
  from personas
union all
select 'rides', kc_test.create_ride_offer(owner) from personas
union all
select 'housing', kc_test.create_housing_offer(owner) from personas
union all
select 'time', kc_test.create_listing(owner, 'time', 'support_request', 'request', 'help moving',
         '{}'::jsonb) from personas;

-- Inserts a handoff of p_world in p_from and writes p_to; returns the error, or null.
create function pg_temp.move(p_world text, p_from text, p_to text)
returns text
language plpgsql
as $$
declare
  p personas;
  v_handoff uuid;
begin
  select * into p from personas;
  insert into public.post_handoffs (post_id, owner_id, recipient_id, world_slug, status)
  values ((select post_id from world_posts where world_slug = p_world), p.owner, p.recipient,
          p_world, p_from)
  returning handoff_id into v_handoff;
  begin
    update public.post_handoffs set status = p_to where handoff_id = v_handoff;
  exception when others then
    return sqlerrm;
  end;
  return null;
end;
$$;

-- ── 1. The world → machine rule ────────────────────────────────────────────────
do $$
begin
  perform kc_test.assert_eq(kc_private.handoff_machine_of('items'), 'giving_handoff', 'items');
  perform kc_test.assert_eq(kc_private.handoff_machine_of('knowledge'), 'giving_handoff', 'knowledge');
  perform kc_test.assert_eq(kc_private.handoff_machine_of('rides'), 'ride_booking', 'rides');
  perform kc_test.assert_eq(kc_private.handoff_machine_of('housing'), 'housing_booking', 'housing');
  perform kc_test.assert_eq(kc_private.handoff_machine_of('time'), 'event_registration', 'time');
end $$;

-- ── 2. Moves the live writers perform are accepted ─────────────────────────────
do $$
declare
  v_case text[];
begin
  foreach v_case slice 1 in array array[
    ['items',   'reserved',   'handed_over'],  -- closing the post settles a reservation
    ['items',   'confirmed',  'no_show'],      -- pickup-window sweep
    ['rides',   'cancelled',  'reserved'],     -- reinstate a declined booking
    ['rides',   'cancelled',  'confirmed'],    -- reinstate a driver-cancelled booking
    ['housing', 'confirmed',  'no_show'],      -- guest did not arrive
    ['time',    'waitlisted', 'confirmed'],    -- promoted from the waitlist
    ['time',    'no_show',    'handed_over'],  -- absence corrected to attended
    ['rides',   'cancelled',  'cancelled']     -- same status: a no-op
  ] loop
    perform kc_test.assert_eq(pg_temp.move(v_case[1], v_case[2], v_case[3]), null::text,
      format('%s: %s -> %s is legal', v_case[1], v_case[2], v_case[3]));
  end loop;
end $$;

-- ── 3. Moves outside the machine are refused ───────────────────────────────────
do $$
declare
  v_case text[];
begin
  foreach v_case slice 1 in array array[
    ['items',   'handed_over', 'cancelled'],   -- a completed handoff is final
    ['items',   'cancelled',   'reserved'],    -- only rides reinstate
    ['rides',   'confirmed',   'no_show'],     -- a ride has no no-show
    ['rides',   'handed_over', 'cancelled'],
    ['housing', 'reserved',    'handed_over'], -- a stay completes only once approved
    ['time',    'handed_over', 'no_show'],     -- attendance is not taken back
    ['time',    'waitlisted',  'handed_over']  -- a waitlisted registrant did not attend
  ] loop
    perform kc_test.assert_true(
      coalesce(pg_temp.move(v_case[1], v_case[2], v_case[3]), '') = 'handoff_status_transition_invalid',
      format('%s: %s -> %s is refused', v_case[1], v_case[2], v_case[3]));
  end loop;
end $$;

-- ── 4. The no-show sweep acts on giving handoffs only ──────────────────────────
do $$
declare
  p personas;
  v_item uuid;
  v_ride uuid;
begin
  select * into p from personas;
  insert into public.post_handoffs (post_id, owner_id, recipient_id, world_slug, status, pickup_window_end)
  values ((select post_id from world_posts where world_slug = 'items'), p.owner, p.recipient,
          'items', 'confirmed', now() - interval '3 hours')
  returning handoff_id into v_item;
  insert into public.post_handoffs (post_id, owner_id, recipient_id, world_slug, status, pickup_window_end)
  values ((select post_id from world_posts where world_slug = 'rides'), p.owner, p.recipient,
          'rides', 'confirmed', now() - interval '3 hours')
  returning handoff_id into v_ride;

  perform public.giving_handoff_no_show_sweep();

  perform kc_test.assert_eq(kc_test.handoff_status(v_item), 'no_show', 'a missed item pickup is a no-show');
  perform kc_test.assert_eq(kc_test.handoff_status(v_ride), 'confirmed', 'a ride booking is left alone');
end $$;

rollback;

\echo '✓ 0694_fsm_handoffs.sql passed'
