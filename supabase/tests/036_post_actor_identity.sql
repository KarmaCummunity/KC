-- M02 / M13: the audience and identity mask of a post participant, and the closed-post count
-- of a profile.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.expand(p_sql text)
returns text language sql as $$
  select regexp_replace(regexp_replace(p_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g'),
                        '#(\d\d)', '''10000000-0000-4000-8000-0000000000\1''::uuid', 'g');
$$;

-- One value of a query run as a member (null = signed out); an error returns its SQLSTATE,
-- or its message when it is a P0001 business error.
create function pg_temp.q(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
  v_sql constant text := pg_temp.expand(p_sql);
begin
  perform set_config('request.jwt.claims', case when p_who is null then '{"role":"anon"}'
    else jsonb_build_object('sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text end, true);
  perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
  execute v_sql into v_value;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return coalesce(v_value, '~');
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
end;
$$;

-- Runs a statement that returns nothing as a member: 'ok' or the error as above.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
begin
  perform set_config('request.jwt.claims', case when p_who is null then '{"role":"anon"}'
    else jsonb_build_object('sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text end, true);
  perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
  execute v_sql;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
end;
$$;

select plan(51);

-- a owns the posts · b receives post 02 · c is a stranger · d follows a · e is platform staff.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) x;
update public.users set display_name = 'Name ' || upper(right(id::text, 1));
insert into public.follows (follower_id, followed_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a');
insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000e', 'support');
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en, default_anonymity_level) values
  ('items', 'items', 'items', 3), ('closed_world', 'cw', 'cw', 1), ('follow_world', 'fw', 'fw', 2);
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
select ('20000000-0000-4000-8000-00000000000' || n)::uuid, w, w || '_kind', w, w, 'either'
  from unnest(array['items', 'closed_world', 'follow_world']) with ordinality as t (w, n);
-- 01 open item · 02 delivered item (to b) · 03 anonymous world · 04 followers-level world · 05 second delivered item
insert into public.posts (id, owner_id, world_slug, kind_id, post_type, direction, status, title, city_id)
select ('10000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-4000-8000-00000000000a', w,
       (select k.id from public.post_kinds k where k.world_slug = w), 'standard', 'offer', 'open', 'post ' || n, 'c1'
  from (values (1, 'items'), (2, 'items'), (3, 'closed_world'), (4, 'follow_world'), (5, 'items')) as p (n, w);
insert into public.post_handoffs (post_id, recipient_id, status) values
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000b', 'handed_over'),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-00000000000b', 'handed_over'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000b', 'confirmed');
select kc_private.post_move('10000000-0000-4000-8000-000000000002', 'closed_delivered', 'owner');
select kc_private.post_move('10000000-0000-4000-8000-000000000005', 'closed_delivered', 'owner');

-- ── upsert_post_actor_identity: who may, what it checks ─────────────────────
select is(pg_temp.act(null, $$select public.upsert_post_actor_identity(#01, 'Public', false)$$), '42501', 'a signed-out caller cannot set an identity');
select is(pg_temp.act('c', $$select public.upsert_post_actor_identity(#01, 'Public', false)$$), 'not_participant', 'a stranger is not a participant');
select is(pg_temp.act('b', $$select public.upsert_post_actor_identity(#01, 'Public', false)$$), 'not_participant', 'nor is a member with no handed-over handoff on the post');
select is(pg_temp.act('a', $$select public.upsert_post_actor_identity(#01, 'Everyone', false)$$), 'invalid_surface_visibility', 'the audience must be a known level');
select is(pg_temp.act('a', $$select public.upsert_post_actor_identity(#01, 'Public', false, 'Secret')$$), 'invalid_identity_visibility', 'so must the identity level');
select is(pg_temp.act('a', $$select public.upsert_post_actor_identity('10000000-0000-4000-8000-000000000099', 'Public', false)$$), 'post_not_found', 'a missing post is reported');
update public.users set privacy_mode = 'Private' where id = '00000000-0000-4000-8000-00000000000a';
select is(pg_temp.act('a', $$select public.upsert_post_actor_identity(#01, 'FollowersOnly', false)$$), 'followers_only_requires_public_profile', 'followers-only audience needs a public profile');
update public.users set privacy_mode = 'Public' where id = '00000000-0000-4000-8000-00000000000a';
select is(pg_temp.act('a', $$select public.upsert_post_actor_identity(#01, 'FollowersOnly', true)$$), 'ok', 'the owner sets the audience of an open post');
select is(pg_temp.q('a', $$select surface_visibility || hide_from_counterparty::text || coalesce(identity_visibility, '-') from public.post_actor_identity where post_id = #01$$),
  'FollowersOnlytrue-', 'the row keeps the choice and leaves the identity level to the world');
select is(pg_temp.q('a', $$select visibility from public.posts where id = #01$$), 'Public', 'an open post keeps its own audience column');
select is(pg_temp.act('a', $$select public.upsert_post_actor_identity(#01, 'Public', false)$$), 'ok', 'a second call replaces the first');
select is(pg_temp.q('a', $$select count(*)::text from public.post_actor_identity where post_id = #01$$), '1', 'one row per participant and post');

-- ── Who reads the table ─────────────────────────────────────────────────────
select is(pg_temp.act('b', $$select public.upsert_post_actor_identity(#02, 'Public', true)$$), 'ok', 'the receiver of a delivered post sets their own row');
select is(pg_temp.q('b', $$select count(*)::text from public.post_actor_identity$$), '1', 'a participant reads only their own row');
select is(pg_temp.q('c', $$select count(*)::text from public.post_actor_identity$$), '0', 'a stranger reads none');
select is(pg_temp.act('a', $$insert into public.post_actor_identity (post_id, user_id) values (#02, @a)$$), '42501', 'nothing is writable directly');

-- ── Masking on cards ────────────────────────────────────────────────────────
select is(pg_temp.q('c', $$select owner_display_name || '|' || owner_identity_masked::text from public.post_cards(array[#01])$$),
  'Name A|false', 'an ordinary post shows its owner');
select is(pg_temp.q('c', $$select owner_identity_masked::text || '|' || coalesce(owner_id::text, '~') || '|' || coalesce(owner_display_name, '~')
    || '|' || coalesce(owner_avatar_url, '~') || '|' || viewer_follows_owner::text from public.post_cards(array[#03])$$),
  'true|~|~|~|false', 'in a world whose default is "operators only" a stranger sees an anonymous poster');
select is(pg_temp.q('a', $$select owner_display_name from public.post_cards(array[#03])$$), 'Name A', 'the owner sees themselves');
select is(pg_temp.q('b', $$select owner_display_name from public.post_cards(array[#03])$$), 'Name A', 'the receiver of a confirmed handoff sees the owner');
select is(pg_temp.q('e', $$select owner_display_name from public.post_cards(array[#03])$$), 'Name A', 'platform staff see through the mask');
select is(pg_temp.q('d', $$select owner_identity_masked::text from public.post_cards(array[#04])$$), 'false', 'in a followers-level world a follower sees the owner');
select is(pg_temp.q('c', $$select owner_identity_masked::text from public.post_cards(array[#04])$$), 'true', 'and a non-follower does not');
select is(pg_temp.act('a', $$select public.upsert_post_actor_identity(#03, 'Public', false, 'Public')$$), 'ok', 'an owner asks to be public in the anonymous world');
select is(pg_temp.q('c', $$select owner_identity_masked::text from public.post_cards(array[#03])$$), 'true', 'the world default is a floor: it cannot be loosened');
select is(pg_temp.act('a', $$select public.upsert_post_actor_identity(#01, 'Public', false, 'Hidden')$$), 'ok', 'an owner hides their identity on an ordinary post');
select is(pg_temp.q('c', $$select owner_identity_masked::text from public.post_cards(array[#01])$$), 'true', 'a stranger now sees an anonymous poster');
select is(pg_temp.q('d', $$select owner_identity_masked::text from public.post_cards(array[#01])$$), 'true', 'a follower as well');
select is(pg_temp.act('a', $$select public.upsert_post_actor_identity(#01, 'Public', false, 'Public')$$), 'ok', 'and shows it again');
select is(pg_temp.q('c', $$select owner_identity_masked::text from public.post_cards(array[#01])$$), 'false', 'which a stranger sees');

-- ── Delivered posts: hide_from_counterparty and OnlyMe ──────────────────────
select is(pg_temp.q('c', $$select owner_identity_masked::text from public.post_cards(array[#02])$$), 'false', 'a delivered post shows its owner by default');
select is(pg_temp.act('a', $$select public.upsert_post_actor_identity(#02, 'Public', true)$$), 'ok', 'the owner hides from third parties');
select is(pg_temp.q('c', $$select owner_identity_masked::text from public.post_cards(array[#02])$$), 'true', 'a stranger sees an anonymous poster');
select is(pg_temp.q('b', $$select owner_display_name from public.post_cards(array[#02])$$), 'Name A', 'the receiver always sees the owner');
select is(pg_temp.act('a', $$select public.upsert_post_actor_identity(#02, 'OnlyMe', false)$$), 'ok', 'the owner moves the delivered post to "only me"');
select is(pg_temp.q('a', $$select visibility from public.posts where id = #02$$), 'OnlyMe', 'which reaches the read policy');
select is(pg_temp.q('c', $$select count(*)::text from public.post_cards(array[#02])$$), '0', 'so a stranger no longer finds it');
select is(pg_temp.q('b', $$select count(*)::text from public.post_cards(array[#02])$$), '1', 'the receiver still does');
select is(pg_temp.act('a', $$select public.upsert_post_actor_identity(#02, 'Public', false)$$), 'ok', 'the owner shows it again');
select is(pg_temp.q('c', $$select owner_identity_masked::text from public.post_cards(array[#02])$$), 'false', 'with the real identity');

-- ── Comments and the other lists ────────────────────────────────────────────
insert into public.post_comments (post_id, author_id, body) values
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000a', 'owner says'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000c', 'stranger says');
select is(pg_temp.q('c', $$select string_agg(coalesce(author_display_name, '~') || author_identity_masked::text, ',' order by body) from public.post_comments_page(#03)$$),
  '~true,Name Cfalse', 'a masked owner is anonymous in the comments; an ordinary commenter is not');
select is(pg_temp.q('b', $$select string_agg(coalesce(author_display_name, '~'), ',' order by body) from public.post_comments_page(#03)$$),
  'Name A,Name C', 'the receiver sees the owner''s comment');
select is(pg_temp.q('c', $$select (public.post_detail(#03) -> 'post' ->> 'owner_identity_masked') || (select count(*) filter (where (k ->> 'author_identity_masked')::boolean)
    from jsonb_array_elements(public.post_detail(#03) -> 'comments') k)$$),
  'true1', 'the detail screen carries both');
select is(pg_temp.q('c', $$select count(*) filter (where (card).owner_identity_masked)::text from public.profile_posts_page(@a, null, 20, 'open')$$),
  '2', 'a profile lists the anonymous posts of its owner as anonymous');
select is(pg_temp.q('c', $$select count(*) filter (where (card).owner_identity_masked)::text from public.feed_page(null, 20, '{"world":"closed_world"}')$$),
  '1', 'and so does the feed');

-- ── M13: closed-post count of a profile ─────────────────────────────────────
select is(pg_temp.q('c', $$select public.profile_closed_posts_count(@a)::text$$), '2', 'a stranger counts the delivered posts they can read');
select is(pg_temp.act('a', $$select public.upsert_post_actor_identity(#05, 'OnlyMe', false)$$), 'ok', 'the owner hides one of them');
select is(pg_temp.q('c', $$select public.profile_closed_posts_count(@a)::text$$), '1', 'the count follows the viewer''s access');
select is(pg_temp.q('c', $$select public.profile_closed_posts_count(@a)::text$$),
  pg_temp.q('c', $$select count(*)::text from public.profile_posts_page(@a, null, 50, 'closed')$$), 'and equals the size of the closed tab');

-- ── Removal ─────────────────────────────────────────────────────────────────
delete from public.posts where id = '10000000-0000-4000-8000-000000000001';
select is((select count(*)::text from public.post_actor_identity where post_id = '10000000-0000-4000-8000-000000000001'), '0', 'deleting a post removes its identity rows');
delete from public.users where id = '00000000-0000-4000-8000-00000000000b';
select is((select count(*)::text from public.post_actor_identity where user_id = '00000000-0000-4000-8000-00000000000b'), '0', 'removing a member removes their rows');

select * from finish();
rollback;
