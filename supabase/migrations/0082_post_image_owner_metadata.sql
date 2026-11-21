-- FR-POST-005: Storage's remove endpoint selects matching metadata before deleting files.
-- Public image reads do not give that SELECT permission. Limit metadata visibility to the
-- signed-in member's own folder, matching the existing INSERT and DELETE boundaries.
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname = 'post_images_select_own_folder') then
    return;
  end if;
  create policy post_images_select_own_folder on storage.objects
    for select to authenticated
    using (bucket_id = 'post-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
end $$;
