-- 0439_chat_media_storage_rls_user_first | KC#1216 — align chat-media object paths with userId-first RLS (same as post-images / avatars).

drop policy if exists chat_media_insert_own on storage.objects;
create policy chat_media_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists chat_media_delete_own on storage.objects;
create policy chat_media_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
