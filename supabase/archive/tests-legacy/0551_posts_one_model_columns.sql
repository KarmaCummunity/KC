-- supabase/tests/0551_posts_one_model_columns.sql | 0551 (G1 step 1, ADR-006): every post
-- carries its giving world, direction, type, expiry and detail fields; a native post derives
-- them from the legacy columns, a mirror copies its listing; a paused listing is a paused post
-- that only its owner sees.

begin;

create temp table personas as
select kc_test.create_user('one_model_owner')  as owner,
       kc_test.create_user('one_model_viewer') as viewer;

/** The mirror post of a listing (fails when there is none). */
create function pg_temp.mirror_of(p_listing uuid)
returns public.posts
language plpgsql
as $$
declare
  v public.posts;
begin
  select * into v from public.posts p where p.listing_id = p_listing;
  if not found then
    perform kc_test.fail('listing has no mirror post');
  end if;
  return v;
end $$;

/** Whether p_viewer may see the post. */
create function pg_temp.visible_to(p_post uuid, p_viewer uuid)
returns boolean
language sql
as $$ select public.is_post_visible_to(p, p_viewer) from public.posts p where p.post_id = p_post $$;

-- ── A native items post derives world, direction, sub-category and geo ───────────────
do $$
declare
  p personas;
  r public.posts;
  v_cat uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.owner);

  insert into public.posts (owner_id, type, title, category, city, street, street_number)
  values (p.owner, 'Request', 'need a reading lamp', 'Furniture', 'tel-aviv', 'Dizengoff', '10')
  returning * into r;

  perform kc_test.assert_eq(r.world_slug, 'items', 'a post of the post engine lives in the items world');
  perform kc_test.assert_eq(r.direction, 'request', 'direction follows the legacy type on insert');
  perform kc_test.assert_eq(r.post_type, 'standard', 'an items post has no extension');
  perform kc_test.assert_eq(r.source, 'native', 'posts written in KC are native');
  perform kc_test.assert_eq(r.details, '{}'::jsonb, 'an items post keeps its fields in columns');

  select c.category_id into v_cat from public.categories c
   where c.world_slug = 'items' and c.legacy_post_category = 'Furniture';
  perform kc_test.assert_eq(r.category_id, v_cat, 'the legacy category text maps to the items sub-category');
  perform kc_test.assert_true(
    r.geo::text is not distinct from public.listing_geo_from_city('tel-aviv')::text,
    'geo comes from the city');

  -- Changing the legacy type moves the direction; changing the direction moves the type.
  update public.posts set type = 'Give' where post_id = r.post_id;
  select * into r from public.posts where post_id = r.post_id;
  perform kc_test.assert_eq(r.direction, 'offer', 'type Give is direction offer');

  update public.posts set direction = 'request' where post_id = r.post_id;
  select * into r from public.posts where post_id = r.post_id;
  perform kc_test.assert_eq(r.type, 'Request', 'direction request is type Request');

  -- A new sub-category text re-maps the sub-category.
  update public.posts set category = 'Books' where post_id = r.post_id;
  select c.category_id into v_cat from public.categories c
   where c.world_slug = 'items' and c.legacy_post_category = 'Books';
  perform kc_test.assert_eq((select category_id from public.posts where post_id = r.post_id), v_cat,
    'the sub-category follows the legacy category');

  -- A paused post is the owner's alone (D104).
  update public.posts set status = 'paused' where post_id = r.post_id;
  perform kc_test.assert_true(pg_temp.visible_to(r.post_id, p.owner), 'the owner sees a paused post');
  perform kc_test.assert_true(not pg_temp.visible_to(r.post_id, p.viewer), 'nobody else sees a paused post');
end $$;

-- ── A ride mirror copies its listing: world, direction, type, expiry, details ────────
do $$
declare
  p personas;
  v_listing uuid;
  l public.listings;
  m public.posts;
begin
  select * into p from personas;
  v_listing := kc_test.create_ride_offer(p.owner, 3, interval '2 hours');
  select * into l from public.listings where listing_id = v_listing;
  m := pg_temp.mirror_of(v_listing);

  perform kc_test.assert_eq(m.world_slug, 'rides', 'the mirror is in the rides world');
  perform kc_test.assert_eq(m.direction, 'offer', 'a give listing is an offer');
  perform kc_test.assert_eq(m.post_type, 'ride', 'a rides post carries the ride extension');
  perform kc_test.assert_eq(m.expires_at, l.expires_at, 'the mirror expires with its listing');
  perform kc_test.assert_eq(m.details, l.details, 'the mirror carries the listing details');
  perform kc_test.assert_eq(m.urgency_level, l.urgency_level, 'urgency is copied');

  -- A listing edit reaches the mirror.
  update public.listings set expires_at = expires_at + interval '1 hour' where listing_id = v_listing;
  update public.posts set expires_at = expires_at + interval '1 hour' where listing_id = v_listing;
  select * into l from public.listings where listing_id = v_listing;
  m := pg_temp.mirror_of(v_listing);
  perform kc_test.assert_eq(m.expires_at, l.expires_at, 'a new expiry reaches the mirror');

  -- Pause / resume (D104): the mirror is paused, owner-only, then open again.
  perform kc_test.act_as(p.owner);
  perform public.pause_my_listing(v_listing);
  m := pg_temp.mirror_of(v_listing);
  perform kc_test.assert_eq(m.status, 'paused', 'a paused listing is a paused post');
  perform kc_test.assert_true(pg_temp.visible_to(m.post_id, p.owner), 'the owner sees the paused mirror');
  perform kc_test.assert_true(not pg_temp.visible_to(m.post_id, p.viewer), 'others do not see the paused mirror');

  perform public.resume_my_listing(v_listing);
  m := pg_temp.mirror_of(v_listing);
  perform kc_test.assert_eq(m.status, 'open', 'a resumed listing is an open post');
end $$;

-- ── An items listing of the create form mirrors with its sub-category ───────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_cat uuid;
  l public.listings;
  m public.posts;
begin
  select * into p from personas;
  select c.category_id into v_cat from public.categories c
   where c.world_slug = 'items' and c.legacy_post_category = 'Books';

  v_listing := kc_test.create_listing(p.owner, 'items', 'request_item', 'request', 'looking for a novel',
    '{"urgency_note":"soon"}'::jsonb, null);
  update public.listings set category_id = v_cat where listing_id = v_listing;
  update public.posts set category_id = v_cat where listing_id = v_listing;

  m := pg_temp.mirror_of(v_listing);
  select * into l from public.listings where listing_id = v_listing;
  perform kc_test.assert_eq(m.world_slug, 'items', 'items listing mirrors into the items world');
  perform kc_test.assert_eq(m.direction, 'request', 'a request listing is a request post');
  perform kc_test.assert_eq(m.type, 'Request', 'the legacy type agrees with the direction');
  perform kc_test.assert_eq(m.category_id, v_cat, 'the world sub-category is copied');
  perform kc_test.assert_eq(m.expires_at, l.expires_at, 'the mirror carries whatever expiry the listing side set');
end $$;

-- ── The report sees no mismatch ─────────────────────────────────────────────────────
do $$
declare
  r jsonb := public.post_unification_report();
begin
  perform kc_test.assert_eq((r ->> 'mirror_field_mismatches')::int, 0, 'every mirror agrees with its listing');
end $$;

rollback;
\echo '✓ 0551_posts_one_model_columns.sql passed'
