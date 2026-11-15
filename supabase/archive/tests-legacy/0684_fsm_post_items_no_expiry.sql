-- supabase/tests/0684_fsm_post_items_no_expiry.sql
-- Wave 1b-iii (#1989), D21: an item has no expiry, so it is never skipped as expired and a
-- paused item can always be resumed. The other world rules of the trigger still hold.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('items_ttl_owner') as owner;

do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;

  -- An item gets no defaulted expiry (it used to get now() + 30 days).
  insert into public.posts (
    owner_id, title, description, category, type, status,
    location_display_level, city, street, street_number, visibility, world_slug
  ) values (
    p.owner, 'Item without expiry', 'Description', 'Furniture', 'Give', 'open',
    'CityOnly', 'tel-aviv', 'Herzl', '1', 'Public', 'items'
  ) returning post_id into v;
  perform kc_test.assert_true(
    (select expires_at from public.posts where post_id = v) is null,
    'an item has no expiry (D21)');

  -- Pause and resume work whatever the post's age: no expiry blocks the resume.
  update public.posts set status = 'paused' where post_id = v;
  update public.posts set status = 'open' where post_id = v;
  perform kc_test.assert_eq(
    (select status from public.posts where post_id = v), 'open', 'a paused item resumes');

end $$;

-- The food rule of the same trigger is unchanged: a food offer still needs its expiry (D28).
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform kc_test.assert_raises(
    format($q$insert into public.posts (
      owner_id, title, description, category, type, status,
      location_display_level, city, street, street_number, visibility, world_slug
    ) values (%L, 'Food', 'D', 'Other', 'Give', 'open', 'CityOnly', 'tel-aviv', 'Herzl', '1', 'Public', 'food')$q$,
    p.owner),
    'food_expiry_required', 'a food offer still requires its expiry');
end $$;

rollback;

\echo '✓ 0684_fsm_post_items_no_expiry.sql passed'
