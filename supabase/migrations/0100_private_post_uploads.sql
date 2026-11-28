-- Storage · private upload bucket for post photos, server side (FR-POST-005 AC3, AC4; NFR-PRIV-002;
-- supabase/proposals/post-media-privacy-lifecycle/DESIGN.md §3 A, phase 3a; KC#2779)
--
-- A member's original is unsanitized (EXIF, GPS) and was stored in the public `post-images` bucket,
-- where anyone holding its URL could read it, also after its sanitized copy was ready. This adds the
-- server side of a private bucket for originals, `post-uploads`:
--
--   1. The bucket: private, the same limits as `post-images`. A member may insert, see and remove
--      objects in their own folder only (seeing is what a signed URL and a removal need); nobody
--      reads it publicly and nobody renames or overwrites an object in place.
--   2. A pending photo row in either bucket is queued; the job records the bucket of the original.
--   3. The claim hands the worker that bucket; the worker reads the original (and its `-thumb`)
--      from it with the service role and writes the copy to `post-images/derived/`, as before.
--   4. Completion moves the row to `post-images` and the copy's key, so every reader (cards, the post
--      page, the share card, link previews) keeps serving only public, sanitized files.
--   5. `replace_post_media` takes a bucket per item; the orphan rule judges `post-uploads` and
--      matches a job's original by bucket and key.
--
-- Backward compatible: rows and uploads in `post-images` behave exactly as before, so app versions
-- that still upload there keep working. Moving the app to `post-uploads` (owner previews through
-- signed URLs) is a separate change that ships with a release; existing public originals are not
-- touched here.

-- ── 1. The bucket and who may touch it ──────────────────────────────────────────────────────────

-- Skipped where `storage` does not exist (a plain PostgreSQL server), as for the other buckets.
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('post-uploads', 'post-uploads', false, 8388608, array['image/jpeg', 'image/png'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- A member uploads into their own folder only.
  create policy post_uploads_insert_own_folder on storage.objects
    for insert to authenticated
    with check (bucket_id = 'post-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
  -- A member sees their own objects only: a signed URL for the owner's preview and a removal both
  -- read the object's row first. No update policy: an upload is never renamed or replaced in place.
  create policy post_uploads_select_own_folder on storage.objects
    for select to authenticated
    using (bucket_id = 'post-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
  -- A member removes their own uploads (the account purge and the orphan job use the service role).
  create policy post_uploads_delete_own_folder on storage.objects
    for delete to authenticated
    using (bucket_id = 'post-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
end $$;

-- ── 2. The queue records where the original is ──────────────────────────────────────────────────

-- Jobs queued before this change are all `post-images` originals, which the default records.
alter table kc_private.post_media_processing
  add column source_bucket text not null default 'post-images'
    check (source_bucket in ('post-images', 'post-uploads'));
comment on column kc_private.post_media_processing.source_bucket is
  'Bucket of the uploaded original: post-images (public, older app versions) or post-uploads (private).';

-- Queues every new pending image of a photo upload bucket, whoever inserted it.
create or replace function kc_private.post_media_enqueue_processing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'image' and new.storage_bucket in ('post-images', 'post-uploads') and new.processing_status = 'pending' then
    insert into kc_private.post_media_processing (media_id, source_bucket, source_key)
    values (new.id, new.storage_bucket, new.storage_key);
  end if;
  return null;
end;
$$;

-- ── 3. The claim names the bucket of the original ───────────────────────────────────────────────

-- The result gains a column, so the function is recreated (its body is unchanged otherwise, except
-- that a row whose bucket changed since it was queued is skipped like one whose key changed).
drop function public.post_media_processing_claim(integer, integer);

-- Worker call 1 of 3. Hands out up to p_limit (1..10) due jobs, each with a fresh lease token,
-- the attempt number, the original's bucket and key, and the size and type Storage recorded for it
-- (so the worker can refuse an oversized file before downloading it). Jobs whose post is no longer
-- processable are skipped instead. A job whose lease ran out is handed out again; one that ran
-- out on its last attempt fails.
create function public.post_media_processing_claim(p_limit integer default 3, p_lease_seconds integer default 300)
returns table (media_id uuid, lease_token uuid, leased_until timestamptz, attempt smallint, owner_id uuid, post_id uuid,
               storage_bucket text, storage_key text, mime_type text, size_bytes bigint, object_size bigint,
               object_mimetype text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit constant integer := least(greatest(coalesce(p_limit, 3), 1), 10);
  v_lease constant interval := make_interval(secs => least(greatest(coalesce(p_lease_seconds, 300), 60), 900));
  v_job record;
  v_claimed uuid[] := '{}';
begin
  for v_job in
    select q.media_id, q.attempts, m.post_id, m.processing_status, m.storage_bucket, m.storage_key,
           q.source_bucket, q.source_key
      from kc_private.post_media_processing q
      join public.post_media m on m.id = q.media_id
     where q.state in ('queued', 'processing')
       and ((q.state = 'queued' and q.next_attempt_at <= now()) or (q.state = 'processing' and q.leased_until <= now()))
     order by q.next_attempt_at
     limit v_limit
       for update of q skip locked
  loop
    if v_job.processing_status <> 'pending' or v_job.storage_bucket <> v_job.source_bucket
       or v_job.storage_key <> v_job.source_key or not kc_private.post_media_processable(v_job.post_id) then
      update kc_private.post_media_processing
         set state = 'skipped', lease_token = null, leased_until = null
       where post_media_processing.media_id = v_job.media_id;
    elsif v_job.attempts >= 3 then
      update kc_private.post_media_processing
         set state = 'failed', lease_token = null, leased_until = null,
             last_error = coalesce(last_error, 'lease_expired')
       where post_media_processing.media_id = v_job.media_id;
      perform kc_private.post_media_set_status(v_job.media_id, 'failed');
    else
      update kc_private.post_media_processing
         set state = 'processing', attempts = attempts + 1, lease_token = gen_random_uuid(),
             leased_until = now() + v_lease
       where post_media_processing.media_id = v_job.media_id;
      v_claimed := v_claimed || v_job.media_id;
    end if;
  end loop;

  return query
  select q.media_id, q.lease_token, q.leased_until, q.attempts, m.owner_id, m.post_id, m.storage_bucket, m.storage_key,
         m.mime_type, m.size_bytes,
         case when o.metadata ->> 'size' ~ '^[0-9]{1,12}$' then (o.metadata ->> 'size')::bigint end,
         o.metadata ->> 'mimetype'
    from kc_private.post_media_processing q
    join public.post_media m on m.id = q.media_id
    left join storage.objects o on o.bucket_id = m.storage_bucket and o.name = m.storage_key
   where q.media_id = any (v_claimed)
   order by q.next_attempt_at;
end;
$$;
comment on function public.post_media_processing_claim(integer, integer) is
  'process-post-media: claims due photo jobs with a lease, with the bucket of each original. Service role only.';

-- ── 4. Completion moves the row to the public copy ──────────────────────────────────────────────

-- Worker call 2 of 3. Compare-and-set completion. Answers:
--   ready     the row now points at the derivative in `post-images` and is `ready`
--   stale     the lease is not (or no longer) the caller's: nothing changed
--   changed   the row was replaced, moved, already processed, or its post can no longer be shown: skipped
-- Raises when the attempt's object is not what it should be (wrong key, not in Storage, wrong type
-- or size, a pixel size outside the worker's caps).
create or replace function public.post_media_processing_complete(
  p_media_id uuid, p_lease_token uuid, p_derivative_key text, p_size_bytes bigint, p_width integer, p_height integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job kc_private.post_media_processing;
  v_media public.post_media;
  v_mime text;
  v_previous text;
begin
  select * into v_job from kc_private.post_media_processing q where q.media_id = p_media_id for update;
  if not found or v_job.state <> 'processing' or v_job.lease_token is distinct from p_lease_token
     or v_job.leased_until <= now() then
    return 'stale';
  end if;
  select * into v_media from public.post_media m where m.id = p_media_id for update;
  if v_media.processing_status <> 'pending' or v_media.storage_bucket <> v_job.source_bucket
     or v_media.storage_key <> v_job.source_key or not kc_private.post_media_processable(v_media.post_id) then
    update kc_private.post_media_processing
       set state = 'skipped', lease_token = null, leased_until = null
     where media_id = p_media_id;
    return 'changed';
  end if;
  -- The key names the copy's type; it must be this attempt's key for one of the two types.
  v_mime := case p_derivative_key
              when kc_private.post_media_derivative_key(v_media.owner_id, p_media_id, v_job.attempts, 'image/jpeg') then 'image/jpeg'
              when kc_private.post_media_derivative_key(v_media.owner_id, p_media_id, v_job.attempts, 'image/png') then 'image/png'
            end;
  if v_mime is null then
    raise exception 'derivative_key_mismatch' using errcode = 'P0001';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 8388608
     or p_width is null or p_width < 1 or p_width > 4096 or p_height is null or p_height < 1 or p_height > 4096
     or p_width::bigint * p_height > 16777216 then
    raise exception 'invalid_derivative' using errcode = 'P0001';
  end if;
  -- The storage fence: the object this attempt wrote is there, with the key's type and the reported size.
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'post-images' and o.name = p_derivative_key
                    and o.metadata ->> 'mimetype' = v_mime
                    and o.metadata ->> 'size' = p_size_bytes::text) then
    raise exception 'derivative_not_stored' using errcode = 'P0001';
  end if;

  v_previous := coalesce(current_setting('kc.fsm_role', true), '');
  perform set_config('kc.fsm_role', 'system', true);
  -- Copies always live in `post-images/derived/`, whichever bucket the original came from.
  update public.post_media
     set storage_bucket = 'post-images', storage_key = p_derivative_key, mime_type = v_mime, size_bytes = p_size_bytes,
         width = p_width, height = p_height, processing_status = 'ready'
   where id = p_media_id;
  perform set_config('kc.fsm_role', v_previous, true);
  update kc_private.post_media_processing
     set state = 'done', lease_token = null, leased_until = null, derivative_key = p_derivative_key, last_error = null
   where media_id = p_media_id;
  return 'ready';
end;
$$;

-- Queues the pending photos that have no job yet (rows inserted before the queue existed). Only
-- what the claim would process anyway; idempotent. Returns the number of jobs it queued.
create or replace function kc_private.post_media_processing_backfill()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queued integer;
begin
  insert into kc_private.post_media_processing (media_id, source_bucket, source_key)
  select m.id, m.storage_bucket, m.storage_key
    from public.post_media m
   where m.kind = 'image' and m.storage_bucket in ('post-images', 'post-uploads') and m.processing_status = 'pending'
     and kc_private.post_media_processable(m.post_id)
  on conflict (media_id) do nothing;
  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;

-- ── 5. Edits and storage reconciliation know the bucket ─────────────────────────────────────────

-- Makes the photos of the caller's post exactly p_media, in the given order.
--   p_media   [{ "storage_key", "mime_type", "size_bytes", "storage_bucket"? }, …] — files already
--             uploaded under the caller's folder; `storage_bucket` is `post-images` (the default,
--             also for every processed copy) or `post-uploads`; position = gallery order
-- A row whose bucket, file and position are unchanged is kept (it stays processed); every other row
-- is deleted and the missing ones are inserted as `pending`. The table's own constraints
-- check each file (folder, type, size, five at most).
--   post_not_found        no such post, or not the caller's
--   listing_wrong_status  the post is closed, expired or under moderation (content is locked)
--   invalid_input         p_media is not a list, or an item names another bucket
--   too_many_photos       more than five files
--   offer_photo_required  a live offer in a photo world would be left without a photo
create or replace function public.replace_post_media(p_post_id uuid, p_media jsonb)
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
  if exists (select 1 from jsonb_array_elements(p_media) as w (item)
              where coalesce(w.item ->> 'storage_bucket', 'post-images') not in ('post-images', 'post-uploads')) then
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
        where w.position - 1 = m.ordinal and w.item ->> 'storage_key' = m.storage_key
          and coalesce(w.item ->> 'storage_bucket', 'post-images') = m.storage_bucket);
  insert into public.post_media (post_id, owner_id, kind, storage_bucket, storage_key, ordinal, mime_type, size_bytes)
  select p_post_id, v_post.owner_id, 'image', coalesce(w.item ->> 'storage_bucket', 'post-images'),
         w.item ->> 'storage_key', w.position - 1, w.item ->> 'mime_type', (w.item ->> 'size_bytes')::bigint
    from jsonb_array_elements(p_media) with ordinality as w (item, position)
   where not exists (select 1 from public.post_media m
                      where m.post_id = p_post_id and m.ordinal = w.position - 1);
  perform set_config('kc.post_media_replace', '', true);

  if v_post.status in ('open', 'paused') then
    perform kc_private.post_require_offer_photo(p_post_id);
  end if;
end;
$$;

-- Storage reconciliation keeps every object a row still needs:
--   post-images, post-uploads  the file a photo row of that bucket points at, the original a job of
--                              that bucket was made from, and the `-thumb` sibling of either;
--   avatars                    the object a member's avatar_url points at, and its `-thumb` sibling
--                              (unchanged from the avatar reconciliation).
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
   where (p_bucket in ('post-images', 'post-uploads')
          and not exists (select 1 from public.post_media m
                           where m.storage_bucket = p_bucket and m.storage_key in (k.key, b.base))
          and not exists (select 1 from kc_private.post_media_processing q
                           where q.source_bucket = p_bucket and q.source_key in (k.key, b.base)))
      or (p_bucket = 'avatars'
          and not exists (select 1 from (select kc_private.avatar_object_key(u.avatar_url) as key
                                           from public.users u
                                          where u.avatar_url like '%/storage/v1/object/public/avatars/%') r
                           where r.key in (k.key, b.base)));
$$;
