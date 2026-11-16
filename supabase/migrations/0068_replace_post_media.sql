-- Posts · an edit replaces the photos of a post in one transaction (FR-POST-008 AC1, KC#2118)
--
-- A device may insert and delete its own `post_media` rows but never update one, so the edit
-- form made the gallery match in two requests: delete the rows that changed, then insert the
-- new ones. The last photo of a live offer in a photo world cannot be deleted (D132,
-- 30_social/015), so the first request was refused whenever every row changed: swapping the
-- only photo of an item, or removing the first of two (the second one moves up a position).
--
-- `replace_post_media` does the whole change in one call. The rule is checked on the gallery
-- the edit leaves behind, not on the rows it passes through: an offer that ends with no photo
-- is still refused, and the direct delete from a device stays guarded as before.

-- The member rule stands aside for `replace_post_media`, which sets the transaction-local
-- setting `kc.post_media_replace` while it rewrites the rows and checks the result itself.
create or replace function kc_private.post_media_keep_offer_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Server work (the purge and orphan jobs) and the cascade of a deleted post pass: in a
  -- cascade the post row is already gone, so there is nothing left to protect.
  if (select auth.uid()) is null then
    return old;
  end if;
  -- A gallery being replaced is checked once, after its new rows are in.
  if coalesce(current_setting('kc.post_media_replace', true), '') = 'on' then
    return old;
  end if;
  if exists (select 1 from public.posts p
              where p.id = old.post_id and p.status in ('open', 'paused')) then
    perform kc_private.post_require_offer_photo(old.post_id, old.id);
  end if;
  return old;
end;
$$;

-- Makes the photos of the caller's post exactly p_media, in the given order.
--   p_media   [{ "storage_key", "mime_type", "size_bytes" }, …] — files already uploaded to
--             the `post-images` bucket under the caller's folder; position = gallery order
-- A row whose file and position are unchanged is kept (it stays processed); every other row
-- is deleted and the missing ones are inserted as `pending`. The table's own constraints
-- check each file (folder, type, size, five at most).
--   post_not_found        no such post, or not the caller's
--   listing_wrong_status  the post is closed, expired or under moderation (content is locked)
--   invalid_input         p_media is not a list
--   too_many_photos       more than five files
--   offer_photo_required  a live offer in a photo world would be left without a photo
create function public.replace_post_media(p_post_id uuid, p_media jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post constant public.posts := kc_private.post_lock_managed(p_post_id);
begin
  if v_post.status not in ('draft', 'open', 'paused') then
    raise exception 'listing_wrong_status' using errcode = 'P0001';
  end if;
  if p_media is null or jsonb_typeof(p_media) <> 'array' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_media) > 5 then
    raise exception 'too_many_photos' using errcode = 'P0001';
  end if;

  perform set_config('kc.post_media_replace', 'on', true);
  -- Rows that are not wanted at their position go first, so a file that moves to another
  -- position frees its storage key and its place before it is inserted again.
  delete from public.post_media m
   where m.post_id = p_post_id
     and not exists (
       select 1 from jsonb_array_elements(p_media) with ordinality as w (item, position)
        where w.position - 1 = m.ordinal and w.item ->> 'storage_key' = m.storage_key);
  insert into public.post_media (post_id, owner_id, kind, storage_bucket, storage_key, ordinal, mime_type, size_bytes)
  select p_post_id, v_post.owner_id, 'image', 'post-images', w.item ->> 'storage_key', w.position - 1,
         w.item ->> 'mime_type', (w.item ->> 'size_bytes')::bigint
    from jsonb_array_elements(p_media) with ordinality as w (item, position)
   where not exists (select 1 from public.post_media m
                      where m.post_id = p_post_id and m.ordinal = w.position - 1);
  perform set_config('kc.post_media_replace', '', true);

  if v_post.status in ('open', 'paused') then
    perform kc_private.post_require_offer_photo(p_post_id);
  end if;
end;
$$;
comment on function public.replace_post_media(uuid, jsonb) is
  'Owner: makes the photos of a draft, open or paused post exactly the given list, in one transaction.';
grant execute on function public.replace_post_media(uuid, jsonb) to authenticated;
