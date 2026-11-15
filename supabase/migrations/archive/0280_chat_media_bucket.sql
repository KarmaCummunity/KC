-- 0280_chat_media_bucket | KC#873 — chat image uploads to Supabase Storage.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path: <chat_id>/<user_id>/<uuid>.jpg — user_id segment matches auth.uid() for RLS.
drop policy if exists chat_media_select on storage.objects;
create policy chat_media_select on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'chat-media');

drop policy if exists chat_media_insert_own on storage.objects;
create policy chat_media_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists chat_media_delete_own on storage.objects;
create policy chat_media_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
