-- 0148_rpc_republish_post | TD-70 — FR-POST-013 AC3
-- Republish CTA: clones an expired post (and its media_assets rows) into a
-- new post in status='open'. Owner-only, expired-source-only.
--
-- Why server-side: the FE used to lack any path to act on expired rows once
-- the 0097 cron started flipping them. A single RPC keeps the round-trip
-- minimal (clone + media in one transaction) and avoids re-uploading images
-- (media_assets.path can be reused since the post-images bucket is public
-- and the storage object is not owned by any single post row).
--
-- Errors map to client PostError codes via SQLSTATE P0001:
--   republish_not_owner          — caller is not the post owner
--   republish_wrong_status       — source post is not status='expired'
--   republish_not_found          — source post does not exist
--   active_post_limit_exceeded   — bubbled from posts_enforce_active_cap (0002)
--   followers_only_requires_private — visibility constraint (0002 INSERT policy)
--
-- Cascade behaviour:
--   - posts INSERT trigger posts_after_change_counters increments counters
--   - personal_activity_log records 'post_created' for the new row
--   - media_assets cap (5/post) is not exceeded — we copy at most 5 rows

set search_path = public;

create or replace function public.rpc_republish_post(
  p_post_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_source     public.posts;
  v_new_id     uuid;
begin
  -- Lock the source row to serialize concurrent republish attempts.
  select * into v_source
    from public.posts
   where post_id = p_post_id
   for update;

  if v_source.post_id is null then
    raise exception 'republish_not_found' using errcode = 'P0001';
  end if;
  if v_source.owner_id <> auth.uid() then
    raise exception 'republish_not_owner' using errcode = 'P0001';
  end if;
  if v_source.status <> 'expired' then
    raise exception 'republish_wrong_status' using errcode = 'P0001';
  end if;

  -- Insert the clone. Goes through RLS posts_insert_self + active-cap trigger.
  insert into public.posts (
    owner_id,
    type,
    status,
    visibility,
    title,
    description,
    category,
    city,
    street,
    street_number,
    location_display_level,
    item_condition,
    urgency
    -- reopen_count, delete_after default to 0/null
    -- created_at, updated_at default to now()
  ) values (
    v_source.owner_id,
    v_source.type,
    'open',
    v_source.visibility,
    v_source.title,
    v_source.description,
    v_source.category,
    v_source.city,
    v_source.street,
    v_source.street_number,
    v_source.location_display_level,
    v_source.item_condition,
    v_source.urgency
  )
  returning post_id into v_new_id;

  -- Clone media_assets — same storage paths (orphan reconciliation tolerates
  -- shared paths because it only deletes objects with zero matching rows).
  insert into public.media_assets (post_id, ordinal, path, mime_type, size_bytes)
  select v_new_id, ordinal, path, mime_type, size_bytes
    from public.media_assets
   where post_id = p_post_id
   order by ordinal;

  return v_new_id;
end;
$$;

-- Allow callers; SECURITY INVOKER so RLS still applies to the INSERT.
grant execute on function public.rpc_republish_post(uuid) to authenticated;
revoke execute on function public.rpc_republish_post(uuid) from anon, public;
