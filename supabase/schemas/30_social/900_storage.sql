-- Social · storage bucket for post images (design §4 "Storage", §5.3)
--
-- The `storage` schema belongs to the Supabase platform. It is absent on a plain PostgreSQL
-- server, where this file does nothing, so the baseline builds everywhere. On a Supabase
-- project it declares the bucket post_media.storage_bucket points at by default, with its
-- size and type limits, and who may write objects in it.
--   read    public: files are served by the CDN under unguessable, immutable names
--   write   a signed-in member, only under the folder named by their own id
--   limits  8 MB per file; JPEG and PNG only (FR-POST-005 AC1, AC2)

do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('post-images', 'post-images', true, 8388608, array['image/jpeg', 'image/png'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- A member uploads into their own folder only.
  create policy post_images_insert_own_folder on storage.objects
    for insert to authenticated
    with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

  -- A member removes their own files (the account purge and the orphan job use the service role).
  create policy post_images_delete_own_folder on storage.objects
    for delete to authenticated
    using (bucket_id = 'post-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
end $$;
