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

select plan(35);

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

-- ── The workers on their own: called directly with ids nobody vetted ─────────────────────────
-- Each worker keeps only what the caller may read, so an id the caller could not read through a
-- policy returns nothing even when it is sent straight to the worker.
select is(pg_temp.diff(
    $$select string_agg(c::text, '|' order by c.id) from kc_access.post_card_rows(array[#p1, #p2, #p3, #p4, #p5]) c$$,
    $$select string_agg(c::text, '|' order by c.id) from pg_temp.old_post_cards(array[#p1, #p2, #p3, #p4, #p5]) c$$),
  '', 'post_card_rows called directly gives every member the cards the policies allow, no more');
select is(pg_temp.q('d', $$select count(*)::text from kc_access.post_card_rows(array[#p1, #p2, #p3])$$), '0',
  'direct call: a member blocked with the owner gets no card');
select is(pg_temp.q('c', $$select count(*)::text from kc_access.post_card_rows(array[#p2, #p3, #p5])$$), '0',
  'direct call: a stranger gets no followers-only, only-me or draft card');
select is(pg_temp.q('f', $$select count(*)::text from kc_access.post_card_rows(array[#p4])$$), '0',
  'direct call: staff get no card of an owner they blocked');
select is(pg_temp.q('c', $$select string_agg(right(w.id::text, 1), ',' order by w.id) from kc_access.post_comment_rows(array[#k1, #k2, #k3, #k4, #k5, #k6]) w$$),
  '1,6', 'direct call: a stranger blocked with Eve gets the comments of the public post only, without Eve''s or the hidden one');
select is(pg_temp.q('b', $$select string_agg(right(w.id::text, 1), ',' order by w.id) from kc_access.post_comment_rows(array[#k1, #k2, #k3, #k4, #k5, #k6]) w$$),
  '1,2,3,4,5,6', 'direct call: a follower gets all of them');
select is(pg_temp.q('d', $$select count(*)::text from kc_access.post_comment_rows(array[#k1, #k6])$$), '0',
  'direct call: no comment of a post whose owner the member is blocked with');
select is(pg_temp.q('c', $$select count(*)::text from kc_access.post_comment_reaction_rows(array[#k1])$$), '2',
  'direct call: likes of a readable comment leave out the liker the member is blocked with');
select is(pg_temp.q('d', $$select count(*)::text from kc_access.post_comment_reaction_rows(array[#k1])$$), '0',
  'direct call: no likes of a comment the member cannot read');
select is(pg_temp.q('c', $$select jsonb_array_length(kc_access.post_gallery(#p1))::text$$), '2',
  'direct call: the gallery of a readable post');
select is(pg_temp.q('d', $$select kc_access.post_gallery(#p1)::text$$), '[]',
  'direct call: no gallery of a post the member cannot read');

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

-- ── Before / after of the full public reads ──────────────────────────────────────────────────
-- Only whole entry points are compared: the old definitions (pg_temp.old_*) against public.post_cards,
-- public.post_comments_page and public.post_detail, as member c, with the same fixed inputs: the
-- eleven post ids below (p1 and ten bench posts), chosen ONCE as that member under row-level
-- security and stored as one literal, and for the comments the same post, parent, cursor and limit,
-- so each public function picks its own page. Equivalence (count and every ordered row, including
-- counts, reactions and viewer flags) is computed once into bench_eq, asserted, and also GATES the
-- numbers: if any check is false or null, no BENCH or PLAN line is printed at all. The timings are
-- warm averages that serialize the whole result. The plans are EXPLAIN (ANALYZE, BUFFERS, JSON) of
-- each whole public statement as the member, old with row-level security inline, new with the
-- definer workers and kc_access predicates opaque. Function bodies on a tiny fixture: not the API,
-- not field latency, and no component is added up or compared on its own.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
select gen_random_uuid(), '00000000-0000-4000-8000-00000000000a', 'items',
       '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'Public', 'bench ' || n, 'c1'
  from generate_series(1, 10) n;
insert into public.post_comments (post_id, author_id, body, created_at)
select '40000000-0000-4000-8000-000000000001',
       (array['00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000c'])[1 + n % 2]::uuid,
       'bench ' || n, now() - make_interval(secs => n)
  from generate_series(1, 40) n;

-- The fixed inputs, populated once under row-level security.
create temp table bench_in as
select pg_temp.q('c', $q$select 'array[' || string_agg(quote_literal(id::text), ',' order by id) || ']::uuid[]'
                            from public.posts where id = #p1 or title like 'bench %'$q$) as ids;
alter table bench_in add column n integer;
update bench_in set n = pg_temp.q('c', 'select cardinality(' || ids || ')::text')::integer;

-- Equivalence results, computed once.
create temp table bench_eq (name text primary key, ok boolean);
insert into bench_eq
select 'ids', (select n = 11 from bench_in)
union all
select 'cards', pg_temp.q('c', format($q$select count(*)::text || ':' || md5(string_agg(c::text, '|' order by c.id)) from pg_temp.old_post_cards(%s) c$q$, (select ids from bench_in)))
              = pg_temp.q('c', format($q$select count(*)::text || ':' || md5(string_agg(c::text, '|' order by c.id)) from public.post_cards(%s) c$q$, (select ids from bench_in)))
union all
select 'comments', pg_temp.q('c', $q$select count(*)::text || ':' || md5(string_agg(c::text, '|' order by c.created_at, c.id)) from pg_temp.old_post_comments_page(#p1, null, null, 5) c$q$)
                 = pg_temp.q('c', $q$select count(*)::text || ':' || md5(string_agg(c::text, '|' order by c.created_at, c.id)) from public.post_comments_page(#p1, null, null, 5) c$q$)
union all
select 'detail', pg_temp.q('c', $q$select md5(pg_temp.old_post_detail(#p1)::text)$q$)
               = pg_temp.q('c', $q$select md5(public.post_detail(#p1)::text)$q$);

select ok((select ok from bench_eq where name = 'ids'), 'before/after input: the fixed id literal holds exactly 11 member-visible posts');
select ok((select ok from bench_eq where name = 'cards'), 'before/after input: post_cards on the eleven fixed ids returns the identical rows');
select ok((select ok from bench_eq where name = 'comments'), 'before/after input: the first comment page (five) returns the identical rows, counts and flags');
select ok((select ok from bench_eq where name = 'detail'), 'before/after input: post_detail returns the identical payload');

create function pg_temp.bench(p_who text, p_sql text, p_runs integer default 30)
returns text
language plpgsql
as $$
declare
  v_t timestamptz;
  v_dummy text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated',
    'sub', '00000000-0000-4000-8000-00000000000' || p_who)::text, true);
  perform set_config('role', 'authenticated', true);
  execute pg_temp.expand(p_sql) into v_dummy;                 -- warm-up, not counted
  v_t := clock_timestamp();
  for i in 1..p_runs loop
    execute pg_temp.expand(p_sql) into v_dummy;
  end loop;
  perform set_config('role', 'none', true);
  return round((extract(epoch from clock_timestamp() - v_t) * 1000 / p_runs)::numeric, 2) || ' ms avg over ' || p_runs || ' warm runs';
exception when others then
  perform set_config('role', 'none', true);
  return 'bench unavailable: ' || sqlerrm;
end;
$$;

-- The plan of the statement inside a SQL function, its arguments replaced by the given literals,
-- run as member p_who with the function's own empty search_path. One line of numbers is returned;
-- the whole JSON follows as a notice.
create function pg_temp.plan_line(p_who text, p_label text, p_function regprocedure, p_args text[])
returns text
language plpgsql
as $$
declare
  v_body text;
  v_names text[];
  v_plan jsonb;
  v_dummy record;
  v_path text := current_setting('search_path');
  i integer;
begin
  select regexp_replace(p.prosrc, ';\s*$', ''), p.proargnames into v_body, v_names from pg_proc p where p.oid = p_function;
  for i in 1..array_length(p_args, 1) loop
    v_body := regexp_replace(v_body, '\m' || v_names[i] || '\M', replace(p_args[i], '\', '\\'), 'g');
  end loop;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated',
    'sub', '00000000-0000-4000-8000-00000000000' || p_who)::text, true);
  perform set_config('role', 'authenticated', true);
  perform set_config('search_path', '', true);
  for v_dummy in execute v_body loop null; end loop;        -- warm
  execute 'explain (analyze, buffers, format json) ' || v_body into v_plan;
  perform set_config('search_path', v_path, true);
  perform set_config('role', 'none', true);
  raise notice 'PLAN-JSON % %', p_label, v_plan::text;
  return format('planning %s ms | execution %s ms | shared hit %s | SubPlan nodes %s | InitPlan nodes %s',
    v_plan -> 0 ->> 'Planning Time', v_plan -> 0 ->> 'Execution Time', v_plan -> 0 -> 'Plan' ->> 'Shared Hit Blocks',
    (select count(*) from jsonb_path_query(v_plan, 'lax $.**."Parent Relationship"') x where x = '"SubPlan"'),
    (select count(*) from jsonb_path_query(v_plan, 'lax $.**."Parent Relationship"') x where x = '"InitPlan"'));
exception when others then
  perform set_config('search_path', v_path, true);
  perform set_config('role', 'none', true);
  return 'plan capture unavailable: ' || sqlerrm;
end;
$$;

-- Prints nothing unless all four equivalence checks are true (a false or null one withholds everything).
create function pg_temp.show_full_read_numbers()
returns void
language plpgsql
as $$
declare
  v_ids text := (select ids from bench_in);
  v_n integer := (select n from bench_in);
  v_post constant text := '''40000000-0000-4000-8000-000000000001''::uuid';
begin
  if (select count(*) from bench_eq) <> 4 or exists (select 1 from bench_eq where ok is not true) then
    raise notice 'BENCH withheld: before/after equivalence not established';
    return;
  end if;
  raise notice 'BENCH (function bodies, tiny fixture, member c, whole result serialized) post_cards on % fixed ids', v_n;
  raise notice 'BENCH post_cards OLD: %', pg_temp.bench('c', format('select length(coalesce(jsonb_agg(to_jsonb(c) order by c.id)::text, '''')) ::text from pg_temp.old_post_cards(%s) c', v_ids));
  raise notice 'BENCH post_cards NEW: %', pg_temp.bench('c', format('select length(coalesce(jsonb_agg(to_jsonb(c) order by c.id)::text, '''')) ::text from public.post_cards(%s) c', v_ids));
  raise notice 'BENCH post_cards OLD plan: %', pg_temp.plan_line('c', 'post_cards OLD', 'pg_temp.old_post_cards(uuid[])'::regprocedure, array[v_ids]);
  raise notice 'BENCH post_cards NEW plan (workers and predicates opaque): %', pg_temp.plan_line('c', 'post_cards NEW', 'public.post_cards(uuid[])'::regprocedure, array[v_ids]);
  raise notice 'BENCH comments page(5) OLD: %', pg_temp.bench('c', format('select length(coalesce(jsonb_agg(to_jsonb(c) order by c.created_at, c.id)::text, '''')) ::text from pg_temp.old_post_comments_page(%s, null, null, 5) c', v_post));
  raise notice 'BENCH comments page(5) NEW: %', pg_temp.bench('c', format('select length(coalesce(jsonb_agg(to_jsonb(c) order by c.created_at, c.id)::text, '''')) ::text from public.post_comments_page(%s, null, null, 5) c', v_post));
  raise notice 'BENCH comments page(5) OLD plan: %', pg_temp.plan_line('c', 'comments page(5) OLD', 'pg_temp.old_post_comments_page(uuid,uuid,jsonb,integer)'::regprocedure, array[v_post, 'null::uuid', 'null::jsonb', '5']);
  raise notice 'BENCH comments page(5) NEW plan (workers and predicates opaque): %', pg_temp.plan_line('c', 'comments page(5) NEW', 'public.post_comments_page(uuid,uuid,jsonb,integer)'::regprocedure, array[v_post, 'null::uuid', 'null::jsonb', '5']);
  raise notice 'BENCH post_detail OLD: %', pg_temp.bench('c', format('select length(pg_temp.old_post_detail(%s)::text)::text', v_post));
  raise notice 'BENCH post_detail NEW: %', pg_temp.bench('c', format('select length(public.post_detail(%s)::text)::text', v_post));
exception when others then
  perform set_config('role', 'none', true);
  raise notice 'BENCH numbers unavailable: %', sqlerrm;
end;
$$;
select pg_temp.show_full_read_numbers();

select * from finish();
rollback;
