-- 0540 | A native listing's details must match its kind's detail_schema (nulls count as
-- absent); rows other writers own (post engine, ingestion) are not checked. Before 0540 the check never ran.

begin;

create temp table personas as
select kc_test.create_user('schema_owner') as owner;

-- Inserts a native listing of the given kind as the owner; the caller asserts the outcome.
create function pg_temp.insert_native(p_owner uuid, p_world text, p_kind text, p_direction text,
                                      p_details jsonb, p_origin text default 'native')
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform kc_test.act_as(p_owner);
  insert into public.listings (owner_id, world_slug, kind_id, direction, title, origin,
                               moderation_status, details, expires_at)
  values (p_owner, p_world, kc_test.listing_kind_id(p_world, p_kind), p_direction,
          'Schema check', p_origin, 'published', p_details, now() + interval '1 day')
  returning listing_id into v_id;
  return v_id;
end $$;

do $$
declare
  p personas;
  v_id uuid;
begin
  select * into p from personas;

  -- A matching listing, with a cleared optional field (null) the app may send.
  v_id := pg_temp.insert_native(p.owner, 'items', 'give_item', 'give',
    '{"item_condition":"Good","weight_kg":null}'::jsonb);
  perform kc_test.assert_eq(kc_test.listing_status(v_id), 'open', 'a matching native listing is accepted');

  perform kc_test.assert_raises(format('select pg_temp.insert_native(%L, %L, %L, %L, %L::jsonb)',
    p.owner, 'items', 'give_item', 'give', '{"item_condition":"good"}'),
    'listing_details_schema_mismatch', 'a value outside the enum is rejected');
  perform kc_test.assert_raises(format('select pg_temp.insert_native(%L, %L, %L, %L, %L::jsonb)',
    p.owner, 'items', 'give_item', 'give', '{"item_condition":"Good","colour":"red"}'),
    'listing_details_schema_mismatch', 'a key the schema does not allow is rejected');
  -- 0700 dropped food_type from give_food's required keys; expires_at is the one left (D28).
  perform kc_test.assert_raises(format('select pg_temp.insert_native(%L, %L, %L, %L, %L::jsonb)',
    p.owner, 'food', 'give_food', 'give', jsonb_build_object('food_type', 'cooked')),
    'listing_details_schema_mismatch', 'a missing required key (expires_at) is rejected');
  perform kc_test.assert_raises(format('select pg_temp.insert_native(%L, %L, %L, %L, %L::jsonb)',
    p.owner, 'food', 'give_food', 'give',
    jsonb_build_object('food_type', 'cooked', 'expires_at', kc_test.iso_in(interval '1 day'),
                       'pickup_window_start', 'tomorrow evening')),
    'listing_details_schema_mismatch', 'a malformed date-time is rejected');

  -- An edit is checked too.
  perform kc_test.assert_raises(format(
    'update public.listings set details = %L::jsonb where listing_id = %L',
    '{"item_condition":"Broken"}', v_id),
    'listing_details_schema_mismatch', 'editing details to a non-matching value is rejected');

  -- Rows other writers own (post engine, ingestion) carry keys the kind schemas do not
  -- describe, such as the post engine's address fields; only native rows are checked.
  v_id := pg_temp.insert_native(p.owner, 'items', 'give_item', 'give',
    '{"street":"Herzl","street_number":"1","location_display_level":"CityOnly"}'::jsonb, 'ingestion');
  perform kc_test.assert_true(v_id is not null, 'a non-native listing is not schema-checked');
end $$;

rollback;

\echo '✓ 0540_listing_details_schema_enforced.sql passed'
