-- Posts: the catalog is read-only, a post is visible only to the audience its owner chose,
-- a device writes content but never status or derived columns, the status moves only along
-- its machine and by the right role, and the exact address never leaks into geo_approx.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs one statement as an API role and returns the number of rows it returned or changed.
create function pg_temp.rows_as(p_role text, p_user_id uuid, p_sql text)
returns bigint
language plpgsql
as $$
declare
  v_rows bigint;
begin
  perform set_config(
    'request.jwt.claims', jsonb_build_object('sub', p_user_id, 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
  execute p_sql;
  get diagnostics v_rows = row_count;
  perform set_config('role', 'none', true);
  return v_rows;
end;
$$;

-- Titles of the matrix posts ('<visibility>/<status>') a signed-in member can read.
create function pg_temp.seen_by(p_user_id uuid)
returns text
language plpgsql
as $$
declare
  v_titles text;
begin
  perform set_config(
    'request.jwt.claims', jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select coalesce(string_agg(title, ' ' order by title), '') into v_titles
    from public.posts where title like '%/%';
  perform set_config('role', 'none', true);
  return v_titles;
end;
$$;

-- Moves the posts whose title matches to a status, as server code acting in a role would.
create function pg_temp.move(p_title text, p_status text, p_role text)
returns void
language plpgsql
as $$
begin
  perform set_config('kc.fsm_role', coalesce(p_role, ''), true);
  update public.posts set status = p_status where title like p_title;
  perform set_config('kc.fsm_role', '', true);
end;
$$;

-- Owner's counters as 'public/followers/only-me/created'.
create function pg_temp.counters(p_user_id uuid)
returns text
language sql
as $$
  select open_posts_public || '/' || open_posts_followers_only || '/' || open_posts_only_me
         || '/' || posts_created_total
    from public.user_stats where user_id = p_user_id;
$$;

select plan(63);

-- Alice owns the posts; Bob follows her; Carol is a stranger; Dan and Alice are blocked.
insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test', '{"provider":"google"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test', '{"provider":"google"}'),
  ('00000000-0000-4000-8000-00000000000c', 'carol@example.test', '{"provider":"google"}'),
  ('00000000-0000-4000-8000-00000000000d', 'dan@example.test', '{"provider":"google"}');
insert into public.follows (follower_id, followed_id) values
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a');
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a');

insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)'),
  ('c2', 'c2', 'City Two', 'SRID=4326;POINT(35.21 31.77)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items'), ('food', 'food', 'Food');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either'),
  ('20000000-0000-4000-8000-000000000002', 'food', 'meal_offer', 'meal', 'Meal', 'offer');
insert into public.item_subcategories (id, world_slug, slug, label_he, label_en) values
  ('30000000-0000-4000-8000-000000000001', 'food', 'cooked', 'cooked', 'Cooked');

-- ── Catalog ─────────────────────────────────────────────────────────────────
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000c',
    'select 1 from public.worlds w join public.post_kinds k on k.world_slug = w.slug'),
  2::bigint, 'a member reads the catalog');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000c',
      'update public.worlds set is_active = false')$$,
  '42501', null, 'a member cannot change the catalog');
select throws_ok($$select pg_temp.rows_as('anon', null, 'select 1 from public.post_kinds')$$,
  '42501', null, 'a signed-out caller cannot read the catalog');
select throws_ok(
  $$insert into public.item_subcategories (world_slug, parent_id, slug, label_he, label_en)
    values ('items', '30000000-0000-4000-8000-000000000001', 'child', 'x', 'x')$$,
  '23503', null, 'a subcategory cannot hang under a parent of another world');

-- ── Visibility matrix ───────────────────────────────────────────────────────
insert into public.posts (owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
select '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer',
       case s when 'draft' then 'draft' else 'open' end, v, v || '/' || s, 'c1'
  from unnest(array['Public', 'FollowersOnly', 'OnlyMe']) v,
       unnest(array['open', 'draft', 'closed_delivered', 'removed_admin']) s;
select pg_temp.move('%/closed_delivered', 'closed_delivered', 'owner');
select pg_temp.move('%/removed_admin', 'removed_admin', 'admin');

select is(pg_temp.counters('00000000-0000-4000-8000-00000000000a'), '1/1/1/9',
  'open posts are counted per audience; drafts are not counted as created');
select is(array_length(string_to_array(pg_temp.seen_by('00000000-0000-4000-8000-00000000000a'), ' '), 1), 12,
  'the owner sees every post of theirs, in every status and audience');
select is(pg_temp.seen_by('00000000-0000-4000-8000-00000000000b'),
  'FollowersOnly/closed_delivered FollowersOnly/open Public/closed_delivered Public/open',
  'a follower sees open and delivered posts that are public or for followers');
select is(pg_temp.seen_by('00000000-0000-4000-8000-00000000000c'), 'Public/closed_delivered Public/open',
  'a stranger sees only public open and delivered posts');
select is(pg_temp.seen_by('00000000-0000-4000-8000-00000000000d'), '',
  'a member in a blocked pair sees none of the other side''s posts');
select throws_ok($$select pg_temp.rows_as('anon', null, 'select 1 from public.posts')$$,
  '42501', null, 'a signed-out caller cannot read posts');

select pg_temp.move('Public/open', 'paused', 'owner');
select is(pg_temp.seen_by('00000000-0000-4000-8000-00000000000c'), 'Public/closed_delivered',
  'a paused post is hidden from everyone but its owner');
select pg_temp.move('Public/open', 'open', 'owner');

update public.user_account set status = 'suspended_admin' where user_id = '00000000-0000-4000-8000-00000000000a';
select is(pg_temp.seen_by('00000000-0000-4000-8000-00000000000b'), '',
  'posts of a member whose account is not active are hidden from others');
select is(array_length(string_to_array(pg_temp.seen_by('00000000-0000-4000-8000-00000000000a'), ' '), 1), 12,
  'the owner still sees their own posts while suspended');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
      'insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id) values (''00000000-0000-4000-8000-00000000000a'', ''items'', ''20000000-0000-4000-8000-000000000001'', ''offer'', ''x'', ''c1'')')$$,
  '42501', null, 'a suspended member cannot publish');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $$update public.posts set title = 'x' where title = 'Public/open'$$),
  0::bigint, 'a suspended member cannot edit');
update public.user_account set status = 'active' where user_id = '00000000-0000-4000-8000-00000000000a';

-- ── Client writes ───────────────────────────────────────────────────────────
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $$insert into public.posts (id, owner_id, world_slug, kind_id, direction, title, description, city_id, location_display_level)
      values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items',
              '20000000-0000-4000-8000-000000000001', 'offer', 'Sofa', 'three seats', 'c1', 'FullAddress')$$),
  1::bigint, 'a member publishes their own post');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $$insert into public.posts (owner_id, world_slug, kind_id, direction, status, title, city_id)
      values ('00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'request', 'draft', 'Draft', 'c1')$$),
  1::bigint, 'a member saves a draft');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000c',
      'insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id) values (''00000000-0000-4000-8000-00000000000a'', ''items'', ''20000000-0000-4000-8000-000000000001'', ''offer'', ''x'', ''c1'')')$$,
  '42501', null, 'a member cannot publish in another member''s name');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000c',
      'insert into public.posts (owner_id, world_slug, kind_id, direction, status, title, city_id) values (''00000000-0000-4000-8000-00000000000c'', ''items'', ''20000000-0000-4000-8000-000000000001'', ''offer'', ''closed_delivered'', ''x'', ''c1'')')$$,
  '42501', null, 'a post cannot be created from a device in a status other than draft or open');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000c',
      'insert into public.posts (owner_id, world_slug, kind_id, direction, source, title, city_id) values (''00000000-0000-4000-8000-00000000000c'', ''items'', ''20000000-0000-4000-8000-000000000001'', ''offer'', ''imported'', ''x'', ''c1'')')$$,
  '42501', null, 'server-written columns cannot be set on insert');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000c',
      'insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id) values (''00000000-0000-4000-8000-00000000000c'', ''food'', ''20000000-0000-4000-8000-000000000002'', ''request'', ''x'', ''c1'')')$$,
  'P0001', 'post_kind_not_allowed', 'the direction must be one the kind admits');
select throws_ok(
  $$insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id)
    values ('00000000-0000-4000-8000-00000000000c', 'items', '20000000-0000-4000-8000-000000000002', 'offer', 'x', 'c1')$$,
  '23503', null, 'the kind must belong to the post''s world');
select throws_ok(
  $$insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id, details)
    values ('00000000-0000-4000-8000-00000000000c', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'x', 'c1', '[]')$$,
  '23514', null, 'details must be a JSON object');
select throws_ok(
  $$insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id)
    values ('00000000-0000-4000-8000-00000000000c', 'items', '20000000-0000-4000-8000-000000000001', 'offer', repeat('x', 81), 'c1')$$,
  '23514', null, 'a title is at most 80 characters');

select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $$update public.posts set title = 'Sofa bed', visibility = 'FollowersOnly' where id = '10000000-0000-4000-8000-000000000001'$$),
  1::bigint, 'the owner edits content and audience');
select is(pg_temp.counters('00000000-0000-4000-8000-00000000000a'), '1/2/1/10',
  'a publish and an audience change move the counters');
select ok((select search_vector @@ to_tsquery('simple', 'sofa & seats') from public.posts
            where id = '10000000-0000-4000-8000-000000000001'),
  'the search document follows title and description');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
      'update public.posts set status = ''paused'' where id = ''10000000-0000-4000-8000-000000000001''')$$,
  '42501', null, 'the owner cannot write status from a device');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
      'update public.posts set owner_id = ''00000000-0000-4000-8000-00000000000b'' where id = ''10000000-0000-4000-8000-000000000001''')$$,
  '42501', null, 'a post cannot be handed to another owner');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
      'update public.posts set geo_approx = null where id = ''10000000-0000-4000-8000-000000000001''')$$,
  '42501', null, 'the approximate location cannot be written from a device');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000b',
    $$update public.posts set title = 'mine now' where owner_id = '00000000-0000-4000-8000-00000000000a'$$),
  0::bigint, 'another member cannot edit the post');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $$update public.posts set title = 'changed' where title = 'Public/closed_delivered'$$),
  0::bigint, 'a delivered post is locked for editing');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'delete from public.posts'),
  4::bigint, 'the owner deletes drafts only; published posts stay');

-- ── Status machine ──────────────────────────────────────────────────────────
select throws_ok($$select pg_temp.move('Sofa bed', 'paused', null)$$,
  'P0001', 'forbidden_role', 'a restricted edge is refused without a role');
select throws_ok($$select pg_temp.move('Sofa bed', 'paused', 'system')$$,
  'P0001', 'forbidden_role', 'a restricted edge is refused for another role');
select lives_ok($$select pg_temp.move('Sofa bed', 'paused', 'owner')$$, 'the owner pauses');
select is(pg_temp.counters('00000000-0000-4000-8000-00000000000a'), '1/1/1/10', 'a paused post is not counted as open');
select throws_ok($$select pg_temp.move('Sofa bed', 'closed_delivered', 'owner')$$,
  'P0001', 'illegal_transition', 'a move outside the graph is refused (paused → delivered)');
select throws_ok($$select pg_temp.move('Sofa bed', 'archived', 'owner')$$,
  'P0001', 'unknown_state', 'a status outside the machine is refused');
select throws_ok($$select pg_temp.move('Sofa bed', 'removed_admin', 'owner')$$,
  'P0001', 'forbidden_role', 'only a moderator removes a post');

select lives_ok($$select pg_temp.move('Sofa bed', 'removed_admin', 'admin')$$, 'a moderator removes a paused post');
select is((select status_before_removal from public.posts where title = 'Sofa bed'), 'paused',
  'the status before the removal is remembered');
select throws_ok($$select pg_temp.move('Sofa bed', 'open', 'admin')$$,
  'P0001', 'illegal_transition', 'a restore cannot pick another status');
select lives_ok($$select pg_temp.move('Sofa bed', 'paused', 'admin')$$, 'a restore returns to the remembered status');
select is((select status_before_removal from public.posts where title = 'Sofa bed'), null,
  'the remembered status is consumed by the restore');

update public.posts set expires_at = now() - interval '1 minute' where title = 'Sofa bed';
select throws_ok($$select pg_temp.move('Sofa bed', 'open', 'owner')$$,
  'P0001', 'post_expired', 'a paused post is not resumed after its expiry');
select lives_ok($$select pg_temp.move('Sofa bed', 'expired', 'system')$$, 'the sweep expires a paused post');
select throws_ok($$select pg_temp.move('Sofa bed', 'open', 'owner')$$,
  'P0001', 'illegal_transition', 'an expired post is never reopened');

select pg_temp.move('FollowersOnly/open', 'hidden_pending_review', 'system');
select pg_temp.move('FollowersOnly/open', 'removed_admin', 'admin');
select is((select status_before_removal from public.posts where title = 'FollowersOnly/open'), 'open',
  'a post removed while hidden for review is remembered as open');

insert into public.posts (owner_id, world_slug, kind_id, direction, status, title, city_id)
values ('00000000-0000-4000-8000-00000000000b', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'draft', 'Bob draft', 'c1');
select is((select published_at from public.posts where title = 'Bob draft'), null, 'a draft has no publish time');
select pg_temp.move('Bob draft', 'open', 'owner');
select ok((select published_at is not null from public.posts where title = 'Bob draft'),
  'publishing a draft stamps the publish time');
select is(pg_temp.counters('00000000-0000-4000-8000-00000000000b'), '1/0/0/1',
  'publishing a draft counts it as created and open');

insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id)
select '00000000-0000-4000-8000-00000000000c', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'bulk ' || n, 'c1'
  from generate_series(1, 20) n;
select throws_ok(
  $$insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id)
    values ('00000000-0000-4000-8000-00000000000c', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'one too many', 'c1')$$,
  'P0001', 'post_limit_exceeded', 'a member holds at most 20 open posts');

-- ── Exact address and approximate location ──────────────────────────────────
select is((select extensions.st_astext(geo_approx::extensions.geometry) from public.posts where title = 'Public/open'),
  'POINT(34.78 32.08)', 'without an exact point the post sits at the city centre');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $$insert into public.post_private_locations (post_id, exact_point, street, street_number)
      values ('10000000-0000-4000-8000-000000000001', 'SRID=4326;POINT(34.7811 32.0853)', 'Herzl', '12')$$),
  1::bigint, 'the owner stores the exact address');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000b',
      'insert into public.post_private_locations (post_id, street) values (''10000000-0000-4000-8000-000000000001'', ''x'')')$$,
  '42501', null, 'another member cannot attach an address to the post');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000b', 'select 1 from public.post_private_locations'),
  0::bigint, 'another member cannot read the exact address');

create temp table approx as
  select geo_approx as g from public.posts where id = '10000000-0000-4000-8000-000000000001';
select ok((select extensions.st_distance(a.g, l.exact_point) between 1 and 450
             from approx a, public.post_private_locations l),
  'a full-address post is shown near, but never at, its exact point');
update public.post_private_locations set exact_point = 'SRID=4326;POINT(34.7813 32.0851)';
update public.posts set description = 'edited' where id = '10000000-0000-4000-8000-000000000001';
select ok((select extensions.st_equals(p.geo_approx::extensions.geometry, a.g::extensions.geometry)
             from public.posts p, approx a where p.id = '10000000-0000-4000-8000-000000000001'),
  'the approximate location is stable across edits and small moves of the exact point');
update public.posts set city_id = 'c2', location_display_level = 'CityOnly' where id = '10000000-0000-4000-8000-000000000001';
select is((select extensions.st_astext(geo_approx::extensions.geometry) from public.posts
            where id = '10000000-0000-4000-8000-000000000001'),
  'POINT(35.21 31.77)', 'a city-only post follows its city');
update public.posts set location_display_level = 'FullAddress' where id = '10000000-0000-4000-8000-000000000001';
delete from public.post_private_locations;
select is((select extensions.st_astext(geo_approx::extensions.geometry) from public.posts
            where id = '10000000-0000-4000-8000-000000000001'),
  'POINT(35.21 31.77)', 'removing the exact point falls back to the city centre');

-- ── Account removal ─────────────────────────────────────────────────────────
insert into public.post_private_locations (post_id, street) values ('10000000-0000-4000-8000-000000000001', 'Herzl');
delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
select is((select count(*) from public.posts where owner_id = '00000000-0000-4000-8000-00000000000a')
          + (select count(*) from public.post_private_locations),
  0::bigint, 'removing the account removes its posts and their addresses');
select is(pg_temp.counters('00000000-0000-4000-8000-00000000000c'), '20/0/0/20',
  'another member''s counters are untouched');

select * from finish();
rollback;
