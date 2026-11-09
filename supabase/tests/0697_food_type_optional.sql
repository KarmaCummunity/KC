-- 0697 | KC#1398: a food offer's type is its world sub-category, so `give_food` no longer
-- requires `food_type`. Offers from older app builds that still send it keep working, and the
-- expiry stays required (D28). Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('food_type_owner') as owner;

-- Inserts a native food offer as the owner (same path as 0540); the caller asserts the outcome.
create function pg_temp.insert_food_offer(p_owner uuid, p_details jsonb)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform kc_test.act_as(p_owner);
  insert into public.listings (owner_id, world_slug, kind_id, direction, title, origin,
                               moderation_status, details, expires_at)
  values (p_owner, 'food', kc_test.listing_kind_id('food', 'give_food'), 'give',
          'Food type check', 'native', 'published', p_details, now() + interval '1 day')
  returning listing_id into v_id;
  return v_id;
end $$;

do $$
declare
  p personas;
  v_id uuid;
begin
  select * into p from personas;

  perform kc_test.assert_true(
    not exists (select 1 from public.listing_kinds
                 where world_slug = 'food' and slug = 'give_food'
                   and detail_schema -> 'required' ? 'food_type'),
    'give_food no longer requires food_type');

  v_id := pg_temp.insert_food_offer(p.owner, jsonb_build_object('expires_at', kc_test.iso_in(interval '1 day')));
  perform kc_test.assert_eq(kc_test.listing_status(v_id), 'open', 'a food offer without food_type is accepted');

  v_id := pg_temp.insert_food_offer(p.owner,
    jsonb_build_object('food_type', 'cooked', 'expires_at', kc_test.iso_in(interval '1 day')));
  perform kc_test.assert_eq(kc_test.listing_status(v_id), 'open', 'an older app build that still sends food_type is accepted');

  perform kc_test.assert_raises(
    format('select pg_temp.insert_food_offer(%L, %L::jsonb)', p.owner, jsonb_build_object('food_type', 'cooked')),
    'listing_details_schema_mismatch', 'a food offer without expires_at is still rejected');
end $$;

rollback;

\echo '✓ 0697_food_type_optional.sql passed'
