-- Platform · storage buckets and policies (design §4 "Storage", §5.3)
--
-- Every media surface has a bucket with a size limit and a MIME allow-list, and every
-- object lives under a folder named by the member who uploaded it (`<user_id>/…`), so the
-- account purge can remove a member's files bucket by bucket.
--
--   avatars      public    512 KB  JPEG            <user_id>/avatar.jpg (FR-AUTH-011, FR-PROFILE-007)
--   post-images  public    8 MB    JPEG, PNG       declared in 30_social/900_storage.sql
--   chat-media   private   5 MB    JPEG, PNG, WebP <user_id>/<chat_id>/<file>, read through
--                                                  signed URLs by the members of that chat
--
-- No bucket is declared for organization logos or identity documents: no table of the
-- baseline stores such a file yet. A bucket is added here together with the feature.
--
-- The `storage` schema belongs to the platform; without it this file does nothing.

-- The uuid in folder p_position (1-based) of an object path; null when that folder is
-- missing or not a uuid, so a malformed path matches no policy instead of raising.
create function kc_access.storage_path_uuid(p_name text, p_position integer)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', p_position) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
      then split_part(p_name, '/', p_position)::uuid
  end;
$$;
comment on function kc_access.storage_path_uuid(text, integer) is
  'Policy helper: the uuid naming a folder of a storage object path.';
grant execute on function kc_access.storage_path_uuid(text, integer) to authenticated;

do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 524288, array['image/jpeg']),
         ('chat-media', 'chat-media', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Avatars: a member writes, replaces and removes files in their own folder. Replacing
  -- (upsert) needs to see the existing object; everyone else reads through the public URL.
  create policy avatars_select_own_folder on storage.objects
    for select to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
  create policy avatars_insert_own_folder on storage.objects
    for insert to authenticated
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
  create policy avatars_update_own_folder on storage.objects
    for update to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
  create policy avatars_delete_own_folder on storage.objects
    for delete to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

  -- Chat media: readable — and therefore signable — by exactly the members who can read
  -- the chat named by the second folder; the chat decides (kc_access.can_access_chat).
  create policy chat_media_select_chat_member on storage.objects
    for select to authenticated
    using (bucket_id = 'chat-media'
           and (select kc_access.can_access_chat(kc_access.storage_path_uuid(name, 2))));
  -- A member uploads under their own folder, into a chat they take part in.
  create policy chat_media_insert_own_folder on storage.objects
    for insert to authenticated
    with check (bucket_id = 'chat-media'
                and (storage.foldername(name))[1] = (select auth.uid())::text
                and (select kc_access.can_access_chat(kc_access.storage_path_uuid(name, 2))));
  create policy chat_media_delete_own_folder on storage.objects
    for delete to authenticated
    using (bucket_id = 'chat-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
end $$;
