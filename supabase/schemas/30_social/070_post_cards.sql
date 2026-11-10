-- Social · the post card and the post detail screen (design §5.1, layer 4)
--
-- A screen is one call. `post_card` is everything a card shows about a post — the post, its
-- owner, its location name, the cover, the counters and the viewer's own state — and every
-- list in the product (feed, world feed, profile tabs, search, saved posts) returns it.
-- All functions here run with the caller's rights: RLS on `posts` and on each joined table
-- decides what comes back, so a post the caller cannot read is simply absent.

create type public.post_card as (
  id                       uuid,
  owner_id                 uuid,
  world_slug               text,
  kind_id                  uuid,
  post_type                text,
  direction                text,
  status                   text,
  visibility               text,
  title                    text,
  description              text,
  item_subcategory_id      uuid,
  details                  jsonb,
  city_id                  text,
  city_name_he             text,
  city_name_en             text,
  location_display_level   text,
  time_window              tstzrange,
  urgency_level            smallint,
  expires_at               timestamptz,
  published_at             timestamptz,
  created_at               timestamptz,
  owner_display_name       text,
  owner_share_handle       text,
  owner_avatar_url         text,
  owner_verification_level smallint,
  -- First processed file: { id, kind, storage_bucket, storage_key, width, height, blurhash }.
  cover_media              jsonb,
  media_count              integer,
  reactions_count          integer,
  comments_count           integer,
  shares_count             integer,
  -- The viewer's own state: their reaction type (null = none), bookmark, follow of the owner.
  viewer_reaction          text,
  viewer_saved             boolean,
  viewer_follows_owner     boolean
);
comment on type public.post_card is 'Everything a post card shows, as returned by every post list.';

-- What a client needs to fetch and lay out one file.
create function kc_access.post_media_json(p_media public.post_media)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_media.id, 'kind', p_media.kind, 'storage_bucket', p_media.storage_bucket,
    'storage_key', p_media.storage_key, 'width', p_media.width, 'height', p_media.height,
    'duration_ms', p_media.duration_ms, 'blurhash', p_media.blurhash);
$$;
comment on function kc_access.post_media_json(public.post_media) is 'JSON form of a media row inside a card or a detail payload.';
grant execute on function kc_access.post_media_json(public.post_media) to authenticated;

-- Cards of the given posts (at most 100 ids are read), in no particular order. Also the way
-- to hydrate ids held elsewhere — saved posts, a notification, a map pin.
create function public.post_cards(p_post_ids uuid[])
returns setof public.post_card
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.owner_id, p.world_slug, p.kind_id, p.post_type, p.direction, p.status, p.visibility,
         p.title, p.description, p.item_subcategory_id, p.details,
         p.city_id, c.name_he, c.name_en, p.location_display_level, p.time_window, p.urgency_level,
         p.expires_at, p.published_at, p.created_at,
         u.display_name, u.share_handle, u.avatar_url, u.verification_level,
         media.cover, coalesce(media.n, 0),
         coalesce(s.reactions_count, 0), coalesce(s.comments_count, 0), coalesce(s.shares_count, 0),
         (select r.reaction_type from public.post_reactions r
           where r.post_id = p.id and r.user_id = (select auth.uid())),
         exists (select 1 from public.saved_posts sp
                  where sp.user_id = (select auth.uid()) and sp.post_id = p.id),
         exists (select 1 from public.follows f
                  where f.follower_id = (select auth.uid()) and f.followed_id = p.owner_id)
    from public.posts p
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
comment on function public.post_cards(uuid[]) is 'Cards of the listed posts that the caller can read.';
grant execute on function public.post_cards(uuid[]) to authenticated;

-- One page of the comments of a post (p_parent_comment_id null) or of the replies to a
-- comment, oldest first, each with its author, like count, reply count and whether the
-- caller liked it. Keyset on (created_at, id): pass the last row's next_cursor to continue.
create function public.post_comments_page(
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
  select c.id, c.post_id, c.parent_comment_id, c.author_id, u.display_name, u.share_handle, u.avatar_url,
         c.body, c.mention_user_ids, c.created_at, c.edited_at,
         (select count(*)::integer from public.post_comment_reactions r where r.comment_id = c.id),
         (select count(*)::integer from public.post_comments reply where reply.parent_comment_id = c.id),
         exists (select 1 from public.post_comment_reactions r
                  where r.comment_id = c.id and r.user_id = (select auth.uid())),
         jsonb_build_object('t', c.created_at, 'id', c.id)
    from public.post_comments c
    join public.users u on u.id = c.author_id
   where c.post_id = p_post_id
     and c.parent_comment_id is not distinct from p_parent_comment_id
     and (p_cursor is null
          or (c.created_at, c.id) > ((p_cursor ->> 't')::timestamptz, (p_cursor ->> 'id')::uuid))
   order by c.created_at, c.id
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
comment on function public.post_comments_page(uuid, uuid, jsonb, integer) is
  'One keyset page of a post''s comments, or of a comment''s replies, oldest first.';
grant execute on function public.post_comments_page(uuid, uuid, jsonb, integer) to authenticated;

-- The whole post detail screen in one call: the card, every processed file in gallery
-- order and the first page of comments. Null when the caller cannot read the post.
create function public.post_detail(p_post_id uuid)
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
                   from public.post_comments_page(card.id) k))
    from public.post_cards(array[p_post_id]) card;
$$;
comment on function public.post_detail(uuid) is
  'Post detail payload: card, media gallery and first page of comments; null when not readable.';
grant execute on function public.post_detail(uuid) to authenticated;
