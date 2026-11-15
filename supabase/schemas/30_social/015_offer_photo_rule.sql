-- Social · an offer in a photo world keeps at least one photo (D132, KC#2020)
--
-- An offer in items, food, housing or animals is published with at least one photo and
-- never loses its last one while it is on the air; requests, rides, events and every other
-- world stay photo-optional. The rule has two enforcement points, both for member writes
-- (a server job, which runs without a session, is exempt):
--   publish_post            a draft offer with no photo is not published (25_handoffs/060)
--   post_media delete       the last photo of an open or paused offer cannot be removed
-- Food offers created by `create_post_with_details` are published in the same call that
-- creates them and get their photos afterwards, so that path is not gated here; the app
-- form requires the photo (`OFFER_PHOTO_WORLDS`, marketplaceWorldRules.ts).
-- The list of worlds lives only here and in that client constant.

create function kc_private.offer_requires_photo(p_world_slug text, p_direction text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_direction = 'offer' and p_world_slug in ('items', 'food', 'housing', 'animals');
$$;
comment on function kc_private.offer_requires_photo(text, text) is
  'True for an offer in items, food, housing or animals, which needs a photo (D132).';

-- Refuses (offer_photo_required) when the post is an offer in a photo world with no file.
-- Any file counts, processed or not: the upload pipeline fails the file, not the post.
create function kc_private.post_require_offer_photo(p_post_id uuid, p_excluding_media_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts;
begin
  select p.* into v_post from public.posts p where p.id = p_post_id;
  if not found or not kc_private.offer_requires_photo(v_post.world_slug, v_post.direction) then
    return;
  end if;
  if not exists (select 1 from public.post_media m
                  where m.post_id = p_post_id and m.id is distinct from p_excluding_media_id) then
    raise exception 'offer_photo_required' using errcode = 'P0001';
  end if;
end;
$$;
comment on function kc_private.post_require_offer_photo(uuid, uuid) is
  'Raises offer_photo_required when a photo-world offer has no file (other than the excluded one).';

create function kc_private.post_media_keep_offer_photo()
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
  if exists (select 1 from public.posts p
              where p.id = old.post_id and p.status in ('open', 'paused')) then
    perform kc_private.post_require_offer_photo(old.post_id, old.id);
  end if;
  return old;
end;
$$;
comment on function kc_private.post_media_keep_offer_photo() is
  'BEFORE DELETE on post_media: a member cannot remove the last photo of a live photo-world offer.';

create trigger post_media_keep_offer_photo
  before delete on public.post_media
  for each row execute function kc_private.post_media_keep_offer_photo();
