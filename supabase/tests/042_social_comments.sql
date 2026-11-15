-- Comments: written and edited as plain rows, one level of replies, mentions resolved by the
-- server, deletion as a status move by the author or the post owner, likes on comments,
-- counters, notifications, and the same visibility rules as every other engagement row.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs one statement as a member ('a'…'e') or as the signed-out role ('anon'). `#a` stands
-- for that member's id, `#p1`…`#p4` for the fixture posts,
-- `#k1`…`#k9` for comment ids. Returns the first column of the
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
  p_sql := regexp_replace(p_sql, '#k([1-9])\M', '''50000000-0000-4000-8000-00000000000\1''::uuid', 'g');
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

select plan(40);

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

update public.users u set share_handle = m.handle from (values
    ('00000000-0000-4000-8000-00000000000a'::uuid, 'a_handle'), ('00000000-0000-4000-8000-00000000000b', 'b_handle'),
    ('00000000-0000-4000-8000-00000000000c', 'c_handle'), ('00000000-0000-4000-8000-00000000000d', 'd_handle')) m (id, handle)
 where u.id = m.id;

-- ── Writing ─────────────────────────────────────────────────────────────────
select is(pg_temp.run('b', $$insert into public.post_comments (id, post_id, author_id, body) values (#k1, #p1, #b, 'first')$$)
    || '/' || pg_temp.stats(1), '1/0/1/0', 'a member comments on a post they can read, and it is counted');
select is(pg_temp.run('c', $$insert into public.post_comments (id, post_id, author_id, parent_comment_id, body)
    values (#k2, #p1, #c, #k1, 'hi @b_handle, @D_HANDLE and @nobody_here') returning mention_user_ids$$),
  '{00000000-0000-4000-8000-00000000000b}',
  'a reply resolves its mentions to members who can read the post (not one in a blocked pair with the owner)');
select throws_ok($$select pg_temp.run('b', 'insert into public.post_comments (id, post_id, author_id, parent_comment_id, body)
    values (#k3, #p1, #b, #k2, ''deeper'')')$$, 'P0001', 'comment_parent_invalid', 'a reply to a reply is refused');
select throws_ok($$select pg_temp.run('b', 'insert into public.post_comments (id, post_id, author_id, parent_comment_id, body)
    values (#k3, #p2, #b, #k1, ''elsewhere'')')$$, 'P0001', 'comment_parent_invalid',
  'a reply belongs to the post of its parent');
select is(pg_temp.run('b', $$insert into public.post_comments (id, post_id, author_id, body)
    values (#k4, #p2, #b, 'psst @c_handle') returning mention_user_ids$$), '{}',
  'a member who cannot read the post is not mentioned');
select is(pg_temp.run('a', $$insert into public.post_comments (id, post_id, author_id, body)
    values (#k5, #p1, #a, 'thanks @c_handle')$$) || '/' || pg_temp.stats(1) || '/' || pg_temp.stats(2), '1/0/3/0/0/1/0',
  'replies and the owner''s own comments count too');
select throws_ok($$select pg_temp.run('c', 'insert into public.post_comments (post_id, author_id, body) values (#p2, #c, ''x'')')$$,
  '42501', null, 'a member cannot comment on a post they cannot read');
select throws_ok($$select pg_temp.run('d', 'insert into public.post_comments (post_id, author_id, body) values (#p1, #d, ''x'')')$$,
  '42501', null, 'a member in a blocked pair with the owner cannot comment');
select throws_ok($$select pg_temp.run('c', 'insert into public.post_comments (post_id, author_id, body) values (#p1, #b, ''x'')')$$,
  '42501', null, 'a member cannot comment in another member''s name');
select throws_ok($$select pg_temp.run('a', 'insert into public.post_comments (post_id, author_id, body) values (#p4, #a, ''x'')')$$,
  '42501', null, 'a draft takes no comments');
select throws_ok($$select pg_temp.run('c', 'insert into public.post_comments (post_id, author_id, body, status)
    values (#p1, #c, ''x'', ''active'')')$$, '42501', null, 'a device cannot write the status of a comment');
select throws_ok($$insert into public.post_comments (post_id, author_id, body)
    values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000c', '  padded ')$$,
  '23514', null, 'a comment body is stored trimmed and non-empty');
select is((select string_agg(kind || ':' || right(recipient, 1) || '=' || n, ' ' order by kind)
     from (select payload ->> 'kind' as kind, payload ->> 'recipient_id' as recipient, count(*) as n
             from kc_private.outbox_events
            where topic = 'notification' and payload ->> 'kind' like 'post\_%' group by 1, 2) e),
  'post_comment:a=3 post_comment_reply:b=1 post_mention:c=1',
  'a comment notifies the post owner, a reply its parent''s author, a mention the member named: each once, never the author');

-- ── Editing ─────────────────────────────────────────────────────────────────
select is(pg_temp.run('b', $$update public.post_comments set body = 'first, edited for @c_handle' where id = #k1
    returning (edited_at is not null)::text || mention_user_ids::text$$), 'true{00000000-0000-4000-8000-00000000000c}',
  'the author edits the body; the edit is stamped and mentions are refreshed');
select is(pg_temp.run('c', $$update public.post_comments set body = 'hijacked' where id = #k1$$), '0',
  'a member cannot edit another member''s comment');
select throws_ok($$select pg_temp.run('b', 'update public.post_comments set status = ''deleted'' where id = #k1')$$,
  '42501', null, 'the status of a comment is not writable by a device');

-- ── Reading ─────────────────────────────────────────────────────────────────
select is(pg_temp.run('c', 'select count(*) from public.post_comments') || pg_temp.run('b', 'select count(*) from public.post_comments')
    || pg_temp.run('e', 'select count(*) from public.post_comments') || pg_temp.run('d', 'select count(*) from public.post_comments'),
  '3420', 'comments follow the post, and a member never sees those of someone in a blocked pair with them');
select throws_ok($$select pg_temp.run('anon', 'select 1 from public.post_comments')$$,
  '42501', null, 'a signed-out caller cannot read comments');
select is(pg_temp.run('c', 'insert into public.post_comment_reactions (comment_id, user_id) values (#k1, #c)'), '1',
  'a member likes a comment they can read');
select throws_ok($$select pg_temp.run('c', 'insert into public.post_comment_reactions (comment_id, user_id) values (#k4, #c)')$$,
  '42501', null, 'a comment on an unreadable post cannot be liked');
select throws_ok($$select pg_temp.run('d', 'insert into public.post_comment_reactions (comment_id, user_id) values (#k1, #d)')$$,
  '42501', null, 'a member in a blocked pair with the post owner cannot like its comments');
select is(pg_temp.run('b', 'select count(*) from public.post_comment_reactions')
    || pg_temp.run('e', 'select count(*) from public.post_comment_reactions'), '10',
  'comment likes are visible with the comment, except those of a member in a blocked pair with the viewer');
select is(pg_temp.run('c', $$select string_agg(body || '|' || author_share_handle || '|' || replies_count || '|'
      || reactions_count || '|' || viewer_reacted, ' ; ') from public.post_comments_page(#p1)$$),
  'first, edited for @c_handle|b_handle|1|1|true ; thanks @c_handle|a_handle|0|0|false',
  'post_comments_page lists top-level comments oldest first with author, counts and the viewer''s like');
select is(pg_temp.run('c', $$select string_agg(p2.body, ',') from public.post_comments_page(#p1, null, null, 1) p1,
      public.post_comments_page(#p1, null, p1.next_cursor, 5) p2$$), 'thanks @c_handle',
  'the cursor continues after the last row');
select is(pg_temp.run('b', $$select string_agg(body, ',') from public.post_comments_page(#p1, #k1)$$),
  'hi @b_handle, @D_HANDLE and @nobody_here', 'replies are paged by their parent');
select is(pg_temp.run('c', $$select jsonb_array_length(public.post_detail(#p1) -> 'comments')$$), '2',
  'post_detail carries the first page of comments');

-- ── Deleting ────────────────────────────────────────────────────────────────
select throws_ok($$select pg_temp.run('c', 'select public.delete_post_comment(#k1)')$$,
  'P0001', 'comment_not_found', 'a member who is neither the author nor the post owner cannot delete a comment');
select throws_ok($$select pg_temp.run('anon', 'select public.delete_post_comment(null)')$$,
  '42501', null, 'a signed-out caller cannot delete a comment');
select lives_ok($$select pg_temp.run('a', 'select public.delete_post_comment(#k1)')$$, 'the post owner deletes a comment');
select is((select string_agg(status, ',' order by id) from public.post_comments
            where post_id = '40000000-0000-4000-8000-000000000001')
    || '/' || pg_temp.stats(1), 'deleted,deleted,active/0/1/0', 'its replies go with it and stop counting');
select is(pg_temp.run('b', 'select count(*) from public.post_comments where post_id = #p1')
    || pg_temp.run('b', 'select count(*) from public.post_comment_reactions'), '10',
  'a deleted comment and its likes are visible to nobody, its author included');
select lives_ok($$select pg_temp.run('b', 'select public.delete_post_comment(#k4)')$$, 'the author deletes their own comment');
select lives_ok($$select pg_temp.run('b', 'select public.delete_post_comment(#k4)')$$, 'deleting twice is harmless');
select is(pg_temp.stats(2), '0/0/0', 'a deletion is counted once');
select throws_ok($$update public.post_comments set status = 'deleted' where body like 'thanks%'$$,
  'P0001', 'forbidden_role', 'a comment is not deleted without a role');
select throws_ok($$select pg_temp.as_role('author', 'update public.post_comments set status = ''active''')$$,
  'P0001', 'forbidden_role', 'its author never restores a deleted comment (only staff, 0016)');
select throws_ok($$select pg_temp.as_role('admin', 'update public.post_comments set status = ''hidden''')$$,
  'P0001', 'unknown_state', 'an unknown comment status is refused');

-- ── Write rate and cascades ─────────────────────────────────────────────────
insert into public.post_comments (post_id, author_id, body)
select '40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000c', 'burst ' || n
  from generate_series(1, 19) n;
-- The limit itself is configuration (95_platform): set it to what Carol already wrote.
update kc_private.rate_limits set max_count = (
  select c.hits from kc_private.rate_limit_counters c where c.key = 'comment_create:00000000-0000-4000-8000-00000000000c')
 where action = 'comment_create';
select throws_ok($$select pg_temp.run('c', 'insert into public.post_comments (post_id, author_id, body) values (#p1, #c, ''one more'')')$$,
  'P0001', 'rate_limited', 'a member''s comments are rate limited');
delete from auth.users where id = '00000000-0000-4000-8000-00000000000c';
select is(pg_temp.stats(1) || '/' || (select count(*) from public.post_comments where status = 'active'), '0/1/0/1',
  'removing an account removes its comments and lowers the counter');
delete from public.posts where id = '40000000-0000-4000-8000-000000000001';
select is((select count(*) from public.post_comments) + (select count(*) from public.post_comment_reactions),
  1::bigint, 'removing a post removes its comments and their likes');

select * from finish();
rollback;
