-- Post reads check row-level security once (NFR-PERF-005): `post_cards`, `post_comments_page`
-- and `post_detail` let the policies pick the posts, the comments and the likers, then build the
-- rest without re-checking each side table. What every member sees must not move, so each read is
-- compared with the definition it replaces (copied below as pg_temp.old_*), for every member and
-- every fixture post, on a fixture that exercises each policy: audience, a blocked pair, a hidden
-- report, staff, a pending file, likes and replies by members some viewers cannot see.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- ── The definitions this replaces (0074 for the cards, the baseline for the others) ────────
create function pg_temp.old_post_cards(p_post_ids uuid[])
returns setof public.post_card
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, case when mk.masked then null else p.owner_id end, p.world_slug, p.kind_id, p.post_type, p.direction, p.status, p.visibility,
         p.title, p.description, p.item_subcategory_id, p.details,
         p.city_id, c.name_he, c.name_en, p.location_display_level, p.time_window, p.urgency_level,
         p.expires_at, p.published_at, p.created_at,
         case when mk.masked then null else u.display_name end,
         case when mk.masked then null else u.share_handle end,
         case when mk.masked then null else u.avatar_url end,
         case when mk.masked then null else u.verification_level end,
         media.cover, coalesce(media.n, 0),
         coalesce(s.reactions_count, 0), coalesce(s.comments_count, 0), coalesce(s.shares_count, 0),
         (select r.reaction_type from public.post_reactions r
           where r.post_id = p.id and r.user_id = (select auth.uid())),
         exists (select 1 from public.saved_posts sp
                  where sp.user_id = (select auth.uid()) and sp.post_id = p.id),
         exists (select 1 from public.follows f
                  where f.follower_id = (select auth.uid()) and f.followed_id = p.owner_id)
           and not mk.masked,
         mk.masked,
         -- What a card needs besides the facts above, so a page is one round trip (NFR-PERF-005).
         -- `geo_approx` is text: the same hex EWKB string a direct read of the column returns.
         p.geo_approx::text, p.source_language, p.status_before_removal,
         p.shown_street, p.shown_street_number,
         (select ch.id from public.challenges ch where ch.post_id = p.id),
         -- Provenance (FR-IMPORT-007 AC3): 'imported' with the platform the member named, for the chip.
         p.source, p.source_platform
    from public.posts p
    cross join lateral (select kc_access.post_actor_masked(p.id, p.owner_id) as masked) mk
    join public.users u on u.id = p.owner_id
    join public.cities c on c.city_id = p.city_id
    left join public.post_stats s on s.post_id = p.id
    left join lateral (
      select count(*)::integer as n,
             (array_agg(kc_access.post_media_json(m) order by m.ordinal))[1] as cover
        from public.post_media m
       where m.post_id = p.id and m.processing_status = 'ready') media on true
   where p.id = any (p_post_ids[1:100]);
$$;

create function pg_temp.old_post_comments_page(
  p_post_id uuid,
  p_parent_comment_id uuid default null,
  p_cursor jsonb default null,
  p_limit integer default 20
)
returns table (
  id uuid,
  post_id uuid,
  parent_comment_id uuid,
  author_id uuid,
  author_display_name text,
  author_share_handle text,
  author_avatar_url text,
  author_identity_masked boolean,
  body text,
  mention_user_ids uuid[],
  created_at timestamptz,
  edited_at timestamptz,
  reactions_count integer,
  replies_count integer,
  viewer_reacted boolean,
  next_cursor jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.post_id, c.parent_comment_id,
         case when mk.masked then null else c.author_id end,
         case when mk.masked then null else u.display_name end,
         case when mk.masked then null else u.share_handle end,
         case when mk.masked then null else u.avatar_url end,
         mk.masked, c.body, c.mention_user_ids, c.created_at, c.edited_at,
         (select count(*)::integer from public.post_comment_reactions r where r.comment_id = c.id),
         (select count(*)::integer from public.post_comments reply where reply.parent_comment_id = c.id),
         exists (select 1 from public.post_comment_reactions r
                  where r.comment_id = c.id and r.user_id = (select auth.uid())),
         jsonb_build_object('t', c.created_at, 'id', c.id)
    from public.post_comments c
    join public.users u on u.id = c.author_id
    cross join lateral (select kc_access.post_actor_masked(c.post_id, c.author_id) as masked) mk
   where c.post_id = p_post_id
     and c.parent_comment_id is not distinct from p_parent_comment_id
     and (p_cursor is null
          or (c.created_at, c.id) > ((p_cursor ->> 't')::timestamptz, (p_cursor ->> 'id')::uuid))
   order by c.created_at, c.id
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

create function pg_temp.old_post_detail(p_post_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'post', to_jsonb(card),
    'media', (select coalesce(jsonb_agg(kc_access.post_media_json(m) order by m.ordinal), '[]'::jsonb)
                from public.post_media m
               where m.post_id = card.id and m.processing_status = 'ready'),
    'comments', (select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb)
                   from pg_temp.old_post_comments_page(card.id) k))
    from pg_temp.old_post_cards(array[p_post_id]) card;
$$;

-- One value of a query run as a member ('a'…'f'), null = signed out. `#a` is a member id,
-- `#p1`…`#p5` a fixture post, `#k1`…`#k6` a comment.
create function pg_temp.expand(p_sql text)
returns text language sql as $$
  select regexp_replace(regexp_replace(regexp_replace(p_sql,
    '#([a-f])\M', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g'),
    '#p([1-5])\M', '''40000000-0000-4000-8000-00000000000\1''::uuid', 'g'),
    '#k([1-6])\M', '''50000000-0000-4000-8000-00000000000\1''::uuid', 'g');
$$;

create function pg_temp.q(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated',
    'sub', '00000000-0000-4000-8000-00000000000' || p_who)::text, true);
  perform set_config('role', 'authenticated', true);
  execute pg_temp.expand(p_sql) into v_value;
  perform set_config('role', 'none', true);
  return coalesce(v_value, '~');
end;
$$;

-- Old and new answers of one read for every member, as 'member=old|new' where they differ.
create function pg_temp.diff(p_new text, p_old text)
returns text
language plpgsql
as $$
declare
  v_who text;
  v_new text;
  v_old text;
  v_out text := '';
begin
  foreach v_who in array array['a', 'b', 'c', 'd', 'e', 'f'] loop
    v_new := pg_temp.q(v_who, p_new);
    v_old := pg_temp.q(v_who, p_old);
    if v_new is distinct from v_old then
      v_out := v_out || v_who || '=' || v_old || '|' || v_new || ' ';
    end if;
  end loop;
  return v_out;
end;
$$;

grant execute on all functions in schema pg_temp to authenticated;

select plan(20);

-- Alice posts; Bob follows her; Carol is a stranger; Dan blocked Alice; Eve blocked Carol;
-- Fay is platform staff and blocked Eve (staff read every post, but not a blocked owner's card).
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || m)::uuid, m || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e', 'f']) m;
insert into public.follows (follower_id, followed_id) values
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a');
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000e', '00000000-0000-4000-8000-00000000000c'),
  ('00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-00000000000e');
insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000f', 'support');
insert into public.cities (city_id, name_he, name_en) values ('c1', 'c1', 'City One');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either');
-- p1 public, p2 followers only, p3 only me, p4 Eve's public post, p5 a draft.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
select ('40000000-0000-4000-8000-00000000000' || n)::uuid,
       case n when 4 then '00000000-0000-4000-8000-00000000000e' else '00000000-0000-4000-8000-00000000000a' end::uuid,
       'items', '20000000-0000-4000-8000-000000000001', 'offer', case n when 5 then 'draft' else 'open' end,
       (array['Public', 'FollowersOnly', 'OnlyMe', 'Public', 'Public'])[n], 'post ' || n, 'c1'
  from generate_series(1, 5) n;
-- Two ready files (out of order) and a pending one on p1.
insert into public.post_media (post_id, owner_id, kind, storage_bucket, storage_key, ordinal, mime_type, size_bytes, processing_status)
values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'image', 'post-images', '00000000-0000-4000-8000-00000000000a/second.jpg', 1, 'image/jpeg', 10, 'ready'),
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'image', 'post-images', '00000000-0000-4000-8000-00000000000a/first.jpg', 0, 'image/jpeg', 10, 'ready'),
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'image', 'post-images', '00000000-0000-4000-8000-00000000000a/later.jpg', 2, 'image/jpeg', 10, 'pending');
insert into public.post_reactions (post_id, user_id, reaction_type) values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'like'),
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000e', 'like');
insert into public.saved_posts (user_id, post_id) values
  ('00000000-0000-4000-8000-00000000000c', '40000000-0000-4000-8000-000000000001');
-- Comments on p1: k1 by Bob, k2 by Eve; replies to k1 by Eve (k3) and Bob (k4); k5 by Carol
-- on p2; k6 by Alice on p1. Carol hid k4 by reporting it.
insert into public.post_comments (id, post_id, author_id, parent_comment_id, body, created_at) values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', null, 'one', now() - interval '6 min'),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000e', null, 'two', now() - interval '5 min'),
  ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000e', '50000000-0000-4000-8000-000000000001', 'three', now() - interval '4 min'),
  ('50000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', '50000000-0000-4000-8000-000000000001', 'four', now() - interval '3 min'),
  ('50000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000b', null, 'five', now() - interval '2 min'),
  ('50000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', null, 'six', now() - interval '1 min');
insert into public.post_comment_reactions (comment_id, user_id)
select '50000000-0000-4000-8000-000000000001', ('00000000-0000-4000-8000-00000000000' || m)::uuid
  from unnest(array['b', 'c', 'e']) m;
insert into public.report_hides (reporter_id, target_type, target_id) values
  ('00000000-0000-4000-8000-00000000000c', 'comment', '50000000-0000-4000-8000-000000000004');

-- ── Same answers as before, for every member ────────────────────────────────────────────────
select is(pg_temp.diff(
    $$select string_agg(c::text, '|' order by c.id) from public.post_cards(array[#p1, #p2, #p3, #p4, #p5]) c$$,
    $$select string_agg(c::text, '|' order by c.id) from pg_temp.old_post_cards(array[#p1, #p2, #p3, #p4, #p5]) c$$),
  '', 'post_cards gives every member the cards and values it gave before');
select is(pg_temp.diff(
    $$select string_agg(c::text, '|' order by c.created_at, c.id) from public.post_comments_page(#p1) c$$,
    $$select string_agg(c::text, '|' order by c.created_at, c.id) from pg_temp.old_post_comments_page(#p1) c$$),
  '', 'a post''s comment page is the same for every member');
select is(pg_temp.diff(
    $$select string_agg(c::text, '|' order by c.created_at, c.id) from public.post_comments_page(#p1, #k1) c$$,
    $$select string_agg(c::text, '|' order by c.created_at, c.id) from pg_temp.old_post_comments_page(#p1, #k1) c$$),
  '', 'a comment''s replies are the same for every member');
select is(pg_temp.diff(
    $$select string_agg(c::text, '|' order by c.created_at, c.id) from public.post_comments_page(#p1, null, null, 1) c$$,
    $$select string_agg(c::text, '|' order by c.created_at, c.id) from pg_temp.old_post_comments_page(#p1, null, null, 1) c$$),
  '', 'and so is a short page');
select is(pg_temp.diff(
    $$select string_agg(c::text, '|' order by c.created_at, c.id)
        from public.post_comments_page(#p1, null, jsonb_build_object('t', (select created_at from public.post_comments where id = #k1), 'id', #k1)) c$$,
    $$select string_agg(c::text, '|' order by c.created_at, c.id)
        from pg_temp.old_post_comments_page(#p1, null, jsonb_build_object('t', (select created_at from public.post_comments where id = #k1), 'id', #k1)) c$$),
  '', 'and the page after a cursor');
select is(pg_temp.diff(
    $$select string_agg(coalesce(public.post_detail(p)::text, '-'), '|' order by p) from unnest(array[#p1, #p2, #p3, #p4, #p5]) p$$,
    $$select string_agg(coalesce(pg_temp.old_post_detail(p)::text, '-'), '|' order by p) from unnest(array[#p1, #p2, #p3, #p4, #p5]) p$$),
  '', 'post_detail is the same payload for every member and post');

-- ── What the fixture shows (so the comparison above compares something) ─────────────────────
select is(pg_temp.q('c', $$select string_agg(right(c.id::text, 1), ',' order by c.id) from public.post_cards(array[#p1, #p2, #p3, #p4, #p5]) c$$),
  '1', 'a stranger reads only the public post of an owner they are not blocked with');
select is(pg_temp.q('b', $$select string_agg(right(c.id::text, 1), ',' order by c.id) from public.post_cards(array[#p1, #p2, #p3, #p4, #p5]) c$$),
  '1,2,4', 'a follower also reads the followers-only post');
select is(pg_temp.q('d', $$select count(*)::text from public.post_cards(array[#p1, #p2, #p3])$$), '0',
  'a member in a blocked pair with the owner reads none');
select is(pg_temp.q('a', $$select string_agg(right(c.id::text, 1), ',' order by c.id) from public.post_cards(array[#p1, #p2, #p3, #p4, #p5]) c$$),
  '1,2,3,4,5', 'the owner reads all of theirs');
select is(pg_temp.q('f', $$select string_agg(right(c.id::text, 1), ',' order by c.id) from public.post_cards(array[#p1, #p2, #p3, #p4, #p5]) c$$),
  '1,2,3,5', 'staff read every post but the one of an owner they blocked');
select is(pg_temp.q('c', $$select media_count || '/' || split_part(cover_media ->> 'storage_key', '/', 2) || '/' || viewer_saved || '/' || coalesce(viewer_reaction, '~')
    from public.post_cards(array[#p1])$$),
  '2/first.jpg/true/~', 'the card counts ready files only, starts from the first, and knows the viewer saved it');
select is(pg_temp.q('b', $$select viewer_reaction from public.post_cards(array[#p1])$$), 'like', 'and the viewer''s own reaction');
select is(pg_temp.q('c', $$select string_agg(right(c.id::text, 1) || ':' || c.replies_count || ':' || c.reactions_count || ':' || c.viewer_reacted, ',' order by c.created_at)
    from public.post_comments_page(#p1) c$$),
  '1:0:2:true,6:0:0:false', 'a viewer blocked with Eve sees neither her comment, her reply nor her like; the hidden reply is not counted');
select is(pg_temp.q('b', $$select string_agg(right(c.id::text, 1) || ':' || c.replies_count || ':' || c.reactions_count || ':' || c.viewer_reacted, ',' order by c.created_at)
    from public.post_comments_page(#p1) c$$),
  '1:2:3:true,2:0:0:false,6:0:0:false', 'another member sees all of them');
select is(pg_temp.q('c', $$select jsonb_array_length(d -> 'media') || '/' || split_part(d -> 'media' -> 0 ->> 'storage_key', '/', 2) || '/' || jsonb_array_length(d -> 'comments')
    from public.post_detail(#p1) d$$),
  '2/first.jpg/2', 'the detail carries the ready gallery in order and the comments the viewer may read');
select is(pg_temp.q('c', $$select coalesce(public.post_detail(#p3)::text, 'null')$$), 'null', 'and is null for a post the viewer cannot read');

-- ── The workers stay off the API ────────────────────────────────────────────────────────────
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'kc_access'
              and p.proname in ('post_card_rows', 'post_comment_rows', 'post_comment_reaction_rows', 'post_gallery')
              and p.prosecdef and p.proconfig @> array['search_path=""']), 4,
  'the four workers are security definer with an empty search path');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'kc_access'
              and p.proname in ('post_card_rows', 'post_comment_rows', 'post_comment_reaction_rows', 'post_gallery')
              and (has_function_privilege('anon', p.oid, 'execute')
                   or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))), 0,
  'neither the signed-out role nor PUBLIC can run them');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('post_card_rows', 'post_comment_rows', 'post_comment_reaction_rows', 'post_gallery')), 0,
  'and none of them is in the API schema');

select * from finish();
rollback;
