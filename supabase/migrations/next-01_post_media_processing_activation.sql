-- Posts · activates the sanitized copy of post photos (FR-POST-005 AC3, AC4; NFR-PRIV-002; KC#2316)
--
-- 0084 added the queue, the worker `process-post-media` and the compare-and-set completion, with
-- no schedule. This change turns the pipeline on and fits it to how the worker now sanitizes:
--
--   1. The copy keeps the uploaded format. The worker no longer decodes pixels (a full decode and
--      re-encode measured ≈ 1.7 s of CPU per 2048 × 1536 photo, too close to the Edge Function
--      CPU limit); it validates the file structure fail-closed and rewrites it without metadata.
--      So a PNG upload gets a PNG copy, and the copy keeps the source's pixel size (within the
--      worker's caps: 4096 px per edge, 16.8 MP). The derivative key carries the type's extension
--      and completion checks the stored object's type against it.
--   2. A new job starts the worker at once (debounced kick, the push dispatcher's pattern); a job
--      every minute is the safety net for retries and for kicks that could not be sent.
--   3. Pending photos that already exist are queued once, so posts published before activation
--      get their copy too. Only rows the claim would process anyway: images in `post-images`, still
--      `pending`, of a post that can still be shown. Others stay as they are.
--   4. The DEV resource experiment's release call is removed with the experiment.

-- ── 1. Derivative key and completion follow the source type ─────────────────────────────────────

drop function kc_private.post_media_derivative_key(uuid, uuid, integer);

-- The object key attempt n of a job must write, with the extension of the copy's type. Deterministic,
-- distinct from every other attempt and from the original, inside the service-only `derived/` namespace.
create function kc_private.post_media_derivative_key(
  p_owner_id uuid, p_media_id uuid, p_attempt integer, p_mime_type text default 'image/jpeg')
returns text
language sql
immutable
set search_path = ''
as $$
  select 'derived/' || p_owner_id::text || '/' || p_media_id::text || '-a' || p_attempt::text
         || case p_mime_type when 'image/png' then '.png' else '.jpg' end;
$$;
comment on function kc_private.post_media_derivative_key(uuid, uuid, integer, text) is
  'process-post-media: the key attempt n writes (`.jpg` for JPEG, `.png` for PNG).';

-- Worker call 2 of 3. Compare-and-set completion. Answers:
--   ready     the row now points at the derivative and is `ready`
--   stale     the lease is not (or no longer) the caller's: nothing changed
--   changed   the row was replaced, already processed, or its post can no longer be shown: skipped
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
  if v_media.processing_status <> 'pending' or v_media.storage_key <> v_job.source_key
     or not kc_private.post_media_processable(v_media.post_id) then
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
  update public.post_media
     set storage_key = p_derivative_key, mime_type = v_mime, size_bytes = p_size_bytes,
         width = p_width, height = p_height, processing_status = 'ready'
   where id = p_media_id;
  perform set_config('kc.fsm_role', v_previous, true);
  update kc_private.post_media_processing
     set state = 'done', lease_token = null, leased_until = null, derivative_key = p_derivative_key, last_error = null
   where media_id = p_media_id;
  return 'ready';
end;
$$;

drop function public.post_media_processing_release(uuid, uuid, text);

-- ── 2. Start the worker: at once for new jobs, every minute as the safety net ──────────────────

insert into kc_private.edge_function_kicks (function_name, debounce)
values ('process-post-media', interval '2 seconds');

-- Statement-level: a post published with five photos starts the worker once.
create function kc_private.post_media_processing_kick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.edge_function_kick('process-post-media');
  return null;
exception when others then
  return null;
end;
$$;
comment on function kc_private.post_media_processing_kick() is
  'AFTER INSERT (statement) on the photo queue: starts process-post-media; cannot fail the insert.';

create trigger post_media_processing_kick
  after insert on kc_private.post_media_processing
  for each statement execute function kc_private.post_media_processing_kick();

-- Starts the worker when a job is due: queued and due, or processing with a lease that ran out
-- (the claim's own condition). Returns whether a call was queued.
create function kc_private.post_media_process_tick()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from kc_private.post_media_processing q
                  where (q.state = 'queued' and q.next_attempt_at <= now())
                     or (q.state = 'processing' and q.leased_until <= now())) then
    return false;
  end if;
  return kc_private.invoke_edge_function('process-post-media') is not null;
end;
$$;
comment on function kc_private.post_media_process_tick() is
  'Scheduled every minute: starts process-post-media when a photo job is due.';

insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description) values
  ('post_media_process', '* * * * *', 'select kc_private.post_media_process_tick()',
   interval '20 seconds', interval '10 minutes',
   'Safety net of process-post-media (sanitized post photo copies); new photos also start it at once.');

-- ── 3. Photos published before activation ──────────────────────────────────────────────────────

-- Queues the pending photos that have no job yet (rows inserted before the queue existed). Only
-- what the claim would process anyway; idempotent. Returns the number of jobs it queued.
create function kc_private.post_media_processing_backfill()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queued integer;
begin
  insert into kc_private.post_media_processing (media_id, source_key)
  select m.id, m.storage_key
    from public.post_media m
   where m.kind = 'image' and m.storage_bucket = 'post-images' and m.processing_status = 'pending'
     and kc_private.post_media_processable(m.post_id)
  on conflict (media_id) do nothing;
  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;
comment on function kc_private.post_media_processing_backfill() is
  'Queues pending post photos that have no processing job (once at activation; safe to re-run).';

select kc_private.post_media_processing_backfill();
