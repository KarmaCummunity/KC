-- Social engagement: media, reactions, shares, bookmarks and their counters. Every row
-- follows the visibility of its post, members in a blocked pair never see each other's
-- rows, counters never go negative, and everything goes with the post or the account.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs one statement as a member ('a'…'e') or as the signed-out role ('anon'). `#a` stands
-- for that member's id, `#p1`…`#p4` for the fixture posts. Returns the first column of the
-- first row, or the number of rows changed when the statement returns nothing.
create function pg_temp.run(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_role constant text := case p_who when 'anon' then 'anon' else 'authenticated' end;
  v_sub constant text := case p_who when 'anon' then null else '00000000-0000-4000-8000-00000000000' || p_who end;
  v_out text;
  v_rows bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', v_role)::text, true);
  perform set_config('role', v_role, true);
  p_sql := regexp_replace(p_sql, '#([a-e])\M', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
  p_sql := regexp_replace(p_sql, '#p([1-4])\M', '''40000000-0000-4000-8000-00000000000\1''::uuid', 'g');
  if p_sql ~* '^\s*select|\sreturning\s' then
    execute p_sql into v_out;
  else
    execute p_sql;
  end if;
  get diagnostics v_rows = row_count;
  perform set_config('role', 'none', true);
  return coalesce(v_out, v_rows::text);
end;
$$;

-- Counters of a fixture post as 'reactions/comments/shares'; '-' when it has no counter row.
create function pg_temp.stats(p_post integer)
returns text
language sql
as $$
  select coalesce((select reactions_count || '/' || comments_count || '/' || shares_count from public.post_stats
                    where post_id = ('40000000-0000-4000-8000-00000000000' || p_post)::uuid), '-');
$$;

-- A status write as server code acting in a role.
create function pg_temp.as_role(p_role text, p_sql text)
returns void
language plpgsql
as $$
begin
  perform set_config('kc.fsm_role', p_role, true);
  execute p_sql;
  perform set_config('kc.fsm_role', '', true);
end;
$$;

select plan(50);

-- Alice owns the posts; Bob follows her; Carol is a stranger; Dan and Alice are blocked;
-- Eve and Carol are blocked.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || m)::uuid, m || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) m;
insert into public.follows (follower_id, followed_id) values
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a');
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000e', '00000000-0000-4000-8000-00000000000c');
insert into public.cities (city_id, name_he, name_en) values ('c1', 'c1', 'City One');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either');
-- p1 public, p2 followers only, p3 only me, p4 draft.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
select ('40000000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-4000-8000-00000000000a', 'items',
       '20000000-0000-4000-8000-000000000001', 'offer', case n when 4 then 'draft' else 'open' end,
       (array['Public', 'FollowersOnly', 'OnlyMe', 'Public'])[n], 'post ' || n, 'c1'
  from generate_series(1, 4) n;

-- ── Media ───────────────────────────────────────────────────────────────────
select is(pg_temp.run('a', $$insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
    select p, #a, '00000000-0000-4000-8000-00000000000a/' || p || '.jpg', 0, 'image/jpeg', 1000
      from unnest(array[#p1, #p2]) p$$), '2', 'the owner attaches files to their own posts');
select throws_ok($$select pg_temp.run('c', 'insert into public.post_media (post_id, owner_id, storage_key, ordinal,
    mime_type, size_bytes) values (#p1, #c, ''00000000-0000-4000-8000-00000000000c/x.jpg'', 1, ''image/jpeg'', 1)')$$,
  '42501', null, 'a member cannot attach a file to another member''s post');
select throws_ok($$select pg_temp.run('a', 'insert into public.post_media (post_id, owner_id, storage_key, ordinal,
    mime_type, size_bytes, processing_status) values (#p1, #a, ''00000000-0000-4000-8000-00000000000a/y.jpg'', 1,
    ''image/jpeg'', 1, ''ready'')')$$,
  '42501', null, 'a device cannot write the processing status');
select throws_ok($$insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
    values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a',
            '00000000-0000-4000-8000-00000000000a/z.jpg', 5, 'image/jpeg', 1)$$,
  '23514', null, 'a post holds at most five files');
select throws_ok($$insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
    values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a',
            '00000000-0000-4000-8000-00000000000a/z.jpg', 1, 'image/jpeg', 8388609)$$,
  '23514', null, 'an image is at most 8 MB');
select throws_ok($$insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
    values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a',
            'elsewhere/z.jpg', 1, 'image/jpeg', 1)$$,
  '23514', null, 'a file lives under its owner''s folder');
select is(pg_temp.run('c', 'select count(*) from public.post_media'), '0', 'an unprocessed file is hidden from others');
select throws_ok($$update public.post_media set processing_status = 'ready'$$,
  'P0001', 'forbidden_role', 'only the media pipeline marks a file ready');
select lives_ok($$select pg_temp.as_role('system', 'update public.post_media set processing_status = ''ready''')$$,
  'the media pipeline marks files ready');
select throws_ok($$select pg_temp.as_role('system', 'update public.post_media set processing_status = ''pending''')$$,
  'P0001', 'illegal_transition', 'a processed file never returns to pending');
select throws_ok($$select pg_temp.as_role('system', 'update public.post_media set processing_status = ''gone''')$$,
  'P0001', 'unknown_state', 'an unknown processing status is refused');
select is(pg_temp.run('c', 'select count(*) from public.post_media') || pg_temp.run('b', 'select count(*) from public.post_media')
    || pg_temp.run('d', 'select count(*) from public.post_media'), '120',
  'processed files follow the post: a stranger sees the public post''s, a follower both, a blocked member none');
select throws_ok($$select pg_temp.run('anon', 'select 1 from public.post_media')$$,
  '42501', null, 'a signed-out caller cannot read media');

-- ── Reactions ───────────────────────────────────────────────────────────────
select is(pg_temp.run('c', 'insert into public.post_reactions (post_id, user_id) values (#p1, #c)'), '1',
  'a member reacts to a post they can read');
select is(pg_temp.run('b', $$select public.set_post_reaction(#p1, 'thanks')$$), 'thanks', 'set_post_reaction adds a reaction');
select is(pg_temp.run('b', $$select public.set_post_reaction(#p1, 'support')$$), 'support', 'set_post_reaction switches the type');
select is((select reaction_type from public.post_reactions where user_id = '00000000-0000-4000-8000-00000000000b')
    || '/' || pg_temp.stats(1), 'support/2/0/0', 'switching the type keeps one reaction and one count');
select throws_ok($$select pg_temp.run('c', 'insert into public.post_reactions (post_id, user_id) values (#p2, #c)')$$,
  '42501', null, 'a member cannot react to a post they cannot read');
select throws_ok($$select pg_temp.run('d', 'insert into public.post_reactions (post_id, user_id) values (#p1, #d)')$$,
  '42501', null, 'a member in a blocked pair with the owner cannot react');
select throws_ok($$select pg_temp.run('c', 'insert into public.post_reactions (post_id, user_id) values (#p1, #b)')$$,
  '42501', null, 'a member cannot react in another member''s name');
select throws_ok($$select pg_temp.run('a', 'insert into public.post_reactions (post_id, user_id) values (#p4, #a)')$$,
  '42501', null, 'a draft takes no reactions, not even from its owner');
select throws_ok($$select pg_temp.run('c', 'select public.set_post_reaction(#p2, ''like'')')$$,
  'P0001', 'post_not_found', 'set_post_reaction refuses a post the caller cannot read');
select throws_ok($$select pg_temp.run('c', 'select public.set_post_reaction(#p1, ''love'')')$$,
  'P0001', 'invalid_reaction_type', 'set_post_reaction refuses an unknown type');
select throws_ok($$select pg_temp.run('c', 'update public.post_reactions set user_id = #b')$$,
  '42501', null, 'the key of a reaction is not writable');
select is(pg_temp.run('a', 'select count(*) from public.post_reactions') || pg_temp.run('e', 'select count(*) from public.post_reactions')
    || pg_temp.run('d', 'select count(*) from public.post_reactions'), '210',
  'reactions follow the post, and a member never sees those of someone in a blocked pair with them');
select is(pg_temp.run('a', $$select public.set_post_reaction(#p1, 'like')$$) || '/' ||
    (select count(*) || '/' || count(*) filter (where payload ->> 'recipient_id' = '00000000-0000-4000-8000-00000000000a'
        and payload -> 'data' ->> 'group_key' like 'post_reaction:40000000-0000-4000-8000-000000000001:%')
       from kc_private.outbox_events where topic = 'notification' and payload ->> 'kind' = 'post_reaction'),
  'like/2/2', 'each reaction notifies the owner once with a per-post hourly group key; the owner''s own does not');
select is(pg_temp.run('b', 'select public.set_post_reaction(#p1, null) is null'), 'true', 'null removes the reaction');
select is(pg_temp.stats(1), '2/0/0', 'removing a reaction lowers the counter');
select throws_ok($$select pg_temp.run('anon', 'select public.set_post_reaction(null, null)')$$,
  '42501', null, 'a signed-out caller cannot react');

-- ── Shares and bookmarks ────────────────────────────────────────────────────
select is(pg_temp.run('c', $$insert into public.post_shares (post_id, user_id, share_kind, external_channel)
    values (#p1, #c, 'external', 'whatsapp')$$) || '/' || pg_temp.stats(1), '1/2/0/1', 'a share is logged and counted');
select throws_ok($$select pg_temp.run('b', 'insert into public.post_shares (post_id, user_id, share_kind)
    values (#p2, #b, ''in_app'')')$$, '42501', null, 'a followers-only post is not shared by a follower');
select throws_ok($$select pg_temp.run('c', 'insert into public.post_shares (post_id, user_id, share_kind)
    values (#p1, #c, ''external'')')$$, '23514', null, 'an external share names its channel');
select is(pg_temp.run('b', 'select count(*) from public.post_shares'), '0', 'who shared a post is visible to the sharer only');
select is(pg_temp.run('c', 'insert into public.saved_posts (user_id, post_id) values (#c, #p1)')
    || pg_temp.run('b', 'insert into public.saved_posts (user_id, post_id) values (#b, #p2)')
    || pg_temp.run('b', 'select count(*) from public.saved_posts'), '111',
  'a member bookmarks posts they can read and sees only their own bookmarks');
select throws_ok($$select pg_temp.run('c', 'insert into public.saved_posts (user_id, post_id) values (#c, #p2)')$$,
  '42501', null, 'a post the caller cannot read cannot be bookmarked');
select throws_ok($$select pg_temp.run('c', 'insert into public.saved_posts (user_id, post_id) values (#b, #p1)')$$,
  '42501', null, 'a member cannot bookmark in another member''s name');
select throws_ok($$select pg_temp.run('anon', 'select 1 from public.saved_posts')$$,
  '42501', null, 'a signed-out caller cannot read bookmarks');

-- ── Cards and detail ────────────────────────────────────────────────────────
select is(pg_temp.run('c', $$select string_agg(title || ':' || reactions_count || ':' || shares_count || ':' || media_count
      || ':' || viewer_reaction || ':' || viewer_saved || ':' || viewer_follows_owner || ':' || (cover_media ->> 'kind'), ',')
    from public.post_cards(array[#p1, #p2, #p3, #p4])$$), 'post 1:2:1:1:like:true:false:image',
  'cards come back only for readable posts, with counters, cover and the viewer''s own state');
select is(pg_temp.run('b', $$select (d -> 'post' ->> 'title') || '/' || jsonb_array_length(d -> 'media') || '/'
      || (d -> 'post' ->> 'viewer_follows_owner') from public.post_detail(#p2) d$$), 'post 2/1/true',
  'post_detail returns the card and the gallery in one call');
select is(pg_temp.run('c', 'select public.post_detail(#p2) is null'), 'true', 'post_detail is null for an unreadable post');
select throws_ok($$select pg_temp.run('anon', 'select public.post_detail(null)')$$,
  '42501', null, 'a signed-out caller cannot open a post');

-- ── The post leaves sight, counters, cascades ───────────────────────────────
do $$ begin perform pg_temp.as_role('owner', 'update public.posts set status = ''paused'' where title = ''post 1'''); end $$;
select is(pg_temp.run('c', 'select (select count(*) from public.post_reactions) + (select count(*) from public.post_stats)
    + (select count(*) from public.post_media) + (select count(*) from public.post_cards(array[#p1]))'), '0',
  'when a post is paused its reactions, counters, media and card disappear for others');
select is(pg_temp.run('a', 'select count(*) from public.post_reactions'), '2', 'the owner still sees them');
select throws_ok($$select pg_temp.run('c', 'select public.set_post_reaction(#p1, ''thanks'')')$$,
  'P0001', 'post_not_found', 'a paused post takes no new reactions');
select is(pg_temp.run('c', 'delete from public.post_reactions where user_id = #c') || '/' || pg_temp.stats(1), '0/2/0/1',
  'engagement on a post out of sight is out of reach, also for the member who made it');
do $$ begin perform pg_temp.as_role('owner', 'update public.posts set status = ''open'' where title = ''post 1'''); end $$;
select is(pg_temp.run('c', 'delete from public.post_reactions where user_id = #c') || '/' || pg_temp.stats(1), '1/1/0/1',
  'a member withdraws their reaction and the counter follows');
update public.post_stats set reactions_count = 0;
select is(pg_temp.run('a', 'delete from public.post_reactions where user_id = #a') || '/' || pg_temp.stats(1), '1/0/0/1',
  'a counter never goes below zero');

insert into public.post_reactions (post_id, user_id)
select '40000000-0000-4000-8000-000000000002', ('00000000-0000-4000-8000-00000000000' || m)::uuid from unnest(array['a', 'b']) m;
delete from auth.users where id = '00000000-0000-4000-8000-00000000000b';
select is(pg_temp.stats(2) || '/' || (select count(*) from public.saved_posts), '1/0/0/1',
  'removing an account removes its reactions and bookmarks and lowers the counters');
select lives_ok($$delete from public.posts where id = '40000000-0000-4000-8000-000000000001'$$,
  'a post with engagement is removed without error');
select is((select count(*) from public.post_media) + (select count(*) from public.post_shares)
    + (select count(*) from public.saved_posts) + (select count(*) from public.post_stats where post_id =
        '40000000-0000-4000-8000-000000000001'), 1::bigint,
  'removing a post removes its media, shares, bookmarks and counters');

select * from finish();
rollback;
