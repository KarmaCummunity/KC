-- Storage · server reconciliation of profile photos (FR-PROFILE-007; FR-AUTH-011;
-- supabase/proposals/post-media-privacy-lifecycle/DESIGN.md §5, phase 2)
--
-- Every avatar upload writes a new object `<user_id>/avatar-<uuid>.jpg`; the app retires the
-- previous one after a committed replacement and discards one that was never saved, but only on a
-- best-effort basis (a device ledger, a fresh profile re-read). A generation the app could not
-- remove stayed in the public `avatars` bucket for good, because the daily orphan job
-- (`reconcile-storage-orphans`) judged `post-images` only.
--
-- An avatar object is referenced exactly when a member's `users.avatar_url` points at it, or when
-- it is the `-thumb` sibling of such an object (written by the app's thumb pipeline and by
-- `backfill-image-thumbs`). This makes `kc_private.storage_orphan_keys` answer for `avatars` with
-- that rule; the worker adds the bucket and keeps its minimum age (a day), so an upload whose
-- profile save is still on its way is never judged.

-- The object key a stored avatar URL points at in the `avatars` bucket, or null when the URL is
-- not one of this project's public avatar URLs (an external provider photo, a bare path, null).
create function kc_private.avatar_object_key(p_url text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(split_part(split_part(substring(p_url from '/storage/v1/object/public/avatars/(.+)$'), '?', 1), '#', 1), '');
$$;
comment on function kc_private.avatar_object_key(text) is
  'The avatars-bucket key of a public avatar URL (query and fragment dropped), or null.';

-- The reconciler asks for up to 500 keys at a time; each is looked up through this index.
create index users_avatar_object_key_idx on public.users (kc_private.avatar_object_key(avatar_url))
  where avatar_url is not null;

-- Storage reconciliation keeps every object a row still needs:
--   post-images  the file a photo row points at, the original a processed row was made from, and
--                the `-thumb` sibling of either (unchanged from 0084);
--   avatars      the object a member's avatar_url points at, and its `-thumb` sibling.
-- Any other bucket is not recorded row by row and is never judged.
create or replace function kc_private.storage_orphan_keys(p_bucket text, p_keys text[])
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select k.key
    from unnest(p_keys) as k (key)
    cross join lateral (select regexp_replace(k.key, '-thumb(\.[A-Za-z0-9]+)?$', '\1') as base) b
   where (p_bucket = 'post-images'
          and not exists (select 1 from public.post_media m
                           where m.storage_bucket = p_bucket and m.storage_key in (k.key, b.base))
          and not exists (select 1 from kc_private.post_media_processing q
                           where q.source_key in (k.key, b.base)))
      or (p_bucket = 'avatars'
          and not exists (select 1 from public.users u
                           where kc_private.avatar_object_key(u.avatar_url) in (k.key, b.base)));
$$;
