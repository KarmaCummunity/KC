-- supabase/tests/0547_my_world_givings.sql | 0547 (FR-STATS-008): a member's own givings per world.
-- Counts only handed-over handoffs (given as owner, received as recipient) and the member's own
-- closed listings; never another member's numbers; worlds without activity are left out.

begin;

create temp table personas as
select kc_test.create_user('givings_me') as me,
       kc_test.create_user('givings_other') as other;

-- A handoff on a fresh items listing of `p_owner` to `p_recipient`, in `p_status`.
create function pg_temp.handoff(p_owner uuid, p_recipient uuid, p_status text)
returns uuid language plpgsql as $$
declare
  v_listing uuid;
  v_post_id uuid;
begin
  v_listing := kc_test.create_listing(p_owner, 'items', 'give_item', 'give', 'item ' || p_status,
    '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb, now() + interval '30 days');
  select coalesce(legacy_post_id, v_listing) into v_post_id from public.listings where listing_id = v_listing;
  if to_regclass('public.giving_handoffs') is not null then
    insert into public.giving_handoffs (listing_id, owner_id, recipient_id, world_slug, status, confirmed_at, handed_over_at)
    values (v_listing, p_owner, p_recipient, 'items', p_status,
            case when p_status in ('confirmed', 'handed_over') then now() end,
            case when p_status = 'handed_over' then now() end);
  end if;
  insert into public.post_handoffs (post_id, owner_id, recipient_id, world_slug, status, confirmed_at, handed_over_at)
  values (v_post_id, p_owner, p_recipient, 'items', p_status,
          case when p_status in ('confirmed', 'handed_over') then now() end,
          case when p_status = 'handed_over' then now() end);
  return v_listing;
end $$;

do $$
declare
  p personas;
  r record;
  v_closed uuid;
begin
  select * into p from personas;
  perform kc_test.assert_true(not has_function_privilege('anon', 'public.my_world_givings()', 'execute'),
    'anon cannot read personal givings');

  -- Me: gave twice (one also closed), received once; a reserved handoff counts nothing.
  -- Created first: inside a WHERE clause the volatile builder would run once per scanned row.
  v_closed := pg_temp.handoff(p.me, p.other, 'handed_over');
  update public.listings set status = 'closed' where listing_id = v_closed;
  update public.posts set status = 'closed_delivered' where listing_id = v_closed or post_id in (select legacy_post_id from public.listings where listing_id = v_closed);
  perform pg_temp.handoff(p.me, p.other, 'handed_over');
  perform pg_temp.handoff(p.other, p.me, 'handed_over');
  perform pg_temp.handoff(p.me, p.other, 'reserved');
  -- The other member's own giving to a third party never shows in my numbers.
  perform pg_temp.handoff(p.other, kc_test.create_user('givings_third'), 'handed_over');

  perform kc_test.act_as(p.me);
  select * into r from public.my_world_givings() where world_slug = 'items';
  perform kc_test.assert_eq(r.given, 2, 'two handed-over givings as the owner');
  perform kc_test.assert_eq(r.received, 1, 'one received as the recipient');
  perform kc_test.assert_eq(r.closed, 1, 'one of my listings closed');
  perform kc_test.assert_true(r.world_label_he is not null, 'with the world label');
  perform kc_test.assert_eq((select count(*) from public.my_world_givings())::integer, 1,
    'worlds without activity are left out');

  perform kc_test.act_as(p.other);
  select * into r from public.my_world_givings() where world_slug = 'items';
  perform kc_test.assert_eq(r.given, 2, 'the other member sees only their own: given to me once and to the third');
  perform kc_test.assert_eq(r.received, 2, 'and what they received from me');

  perform kc_test.act_as_anon();
  perform kc_test.assert_eq((select count(*) from public.my_world_givings())::integer, 0, 'no session, no rows');
end $$;

rollback;

\echo '✓ 0547_my_world_givings.sql passed'
