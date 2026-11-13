-- Worlds · the preview card of a shared post link (FR-POST-023 AC4, AC10)
--
-- A link-preview crawler (WhatsApp, Telegram, ...) is signed out, and `posts` is not readable
-- by signed-out callers. The card needs a handful of public facts about one post, so this
-- function releases exactly those and nothing else: the post's own words, its kind, its city
-- name and the first processed image. It runs with definer rights, so the row-level rules of
-- `posts` are restated here, and they are the strictest audience of the table's policies:
--   * visibility `Public` (never `FollowersOnly` or `OnlyMe`),
--   * status `open` or `closed_delivered` (drafts, paused, expired and moderated posts stay out),
--   * the owner's account is active (`users.is_active`, the mirror of user_account.status).
-- No owner, no street, no exact point and no counterparty is returned. A post that does not
-- qualify returns no row, indistinguishable from an id that does not exist.
create function public.post_share_card(p_post_id uuid)
returns table (
  title         text,
  description   text,
  post_type     text,
  direction     text,
  world_slug    text,
  status        text,
  city_name_he  text,
  cover_bucket  text,
  cover_key     text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.title, p.description, p.post_type, p.direction, p.world_slug, p.status,
         c.name_he,
         cover.storage_bucket, cover.storage_key
    from public.posts p
    join public.users u on u.id = p.owner_id and u.is_active
    left join public.cities c on c.city_id = p.city_id
    -- The first processed image by gallery position; a video has no still to show here.
    left join lateral (
      select m.storage_bucket, m.storage_key
        from public.post_media m
       where m.post_id = p.id and m.kind = 'image' and m.processing_status = 'ready'
       order by m.ordinal
       limit 1
    ) cover on true
   where p.id = p_post_id
     and p.visibility = 'Public'
     and p.status in ('open', 'closed_delivered');
$$;
comment on function public.post_share_card(uuid) is
  'Public facts of one public, open or delivered post for its link-preview card; no row otherwise. Callable signed out.';
grant execute on function public.post_share_card(uuid) to anon, authenticated;
