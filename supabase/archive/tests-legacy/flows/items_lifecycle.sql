-- flows/items_lifecycle.sql | An active item reservation rejects a second member with a domain error (spec 05 §5.2).

begin;

create temp table personas as
select kc_test.create_user('item_giver') as giver,
       kc_test.create_user('item_receiver1') as receiver1,
       kc_test.create_user('item_receiver2') as receiver2;

do $$
declare
  p personas;
  v_listing uuid;
  v_first public.giving_handoffs;
begin
  select * into p from personas;
  v_listing := kc_test.create_listing(
    p.giver, 'items', 'give_item', 'give', 'Test lamp',
    '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb);

  perform kc_test.act_as(p.receiver1);
  v_first := public.reserve_item_giving(v_listing);
  perform kc_test.assert_eq(v_first.status::text, 'reserved', 'first member reserves item');

  perform kc_test.act_as(p.receiver2);
  perform kc_test.assert_raises(
    format('select public.reserve_item_giving(%L)', v_listing),
    'item_already_reserved', 'a second member receives the reservation domain error');
end $$;

rollback;

\echo '✓ flows/items_lifecycle.sql passed'
