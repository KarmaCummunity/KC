-- 0445_storage_media_select_owner_scoped
-- Scope API-level SELECT on `chat-media` and `post-images` objects to the
-- object owner (first path segment = auth.uid()).
--
-- Rendering is unaffected: both buckets stay `public = true`, and the client
-- only resolves media through `getPublicUrl()`, which is served by the public
-- object endpoint and does not consult `storage.objects` policies.
-- Owner SELECT is kept because uploads with `upsert: true`
-- (`imageUpload.ts`) require it. Edge Functions use the service role and
-- bypass RLS.
--
-- Path conventions (from the insert policies):
--   post-images : <user_id>/<post_id>/<ordinal>.jpg   (0002)
--   chat-media  : <user_id>/<chat_id>/<object_id>.jpg (0440)

drop policy if exists chat_media_select on storage.objects;
drop policy if exists chat_media_select_own on storage.objects;
create policy chat_media_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists post_images_read_public on storage.objects;
drop policy if exists post_images_select_own on storage.objects;
create policy post_images_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
