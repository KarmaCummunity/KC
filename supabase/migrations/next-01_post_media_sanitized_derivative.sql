-- Posts · a sanitized server-made copy of each new post photo becomes the photo others see
-- (FR-POST-005 AC3, AC4; NFR-PRIV-002; KC#2316)
--
-- A member's upload is untrusted: it may carry EXIF (GPS), be a mislabelled non-image or a
-- decompression bomb. Nothing ever moved a `pending` row to `ready`, so no member photo reached
-- another member, a feed card or a link preview. This adds the server step, as a candidate for
-- review, WITHOUT a schedule (activation is a separate, gated step):
--
--   1. A new image row in `post-images` is queued (AFTER INSERT; rows that already exist are
--      never queued: no backfill, no sweep).
--   2. The worker `process-post-media` (service role) claims a few due jobs at a time
--      (SKIP LOCKED, partial index on the due jobs only), receives a fresh lease token and the
--      object's stored size and type, and refuses anything over the cap before downloading.
--   3. It re-encodes the image into a NEW object `<owner>/derived/<media_id>-a<attempt>.jpg`
--      (plus its `-thumb`), never touching the original, and calls `..._complete`.
--   4. `..._complete` is a compare-and-set: it finalizes only when the lease is still the
--      caller's, the row is unchanged and still `pending`, the post is still in a showable
--      state, the key is exactly the one this attempt had to write, and Storage really holds
--      that object with the reported size (the database lease alone is not a storage fence).
--      Then the row points at the copy (`storage_key`), so every reader (cards, the post page,
--      the share card, link previews) serves only the sanitized file. The original's key stays
--      in the private job row, out of every client read; the original object is kept.
--   5. Failures retry with back-off up to three attempts, then the job and the row are `failed`.

-- The work queue: one row per new photo, private to the server.
create table kc_private.post_media_processing (
  media_id        uuid primary key references public.post_media (id) on delete cascade,
  -- The object the member uploaded; kept here (never on a client-readable row) once the row
  -- points at the derivative, so storage reconciliation still treats the original as referenced.
  source_key      text not null check (char_length(source_key) between 1 and 512),
  state           text not null default 'queued'
                    check (state in ('queued', 'processing', 'done', 'failed', 'skipped')),
  -- Claims so far; the n-th claim writes `...-a<n>.jpg`, so attempts never share an object.
  attempts        smallint not null default 0 check (attempts between 0 and 3),
  lease_token     uuid,
  leased_until    timestamptz,
  next_attempt_at timestamptz not null default now(),
  derivative_key  text check (char_length(derivative_key) between 1 and 512),
  last_error      text,
  created_at      timestamptz not null default now(),
  constraint post_media_processing_lease_chk
    check ((state = 'processing') = (lease_token is not null and leased_until is not null))
);
comment on table kc_private.post_media_processing is
  'Server work queue: sanitized derivative of each new post photo (KC#2316). Service role only.';

-- The claim scans due jobs only: finished jobs leave the index.
create index post_media_processing_due_idx on kc_private.post_media_processing (next_attempt_at)
  where state in ('queued', 'processing');
-- Storage reconciliation looks originals up by key.
create index post_media_processing_source_key_idx on kc_private.post_media_processing (source_key);

alter table kc_private.post_media_processing enable row level security;
alter table kc_private.post_media_processing force row level security;

-- Post states whose photos are processed; any other state (deleted, expired, under review,
-- removed) stops the work, and a job that meets one is `skipped`.
create function kc_private.post_media_processable(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.posts p
                  where p.id = p_post_id and p.status in ('draft', 'open', 'paused', 'closed_delivered'));
$$;

-- Queues every new pending image of `post-images`, whoever inserted it.
create function kc_private.post_media_enqueue_processing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'image' and new.storage_bucket = 'post-images' and new.processing_status = 'pending' then
    insert into kc_private.post_media_processing (media_id, source_key) values (new.id, new.storage_key);
  end if;
  return null;
end;
$$;

create trigger post_media_enqueue_processing
  after insert on public.post_media
  for each row execute function kc_private.post_media_enqueue_processing();

-- Moves one row out of `pending` as the media pipeline (role `system`), restoring the caller's role.
create function kc_private.post_media_set_status(p_media_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text := coalesce(current_setting('kc.fsm_role', true), '');
begin
  perform set_config('kc.fsm_role', 'system', true);
  update public.post_media set processing_status = p_status
   where id = p_media_id and processing_status = 'pending';
  perform set_config('kc.fsm_role', v_previous, true);
end;
$$;

-- Worker call 1 of 3. Hands out up to p_limit (1..10) due jobs, each with a fresh lease token,
-- the attempt number, the object's location and the size and type Storage recorded for it (so
-- the worker can refuse an oversized file before downloading it). Jobs whose post is no longer
-- processable are skipped instead. A job whose lease ran out is handed out again; one that ran
-- out on its last attempt fails.
create function public.post_media_processing_claim(p_limit integer default 3, p_lease_seconds integer default 300)
returns table (media_id uuid, lease_token uuid, attempt smallint, owner_id uuid, post_id uuid,
               storage_key text, mime_type text, size_bytes bigint, object_size bigint, object_mimetype text)
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
    select q.media_id, q.attempts, m.post_id, m.processing_status, m.storage_key, q.source_key
      from kc_private.post_media_processing q
      join public.post_media m on m.id = q.media_id
     where q.state in ('queued', 'processing')
       and ((q.state = 'queued' and q.next_attempt_at <= now()) or (q.state = 'processing' and q.leased_until <= now()))
     order by q.next_attempt_at
     limit v_limit
       for update of q skip locked
  loop
    if v_job.processing_status <> 'pending' or v_job.storage_key <> v_job.source_key
       or not kc_private.post_media_processable(v_job.post_id) then
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
  select q.media_id, q.lease_token, q.attempts, m.owner_id, m.post_id, m.storage_key, m.mime_type, m.size_bytes,
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
  'process-post-media: claims due photo jobs with a lease. Service role only.';

-- The object key attempt n of a job must write. Deterministic, under the owner's folder, and
-- distinct from every other attempt and from the original.
create function kc_private.post_media_derivative_key(p_owner_id uuid, p_media_id uuid, p_attempt integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select p_owner_id::text || '/derived/' || p_media_id::text || '-a' || p_attempt::text || '.jpg';
$$;

-- Worker call 2 of 3. Compare-and-set completion. Answers:
--   ready     the row now points at the derivative and is `ready`
--   stale     the lease is not (or no longer) the caller's: nothing changed
--   changed   the row was replaced, already processed, or its post can no longer be shown: skipped
-- Raises when the attempt's object is not what it should be (wrong key, not in Storage, wrong size).
create function public.post_media_processing_complete(
  p_media_id uuid, p_lease_token uuid, p_derivative_key text, p_size_bytes bigint, p_width integer, p_height integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job kc_private.post_media_processing;
  v_media public.post_media;
  v_previous text;
begin
  select * into v_job from kc_private.post_media_processing q where q.media_id = p_media_id for update;
  if not found or v_job.state <> 'processing' or v_job.lease_token is distinct from p_lease_token
     or v_job.leased_until <= now() then
    return 'stale';
  end if;
  select * into v_media from public.post_media m where m.id = p_media_id for update;
  if v_media.processing_status <> 'pending' or v_media.storage_key <> v_job.source_key
     or not kc_private.post_media_processable(v_media.post_id) then
    update kc_private.post_media_processing
       set state = 'skipped', lease_token = null, leased_until = null
     where media_id = p_media_id;
    return 'changed';
  end if;
  if p_derivative_key is distinct from kc_private.post_media_derivative_key(v_media.owner_id, p_media_id, v_job.attempts) then
    raise exception 'derivative_key_mismatch' using errcode = 'P0001';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 8388608
     or p_width is null or p_width < 1 or p_width > 2048 or p_height is null or p_height < 1 or p_height > 2048 then
    raise exception 'invalid_derivative' using errcode = 'P0001';
  end if;
  -- The storage fence: the object this attempt wrote is there, as a JPEG of the reported size.
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'post-images' and o.name = p_derivative_key
                    and o.metadata ->> 'mimetype' = 'image/jpeg'
                    and o.metadata ->> 'size' = p_size_bytes::text) then
    raise exception 'derivative_not_stored' using errcode = 'P0001';
  end if;

  v_previous := coalesce(current_setting('kc.fsm_role', true), '');
  perform set_config('kc.fsm_role', 'system', true);
  update public.post_media
     set storage_key = p_derivative_key, mime_type = 'image/jpeg', size_bytes = p_size_bytes,
         width = p_width, height = p_height, processing_status = 'ready'
   where id = p_media_id;
  perform set_config('kc.fsm_role', v_previous, true);
  update kc_private.post_media_processing
     set state = 'done', lease_token = null, leased_until = null, derivative_key = p_derivative_key, last_error = null
   where media_id = p_media_id;
  return 'ready';
end;
$$;
comment on function public.post_media_processing_complete(uuid, uuid, text, bigint, integer, integer) is
  'process-post-media: compare-and-set completion of a photo job. Service role only.';

-- Worker call 3 of 3. Records a failure of the caller's attempt. A retryable failure waits
-- 5 minutes × attempts and is handed out again until the third attempt; anything else, or the
-- third failure, fails the job and the row. Answers 'retry', 'failed' or 'stale'.
create function public.post_media_processing_fail(
  p_media_id uuid, p_lease_token uuid, p_error text, p_retryable boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job kc_private.post_media_processing;
begin
  select * into v_job from kc_private.post_media_processing q where q.media_id = p_media_id for update;
  if not found or v_job.state <> 'processing' or v_job.lease_token is distinct from p_lease_token then
    return 'stale';
  end if;
  if coalesce(p_retryable, false) and v_job.attempts < 3 then
    update kc_private.post_media_processing
       set state = 'queued', lease_token = null, leased_until = null, last_error = left(p_error, 500),
           next_attempt_at = now() + make_interval(mins => 5 * v_job.attempts)
     where media_id = p_media_id;
    return 'retry';
  end if;
  update kc_private.post_media_processing
     set state = 'failed', lease_token = null, leased_until = null, last_error = left(p_error, 500)
   where media_id = p_media_id;
  perform kc_private.post_media_set_status(p_media_id, 'failed');
  return 'failed';
end;
$$;
comment on function public.post_media_processing_fail(uuid, uuid, text, boolean) is
  'process-post-media: records a failed photo job attempt. Service role only.';

-- Storage reconciliation keeps (does not delete) a post photo that any row still needs: the file
-- a row points at, the original a processed row was made from, and the `-thumb` sibling of
-- either (the app's and the worker's feed-size copies were never recorded row by row, so the
-- previous version of this function reported every thumb as an orphan).
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
   where p_bucket = 'post-images'
     and not exists (select 1 from public.post_media m
                      where m.storage_bucket = p_bucket and m.storage_key in (k.key, b.base))
     and not exists (select 1 from kc_private.post_media_processing q
                      where q.source_key in (k.key, b.base));
$$;
