-- supabase/tests/0693_composer_items_post_keeps_kind.sql | 0693: an items post from the composer
-- gets its listing kind on insert, so it shows in My Listings as it did before 0666.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('ck_owner') as owner;

do $$
declare
  p personas;
  v_give_item uuid := kc_test.listing_kind_id('items', 'give_item');
  v_request_item uuid := kc_test.listing_kind_id('items', 'request_item');
  v_give uuid;
  v_request uuid;
  v_explicit uuid;
  v_other_category text;
  v_other_category_id uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.owner);

  -- The columns SupabasePostRepository.create writes: no kind and no world.
  insert into public.posts (owner_id, type, title, description, category, city, street, street_number, item_condition)
  values (p.owner, 'Give', 'a bookshelf', 'solid oak', 'Furniture', 'tel-aviv', 'Herzl', '1', 'Good')
  returning post_id into v_give;
  insert into public.posts (owner_id, type, title, description, category, city, street, street_number)
  values (p.owner, 'Request', 'looking for a lamp', 'any lamp', 'Furniture', 'tel-aviv', 'Herzl', '1')
  returning post_id into v_request;

  perform kc_test.assert_eq((select kind_id from public.posts where post_id = v_give), v_give_item,
    'a composer give post gets the give_item kind');
  perform kc_test.assert_eq((select kind_id from public.posts where post_id = v_request), v_request_item,
    'a composer request post gets the request_item kind');

  perform kc_test.assert_eq(
    (select count(*)::int from public.list_my_listings(50, 0, null, null) r where r.listing_id in (v_give, v_request)),
    2, 'both composer posts are in My Listings');

  -- Editing the category text of a composer post still moves its items sub-category.
  select c.legacy_post_category, c.category_id into v_other_category, v_other_category_id
    from public.categories c
   where c.world_slug = 'items' and c.legacy_post_category is not null and c.legacy_post_category <> 'Furniture'
   order by c.sort_order limit 1;
  update public.posts set category = v_other_category where post_id = v_give;
  perform kc_test.assert_eq((select category_id from public.posts where post_id = v_give), v_other_category_id,
    'a category edit moves the sub-category of a post that has a kind');
  perform kc_test.assert_eq((select kind_id from public.posts where post_id = v_give), v_give_item,
    'a category edit keeps the kind');

  -- A kind the writer chose is kept.
  insert into public.posts (owner_id, type, title, description, category, city, street, street_number, item_condition, kind_id)
  values (p.owner, 'Give', 'a chair', 'pine', 'Furniture', 'tel-aviv', 'Herzl', '1', 'Good', v_request_item)
  returning post_id into v_explicit;
  perform kc_test.assert_eq((select kind_id from public.posts where post_id = v_explicit), v_request_item,
    'an explicit kind is not overwritten');
end $$;

rollback;
\echo '✓ 0693_composer_items_post_keeps_kind.sql passed'
