-- PROPOSAL — NOT A MIGRATION. Kept outside supabase/migrations/ on purpose so no CI run, merge or
-- deploy can apply it. It needs a privacy + lifecycle review first: see REVIEW.md next to it.
--
-- Posts · a member's photo is shown as soon as its file is stored (FR-POST-005, KC#2316)
--
-- Every `post_media` row starts `pending`, and cards, the detail gallery and the share card show
-- only `ready` files. Nothing ever moved a row to `ready`, so no member photo reached the feed,
-- another member's detail screen or a link preview. KC#2316 allows marking media ready "on insert
-- as an interim launch-stage solution"; this is that step, kept as narrow as possible:
--
--   * Only a member's own insert (auth.uid() = owner): the app's create path and
--     `replace_post_media` on edit. Server paths (the WhatsApp bot, service jobs) run without a
--     member and are untouched, as is every existing row: there is no backfill.
--   * Only an image in `post-images` whose object is already in storage, with exactly the type
--     and size the row records. Storage enforces the bucket's 8 MB and JPEG/PNG limits at upload,
--     so the check reads object metadata only: no download, no decode, no storage write.
--   * It runs inside the insert's own transaction: a post deleted or locked later simply cascades,
--     and there is no background job, queue or schedule to reconcile.
--
-- A row whose file is missing or does not match stays `pending`, exactly as before. The app
-- re-encodes every photo on the device, which drops EXIF (FR-POST-005 AC4 client half); the
-- server-side EXIF pass is unchanged by this file.

create function kc_private.post_media_mark_stored_upload_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_role text;
begin
  if new.kind <> 'image' or new.storage_bucket <> 'post-images' or new.processing_status <> 'pending' then
    return null;
  end if;
  -- A member's own upload only; a server insert has no member and keeps the pending path.
  if (select auth.uid()) is distinct from new.owner_id then
    return null;
  end if;
  -- The object exists under that key with the recorded type and byte size. The size is cast only
  -- when it is a plain integer, so odd metadata leaves the row pending instead of failing the insert.
  if not exists (
    select 1
      from storage.objects o
     where o.bucket_id = 'post-images'
       and o.name = new.storage_key
       and o.metadata ->> 'mimetype' = new.mime_type
       and case when o.metadata ->> 'size' ~ '^[0-9]{1,12}$'
                then (o.metadata ->> 'size')::bigint end = new.size_bytes
  ) then
    return null;
  end if;

  -- `pending -> ready` is a `system` edge of the machine; act as `system` for this one write only.
  v_previous_role := coalesce(current_setting('kc.fsm_role', true), '');
  perform set_config('kc.fsm_role', 'system', true);
  update public.post_media set processing_status = 'ready' where id = new.id;
  perform set_config('kc.fsm_role', v_previous_role, true);
  return null;
end;
$$;
comment on function kc_private.post_media_mark_stored_upload_ready() is
  'AFTER INSERT on post_media: a member''s own image whose stored object matches the row becomes ready.';

create trigger post_media_mark_stored_upload_ready
  after insert on public.post_media
  for each row execute function kc_private.post_media_mark_stored_upload_ready();
